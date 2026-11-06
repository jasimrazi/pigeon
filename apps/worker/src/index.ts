import { Hono } from 'hono';
import {
  ProfileSchema,
  getEnabledSources,
  ingestSource,
  ingestAlertEmail,
  EventsNotifier,
  createLLMClient,
  DefaultScorer,
  processJobPipeline,
  ApplicationFactory,
  DefaultCoverLetterGenerator,
  getManualQueue,
  getManualKit,
  markApplied,
  skipManualApplication,
  snoozeManualApplication,
  sendByEmail,
  bulkManualAction,
  recordOutcome,
  expireStaleManualPending,
  sendManualDailyDigest,
  getGoogleAuthUrl,
  completeGoogleAuthCallback,
  getGoogleAuthHealth,
  pingGoogleAuthHealth,
  approveApplication,
  bulkApproveApplications,
  sendApplicationEmail,
  RestGmailSender,
  RestSheetsClient,
  syncApplicationsToSheet,
  getValidAccessToken,
  pollInboxAndTrackOutcomes,
  verifyCfAccessJwt,
  validateCoverLetter,
  calculateEffectiveCap,
  transition,
  TelegramNotifier,
  type Notifier,
  type NotificationPayload,
  type CloudflareAiBinding,
  type GoogleOAuthSecrets,
  type ApplicationToSend,
} from '@pigeon/shared';
import { validateWorkerEnv, type Bindings, type ValidatedEnv } from './env.js';

type Variables = {
  validatedEnv: ValidatedEnv;
};

export const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Global error handler returns JSON {error:string} with no stack traces
app.onError((err, c) => {
  return c.json({ error: err.message || 'Internal Server Error' }, 500);
});

// Unknown route returns JSON 404
app.notFound((c) => {
  return c.json({ error: 'Not Found' }, 404);
});

// Environment validation middleware
app.use('*', async (c, next) => {
  const validated = validateWorkerEnv(c.env);
  c.set('validatedEnv', validated);
  await next();
});

// -------------------------------------------------------------
// Security Middleware: CORS, State-Changing Requests, CF Access
// -------------------------------------------------------------
app.use('*', async (c, next) => {
  const origin = c.req.header('origin') || '';
  const dashboardOrigin =
    (c.env.DASHBOARD_ORIGIN as string) ||
    'http://localhost:5173';

  // Allowed origins: dashboardOrigin or localhost dev/test origins
  const isAllowedOrigin =
    origin === dashboardOrigin ||
    origin === 'http://localhost:5173' ||
    origin === 'http://127.0.0.1:5173' ||
    origin === 'http://localhost:3000' ||
    !origin; // Non-browser or same-origin

  if (origin && isAllowedOrigin) {
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Access-Control-Allow-Credentials', 'true');
    c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Content-Type, Cf-Access-Jwt-Assertion, Authorization');
  }

  // Preflight
  if (c.req.method === 'OPTIONS') {
    return c.body(null, 204);
  }

  const path = c.req.path;
  const isStateChanging = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method);

  // State-changing endpoint Origin check
  if (isStateChanging && path.startsWith('/api/')) {
    if (origin && !isAllowedOrigin) {
      return c.json({ error: 'Forbidden: Origin mismatch' }, 403);
    }

    // Require JSON Content-Type for mutations with bodies (except multipart resumes upload)
    if (path !== '/api/resumes') {
      const contentType = c.req.header('content-type') || '';
      const contentLength = c.req.header('content-length');
      const hasBody =
        (contentLength !== undefined && contentLength !== '0') ||
        c.req.raw.body !== null;
      if (hasBody && !contentType.includes('application/json')) {
        return c.json({ error: 'Unsupported Media Type: expected application/json' }, 415);
      }
    }
  }

  // Cloudflare Access JWT Assertion check for /api/*
  if (path.startsWith('/api/')) {
    const cfAccessAud = (c.env.CF_ACCESS_AUD as string) || undefined;
    const cfAccessTeamDomain = (c.env.CF_ACCESS_TEAM_DOMAIN as string) || undefined;

    // Enforce when Cloudflare Access is configured
    if (cfAccessAud && cfAccessTeamDomain) {
      const assertion = c.req.header('cf-access-jwt-assertion');
      if (!assertion) {
        return c.json({ error: 'Unauthorized: Missing Cf-Access-Jwt-Assertion header' }, 401);
      }

      const verifyRes = await verifyCfAccessJwt(assertion, {
        teamDomain: cfAccessTeamDomain,
        audience: cfAccessAud,
      });

      if (!verifyRes.valid) {
        return c.json({ error: `Unauthorized: ${verifyRes.reason || 'Invalid Access JWT'}` }, 401);
      }
    }
  }

  await next();
});

export function createWorkerNotifier(env: Bindings): Notifier {
  const eventsNotifier = new EventsNotifier(env.DB);
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    const telegramNotifier = new TelegramNotifier({
      botToken: env.TELEGRAM_BOT_TOKEN as string,
      chatId: env.TELEGRAM_CHAT_ID as string,
      kv: env.CONFIG,
    });
    return {
      async notify(payload: string | NotificationPayload) {
        await Promise.allSettled([
          eventsNotifier.notify(payload),
          telegramNotifier.notify(payload),
        ]);
      },
    };
  }
  return eventsNotifier;
}

// GET /health returns {ok:true, dryRun:boolean, env:string}
app.get('/health', (c) => {
  const env = c.get('validatedEnv');
  return c.json({
    ok: true,
    dryRun: env.DRY_RUN,
    env: env.ENV,
  });
});

// POST /api/resumes: PDF only (%PDF magic bytes), max 5 MB, stored in R2, tags supplied by caller
app.post('/api/resumes', async (c) => {
  const formData = await c.req.formData();
  const file = formData.get('file');

  if (!file || typeof file === 'string' || !(file instanceof Blob)) {
    return c.json({ error: 'Missing or invalid file' }, 400);
  }

  // Max 5 MB check
  const arrayBuffer = await file.arrayBuffer();
  if (arrayBuffer.byteLength > 5 * 1024 * 1024) {
    return c.json({ error: 'File size exceeds 5 MB limit' }, 400);
  }

  // PDF magic bytes check: %PDF (0x25, 0x50, 0x44, 0x46)
  const bytes = new Uint8Array(arrayBuffer);
  if (
    bytes.length < 4 ||
    bytes[0] !== 0x25 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x44 ||
    bytes[3] !== 0x46
  ) {
    return c.json({ error: 'Invalid file: only PDF documents are allowed' }, 400);
  }

  const labelRaw = formData.get('label');
  const fileName = 'name' in file ? (file as { name?: string }).name : undefined;
  const label =
    typeof labelRaw === 'string' && labelRaw.trim() ? labelRaw.trim() : fileName || 'Resume';

  const tagsRaw = formData.get('tags');
  let tags: string[] = [];
  if (typeof tagsRaw === 'string') {
    try {
      const parsed = JSON.parse(tagsRaw);
      if (Array.isArray(parsed)) {
        tags = parsed.map(String);
      } else {
        tags = [tagsRaw];
      }
    } catch {
      tags = tagsRaw
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
    }
  }

  const isDefaultRaw = formData.get('is_default');
  const isDefault = isDefaultRaw === 'true' || isDefaultRaw === '1';

  const id = crypto.randomUUID();
  const r2Key = `resumes/${id}.pdf`;
  const now = new Date().toISOString();

  // Store in R2
  await c.env.RESUMES.put(r2Key, arrayBuffer, {
    httpMetadata: { contentType: 'application/pdf' },
  });

  // Store in D1 and write event
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO resumes (id, label, r2_key, tags, is_default, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(id, label, r2Key, JSON.stringify(tags), isDefault ? 1 : 0, now),
    c.env.DB.prepare(
      `INSERT INTO events (id, entity, entity_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      'resume',
      id,
      'resume_uploaded',
      JSON.stringify({ label, r2_key: r2Key, tags, is_default: isDefault }),
      now,
    ),
  ]);

  return c.json(
    {
      resume: {
        id,
        label,
        r2_key: r2Key,
        tags,
        is_default: isDefault,
        created_at: now,
      },
    },
    201,
  );
});

// GET /api/resumes: list available resumes
app.get('/api/resumes', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, label, tags, is_default, created_at FROM resumes ORDER BY is_default DESC, created_at DESC`,
  ).all();
  return c.json({ ok: true, resumes: results || [] });
});

// GET /api/profile
app.get('/api/profile', async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT data, updated_at FROM profile WHERE id = 'default'`,
  ).first<{ data: string; updated_at: string }>();

  if (!row) {
    return c.json({ error: 'Profile not found' }, 404);
  }

  const parsed = JSON.parse(row.data);
  return c.json({ profile: parsed, updated_at: row.updated_at });
});

// PUT /api/profile
app.put('/api/profile', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const result = ProfileSchema.safeParse(body);
  if (!result.success) {
    return c.json({ error: 'Validation failed', issues: result.error.issues }, 400);
  }

  const now = new Date().toISOString();
  const profileJson = JSON.stringify(result.data);

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO profile (id, data, updated_at) VALUES ('default', ?, ?)
       ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    ).bind(profileJson, now),
    c.env.DB.prepare(
      `INSERT INTO events (id, entity, entity_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      'profile',
      'default',
      'profile_updated',
      JSON.stringify({ email: result.data.email, name: result.data.name }),
      now,
    ),
  ]);

  return c.json({ profile: result.data, updated_at: now });
});

// GET /api/events with filters
app.get('/api/events', async (c) => {
  const entity = c.req.query('entity');
  const entityId = c.req.query('entity_id');
  const type = c.req.query('type');
  const limitParam = parseInt(c.req.query('limit') || '50', 10);
  const limit = Math.min(Math.max(1, isNaN(limitParam) ? 50 : limitParam), 100);
  const offsetParam = parseInt(c.req.query('offset') || '0', 10);
  const offset = Math.max(0, isNaN(offsetParam) ? 0 : offsetParam);

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (entity) {
    conditions.push('entity = ?');
    params.push(entity);
  }
  if (entityId) {
    conditions.push('entity_id = ?');
    params.push(entityId);
  }
  if (type) {
    conditions.push('type = ?');
    params.push(type);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const query = `SELECT id, entity, entity_id, type, payload, created_at FROM events ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const stmt = c.env.DB.prepare(query);
  const { results } = await stmt.bind(...params).all<{
    id: string;
    entity: string;
    entity_id: string;
    type: string;
    payload: string;
    created_at: string;
  }>();

  const formattedEvents = (results || []).map((row) => {
    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(row.payload);
    } catch {
      parsedPayload = row.payload;
    }
    return {
      id: row.id,
      entity: row.entity,
      entity_id: row.entity_id,
      type: row.type,
      payload: parsedPayload,
      created_at: row.created_at,
    };
  });

  return c.json({ events: formattedEvents });
});

// Test route to verify 500 handler behavior
app.get('/test-error', () => {
  throw new Error('Simulated failure');
});

// POST /api/pipeline/run: Runs the Phase 4 scoring and routing pipeline on 'new' jobs
app.post('/api/pipeline/run', async (c) => {
  const profileRow = await c.env.DB.prepare('SELECT data FROM profile WHERE id = ?')
    .bind('default')
    .first<{ data: string }>();

  if (!profileRow?.data) {
    return c.json({ error: 'Profile not configured' }, 400);
  }

  const profile = ProfileSchema.parse(JSON.parse(profileRow.data));
  const env = c.get('validatedEnv');

  const llmClient = createLLMClient({
    provider: env.LLM_PROVIDER,
    ai: (env.AI ?? c.env.AI) as CloudflareAiBinding | undefined,
    geminiApiKey: env.GEMINI_API_KEY,
  });

  const scorer = new DefaultScorer(llmClient);

  // Read max_scored_per_day from KV if set
  const maxScoredRaw = await c.env.CONFIG.get('MAX_SCORED_PER_DAY');
  const maxScoredPerDay = maxScoredRaw ? Number.parseInt(maxScoredRaw, 10) : 200;

  const stats = await processJobPipeline({
    db: c.env.DB,
    profile,
    scorer,
    config: { max_scored_per_day: maxScoredPerDay },
  });

  return c.json({ ok: true, stats });
});

// POST /api/applications/create: Creates an application for a given job using ApplicationFactory
app.post('/api/applications/create', async (c) => {
  const body = await c.req.json<{ job_id?: string }>().catch(() => ({}) as { job_id?: string });
  if (!body.job_id) {
    return c.json({ error: 'Missing required field: job_id' }, 400);
  }

  const profileRow = await c.env.DB.prepare('SELECT data FROM profile WHERE id = ?')
    .bind('default')
    .first<{ data: string }>();

  if (!profileRow?.data) {
    return c.json({ error: 'Profile not configured' }, 400);
  }

  const profile = ProfileSchema.parse(JSON.parse(profileRow.data));
  const env = c.get('validatedEnv');

  const llmClient = createLLMClient({
    provider: env.LLM_PROVIDER,
    ai: (env.AI ?? c.env.AI) as CloudflareAiBinding | undefined,
    geminiApiKey: env.GEMINI_API_KEY,
  });

  const generator = new DefaultCoverLetterGenerator(llmClient);

  const result = await ApplicationFactory.createForJob({
    db: c.env.DB,
    jobId: body.job_id,
    profile,
    generator,
  });

  return c.json({ ok: true, ...result });
});

// PUT /api/applications/:id/letter: Edits an application's cover letter and re-runs validation
app.put('/api/applications/:id/letter', async (c) => {
  const id = c.req.param('id');
  const body = await c.req
    .json<{ cover_letter?: string; subject?: string }>()
    .catch(() => ({}) as { cover_letter?: string; subject?: string });

  if (!body.cover_letter) {
    return c.json({ error: 'Missing required field: cover_letter' }, 400);
  }

  const profileRow = await c.env.DB.prepare('SELECT data FROM profile WHERE id = ?')
    .bind('default')
    .first<{ data: string }>();

  if (!profileRow?.data) {
    return c.json({ error: 'Profile not configured' }, 400);
  }

  const profile = ProfileSchema.parse(JSON.parse(profileRow.data));

  const result = await ApplicationFactory.updateCoverLetter({
    db: c.env.DB,
    applicationId: id,
    coverLetter: body.cover_letter,
    subject: body.subject,
    profile,
  });

  return c.json({ ok: true, ...result });
});

// GET /api/manual: Lists manual queue applications
app.get('/api/manual', async (c) => {
  const route = c.req.query('route');
  const route_reason = c.req.query('route_reason');
  const source = c.req.query('source');
  const min_score = c.req.query('min_score') ? Number(c.req.query('min_score')) : undefined;
  const max_score = c.req.query('max_score') ? Number(c.req.query('max_score')) : undefined;
  const age_days = c.req.query('age_days') ? Number(c.req.query('age_days')) : undefined;
  const include_snoozed = c.req.query('include_snoozed') === 'true';

  const result = await getManualQueue(c.env.DB, {
    filters: {
      route,
      route_reason,
      source,
      min_score,
      max_score,
      age_days,
      include_snoozed,
    },
  });

  return c.json({ ok: true, ...result });
});

// GET /api/manual/:id/kit: Retrieves the Manual Apply Kit for an application
app.get('/api/manual/:id/kit', async (c) => {
  const id = c.req.param('id');
  const kit = await getManualKit(c.env.DB, id);
  if (!kit) {
    return c.json({ error: 'Manual apply kit not found' }, 404);
  }
  return c.json({ ok: true, kit });
});

// POST /api/manual/:id/applied: Marks application as manually applied
app.post('/api/manual/:id/applied', async (c) => {
  const id = c.req.param('id');
  const body = await c.req
    .json<{ note?: string; applied_at?: string }>()
    .catch(() => ({}) as { note?: string; applied_at?: string });
  const result = await markApplied({
    db: c.env.DB,
    applicationId: id,
    note: body.note,
    applied_at: body.applied_at,
  });
  try {
    await c.env.JOBS_QUEUE.send({ action: 'sync_sheet' });
  } catch {
    // Non-fatal
  }
  return c.json({ ok: true, ...result });
});

// POST /api/manual/:id/skip: Skips a manual application with reason
app.post('/api/manual/:id/skip', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ reason?: string }>().catch(() => ({}) as { reason?: string });
  const reason = body.reason?.trim() || 'MANUAL_SKIPPED';
  const result = await skipManualApplication({
    db: c.env.DB,
    applicationId: id,
    reason,
  });
  try {
    await c.env.JOBS_QUEUE.send({ action: 'sync_sheet' });
  } catch {
    // Non-fatal
  }
  return c.json({ ok: true, ...result });
});

// POST /api/manual/:id/snooze: Snoozes a manual application for N days
app.post('/api/manual/:id/snooze', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ days?: number }>().catch(() => ({}) as { days?: number });
  const days = typeof body.days === 'number' && body.days > 0 ? body.days : 1;
  const result = await snoozeManualApplication({
    db: c.env.DB,
    applicationId: id,
    days,
  });
  return c.json({ ok: true, ...result });
});

// POST /api/manual/:id/send-by-email: Switches channel to email and approves
app.post('/api/manual/:id/send-by-email', async (c) => {
  const id = c.req.param('id');
  const body = await c.req
    .json<{ confirm_risk?: boolean }>()
    .catch(() => ({}) as { confirm_risk?: boolean });
  const result = await sendByEmail({
    db: c.env.DB,
    applicationId: id,
    confirmRisk: body.confirm_risk,
  });
  return c.json({ ok: true, ...result });
});

// POST /api/manual/bulk: Bulk applied or skip for manual_pending items
app.post('/api/manual/bulk', async (c) => {
  const body = await c.req
    .json<{ ids?: string[]; action?: 'applied' | 'skip'; reason?: string; note?: string }>()
    .catch(
      () =>
        ({}) as {
          ids?: string[];
          action?: 'applied' | 'skip';
          reason?: string;
          note?: string;
        },
    );
  if (
    !body.ids ||
    !Array.isArray(body.ids) ||
    (body.action !== 'applied' && body.action !== 'skip')
  ) {
    return c.json(
      { error: "Invalid bulk action: requires 'ids' array and action 'applied' or 'skip'" },
      400,
    );
  }
  const result = await bulkManualAction({
    db: c.env.DB,
    ids: body.ids,
    action: body.action,
    reason: body.reason,
    note: body.note,
  });
  return c.json({ ok: true, ...result });
});

// POST /api/applications/:id/outcome: Record interview/offer/rejection/replied outcome
app.post('/api/applications/:id/outcome', async (c) => {
  const id = c.req.param('id');
  const body = await c.req
    .json<{ status?: 'replied' | 'interview' | 'rejected' | 'offer' }>()
    .catch(() => ({}) as { status?: 'replied' | 'interview' | 'rejected' | 'offer' });
  const allowed = ['replied', 'interview', 'rejected', 'offer'];
  if (!body.status || !allowed.includes(body.status)) {
    return c.json({ error: `Invalid outcome status: must be one of ${allowed.join(', ')}` }, 400);
  }
  const result = await recordOutcome({
    db: c.env.DB,
    applicationId: id,
    status: body.status,
  });
  return c.json({ ok: true, ...result });
});

// GET /api/resumes/:id/download: Streams the resume PDF from R2
app.get('/api/resumes/:id/download', async (c) => {
  const id = c.req.param('id');
  const resume = await c.env.DB.prepare('SELECT r2_key, label FROM resumes WHERE id = ?')
    .bind(id)
    .first<{ r2_key: string; label: string }>();

  if (!resume) {
    return c.json({ error: 'Resume not found' }, 404);
  }

  const object = await c.env.RESUMES.get(resume.r2_key);
  if (!object) {
    return c.json({ error: 'Resume file not found in storage' }, 404);
  }

  const safeFilename = `${resume.label.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;
  c.header('Content-Type', 'application/pdf');
  c.header('Content-Disposition', `inline; filename="${safeFilename}"`);
  return c.body(object.body);
});

// -------------------------------------------------------------
// Google OAuth & Auth Health Routes
// -------------------------------------------------------------

app.get('/auth/google/start', (c) => {
  const env = c.get('validatedEnv');
  if (!env.GOOGLE_CLIENT_ID) {
    return c.json({ error: 'GOOGLE_CLIENT_ID is not configured' }, 400);
  }

  const redirectUri =
    env.GOOGLE_REDIRECT_URI || new URL('/auth/google/callback', c.req.url).toString();
  const state = crypto.randomUUID();
  const authUrl = getGoogleAuthUrl({
    clientId: env.GOOGLE_CLIENT_ID,
    redirectUri,
    state,
  });

  return c.redirect(authUrl, 302);
});

app.get('/auth/google/callback', async (c) => {
  const env = c.get('validatedEnv');
  const code = c.req.query('code');
  const error = c.req.query('error');

  if (error) {
    return c.json({ error: `Google OAuth error: ${error}` }, 400);
  }
  if (!code) {
    return c.json({ error: 'Missing authorization code' }, 400);
  }

  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return c.json({ error: 'Google client credentials not configured' }, 400);
  }

  const redirectUri =
    env.GOOGLE_REDIRECT_URI || new URL('/auth/google/callback', c.req.url).toString();
  const secrets: GoogleOAuthSecrets = {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    tokenEncryptionKey:
      env.GOOGLE_TOKEN_ENCRYPTION_KEY || 'default-pigeon-token-encryption-key-32b',
    redirectUri,
  };

  const notifier = createWorkerNotifier(c.env);
  await completeGoogleAuthCallback({
    code,
    config: c.env.CONFIG,
    secrets,
    redirectUri,
    notifier,
  });

  return c.json({
    ok: true,
    message: 'Google authentication successful. Refresh token encrypted and health set to ok.',
  });
});

app.get('/api/auth/google/health', async (c) => {
  const health = await getGoogleAuthHealth(c.env.CONFIG);
  return c.json({ ok: true, health });
});

app.post('/api/auth/google/ping', async (c) => {
  const env = c.get('validatedEnv');
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return c.json({ error: 'Google client credentials not configured' }, 400);
  }

  const secrets: GoogleOAuthSecrets = {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    tokenEncryptionKey:
      env.GOOGLE_TOKEN_ENCRYPTION_KEY || 'default-pigeon-token-encryption-key-32b',
  };

  const notifier = createWorkerNotifier(c.env);
  const health = await pingGoogleAuthHealth({
    config: c.env.CONFIG,
    secrets,
    notifier,
  });

  return c.json({ ok: true, health });
});

// -------------------------------------------------------------
// Application Approval Routes
// -------------------------------------------------------------

app.post('/api/applications/:id/approve', async (c) => {
  const id = c.req.param('id');
  const body = await c.req
    .json<{ confirm_risk?: boolean }>()
    .catch(() => ({}) as { confirm_risk?: boolean });

  const profileRow = await c.env.DB.prepare('SELECT data FROM profile WHERE id = ?')
    .bind('default')
    .first<{ data: string }>();

  if (!profileRow?.data) {
    return c.json({ error: 'Profile not configured' }, 400);
  }
  const profile = ProfileSchema.parse(JSON.parse(profileRow.data));

  await approveApplication({
    db: c.env.DB,
    applicationId: id,
    profile,
    confirmRisk: body.confirm_risk,
  });

  try {
    await c.env.JOBS_QUEUE.send({ action: 'sync_sheet' });
  } catch {
    // Non-fatal
  }

  return c.json({ ok: true, success: true });
});

app.post('/api/applications/approve-bulk', async (c) => {
  const body = await c.req
    .json<{ ids?: string[]; application_ids?: string[] }>()
    .catch(() => ({}) as { ids?: string[]; application_ids?: string[] });
  const ids = body.ids || body.application_ids;

  if (!ids || !Array.isArray(ids)) {
    return c.json({ error: "Missing required 'ids' or 'application_ids' array in body" }, 400);
  }

  const profileRow = await c.env.DB.prepare('SELECT data FROM profile WHERE id = ?')
    .bind('default')
    .first<{ data: string }>();

  if (!profileRow?.data) {
    return c.json({ error: 'Profile not configured' }, 400);
  }
  const profile = ProfileSchema.parse(JSON.parse(profileRow.data));

  const result = await bulkApproveApplications({
    db: c.env.DB,
    ids,
    profile,
  });

  try {
    await c.env.JOBS_QUEUE.send({ action: 'sync_sheet' });
  } catch {
    // Non-fatal
  }

  return c.json({ ok: true, ...result });
});

app.post('/api/applications/bulk-approve', async (c) => {
  const body = await c.req
    .json<{ ids?: string[]; application_ids?: string[] }>()
    .catch(() => ({}) as { ids?: string[]; application_ids?: string[] });
  const ids = body.ids || body.application_ids;

  if (!ids || !Array.isArray(ids)) {
    return c.json({ error: "Missing required 'ids' or 'application_ids' array in body" }, 400);
  }

  const profileRow = await c.env.DB.prepare('SELECT data FROM profile WHERE id = ?')
    .bind('default')
    .first<{ data: string }>();

  if (!profileRow?.data) {
    return c.json({ error: 'Profile not configured' }, 400);
  }
  const profile = ProfileSchema.parse(JSON.parse(profileRow.data));

  const result = await bulkApproveApplications({
    db: c.env.DB,
    ids,
    profile,
  });

  try {
    await c.env.JOBS_QUEUE.send({ action: 'sync_sheet' });
  } catch {
    // Non-fatal
  }

  return c.json({ ok: true, ...result });
});

// -------------------------------------------------------------
// Application Send Route
// -------------------------------------------------------------

app.post('/api/applications/:id/send', async (c) => {
  const id = c.req.param('id');
  const env = c.get('validatedEnv');

  const profileRow = await c.env.DB.prepare('SELECT data FROM profile WHERE id = ?')
    .bind('default')
    .first<{ data: string }>();

  if (!profileRow?.data) {
    return c.json({ error: 'Profile not configured' }, 400);
  }
  const profile = ProfileSchema.parse(JSON.parse(profileRow.data));

  const appRow = await c.env.DB.prepare(
    `SELECT
       a.id, a.job_id, a.channel, a.status, a.cover_letter, a.subject,
       a.resume_id, a.message_id_header, a.gmail_message_id, a.gmail_thread_id,
       a.retry_count, j.title, j.company, j.company_normalized, j.contact_email
     FROM applications a
     JOIN jobs j ON a.job_id = j.id
     WHERE a.id = ?`,
  )
    .bind(id)
    .first<ApplicationToSend>();

  if (!appRow) {
    return c.json({ error: `Application '${id}' not found` }, 404);
  }

  const secrets: GoogleOAuthSecrets = {
    clientId: env.GOOGLE_CLIENT_ID || 'client-id',
    clientSecret: env.GOOGLE_CLIENT_SECRET || 'client-secret',
    tokenEncryptionKey:
      env.GOOGLE_TOKEN_ENCRYPTION_KEY || 'default-pigeon-token-encryption-key-32b',
  };

  const notifier = createWorkerNotifier(c.env);
  const gmailSender = new RestGmailSender(() =>
    getValidAccessToken({
      config: c.env.CONFIG,
      secrets,
      notifier,
    }),
  );

  const result = await sendApplicationEmail({
    db: c.env.DB,
    config: c.env.CONFIG,
    resumesBucket: c.env.RESUMES,
    gmailSender,
    profile,
    notifier,
    dryRun: env.DRY_RUN,
    killSwitch: env.KILL_SWITCH,
    application: appRow,
  });

  // Trigger sheet sync after send attempt
  try {
    await c.env.JOBS_QUEUE.send({ action: 'sync_sheet' });
  } catch {
    // Non-fatal
  }

  return c.json({ ok: result.success, ...result });
});

// -------------------------------------------------------------
// Google Sheets Sync Route
// -------------------------------------------------------------

app.post('/api/sync/sheet', async (c) => {
  const env = c.get('validatedEnv');

  const secrets: GoogleOAuthSecrets = {
    clientId: (env.GOOGLE_CLIENT_ID as string) || 'client-id',
    clientSecret: (env.GOOGLE_CLIENT_SECRET as string) || 'client-secret',
    tokenEncryptionKey:
      (env.GOOGLE_TOKEN_ENCRYPTION_KEY as string) || 'default-pigeon-token-encryption-key-32b',
  };

  const notifier = createWorkerNotifier(c.env);
  const sheetsClient = new RestSheetsClient(() =>
    getValidAccessToken({
      config: c.env.CONFIG,
      secrets,
      notifier,
    }),
  );

  const result = await syncApplicationsToSheet({
    db: c.env.DB,
    config: c.env.CONFIG,
    sheetsClient,
    spreadsheetId: env.GOOGLE_SHEET_ID,
    notifier,
  });

  return c.json({ ok: result.success, ...result });
});

// -------------------------------------------------------------
// Inbox Poller & Outcome Tracking Route
// -------------------------------------------------------------

app.post('/api/inbox/poll', async (c) => {
  const env = c.get('validatedEnv');

  const profileRow = await c.env.DB.prepare('SELECT data FROM profile WHERE id = ?')
    .bind('default')
    .first<{ data: string }>();

  if (!profileRow?.data) {
    return c.json({ error: 'Profile not configured' }, 400);
  }
  const profile = ProfileSchema.parse(JSON.parse(profileRow.data));

  const secrets: GoogleOAuthSecrets = {
    clientId: (env.GOOGLE_CLIENT_ID as string) || 'client-id',
    clientSecret: (env.GOOGLE_CLIENT_SECRET as string) || 'client-secret',
    tokenEncryptionKey:
      (env.GOOGLE_TOKEN_ENCRYPTION_KEY as string) || 'default-pigeon-token-encryption-key-32b',
  };

  const notifier = new EventsNotifier(c.env.DB);
  const gmailSender = new RestGmailSender(() =>
    getValidAccessToken({
      config: c.env.CONFIG,
      secrets,
      notifier,
    }),
  );

  let llmClient = undefined;
  if (c.env.AI || env.GEMINI_API_KEY) {
    try {
      llmClient = createLLMClient({
        provider: (env.LLM_PROVIDER as 'workers-ai' | 'gemini') || 'workers-ai',
        aiBinding: c.env.AI as CloudflareAiBinding | undefined,
        geminiApiKey: env.GEMINI_API_KEY,
      });
    } catch {
      // Deterministic rules fallback
    }
  }

  const result = await pollInboxAndTrackOutcomes({
    db: c.env.DB,
    config: c.env.CONFIG,
    gmailSender,
    profile,
    notifier,
    llmClient,
  });

  if (result.bouncedCount > 0 || result.repliedCount > 0 || result.followUpsCreated > 0) {
    try {
      await c.env.JOBS_QUEUE.send({ action: 'sync_sheet' });
    } catch {
      // Non-fatal
    }
  }

  return c.json({ ok: !result.skippedAuthInvalid, ...result });
});

// -------------------------------------------------------------
// Dashboard Operations & Controls Routes
// -------------------------------------------------------------

// 1. GET /api/overview: Today's sends, caps, rates, status counts, auth health
app.get('/api/overview', async (c) => {
  const env = c.get('validatedEnv');
  const nowMs = Date.now();
  const today = new Date(nowMs).toISOString().slice(0, 10);

  const profileRow = await c.env.DB.prepare('SELECT data FROM profile WHERE id = ?')
    .bind('default')
    .first<{ data: string }>();

  let effectiveCap = 20;
  let dailyCap = 20;
  if (profileRow?.data) {
    try {
      const profile = ProfileSchema.parse(JSON.parse(profileRow.data));
      dailyCap = profile.send_settings?.daily_cap ?? 20;
      effectiveCap = await calculateEffectiveCap({ db: c.env.DB, profile, nowMs });
    } catch {
      // fallback
    }
  }

  // Today's sends and bounces
  const dailyRow = await c.env.DB.prepare(
    'SELECT sends, bounces FROM daily_counters WHERE date = ?',
  )
    .bind(today)
    .first<{ sends: number; bounces: number }>();

  const sendsToday = dailyRow?.sends ?? 0;
  const bouncesToday = dailyRow?.bounces ?? 0;
  const bounceRate = sendsToday > 0 ? Math.round((bouncesToday / sendsToday) * 100) : 0;

  // Recent 24h failure rate
  const oneDayAgo = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();
  const failStats = await c.env.DB.prepare(
    `SELECT
       COUNT(CASE WHEN status = 'failed' THEN 1 END) AS failed_count,
       COUNT(*) AS total_count
     FROM applications
     WHERE sent_at >= ? OR updated_at >= ?`,
  )
    .bind(oneDayAgo, oneDayAgo)
    .first<{ failed_count: number; total_count: number }>();

  const failureRate =
    failStats && failStats.total_count > 0
      ? Math.round((failStats.failed_count / failStats.total_count) * 100)
      : 0;

  // Jobs by status
  const statusRows = await c.env.DB.prepare(
    'SELECT status, COUNT(*) AS count FROM jobs GROUP BY status',
  ).all<{ status: string; count: number }>();

  const jobsByStatus: Record<string, number> = {};
  for (const r of statusRows.results || []) {
    jobsByStatus[r.status] = r.count;
  }

  // Jobs by route
  const routeRows = await c.env.DB.prepare(
    'SELECT apply_route, COUNT(*) AS count FROM jobs WHERE apply_route IS NOT NULL GROUP BY apply_route',
  ).all<{ apply_route: string; count: number }>();

  const jobsByRoute: Record<string, number> = {};
  for (const r of routeRows.results || []) {
    jobsByRoute[r.apply_route] = r.count;
  }

  // Manual items waiting
  const manualWaitingRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count FROM applications WHERE channel = 'manual' AND status IN ('manual_pending', 'needs_review')`,
  ).first<{ count: number }>();
  const manualWaitingCount = manualWaitingRow?.count ?? 0;

  // Auth health
  const authHealth = await getGoogleAuthHealth(c.env.CONFIG);

  // Kill switch from KV or env
  const kvKillSwitch =
    (await c.env.CONFIG.get('kill_switch')) === 'true' ||
    (await c.env.CONFIG.get('KILL_SWITCH')) === 'true';
  const killSwitch = kvKillSwitch || env.KILL_SWITCH;

  // Dry run from KV or env
  const kvDryRun = await c.env.CONFIG.get('DRY_RUN');
  const dryRun = kvDryRun !== null ? kvDryRun === 'true' : env.DRY_RUN;

  return c.json({
    sendsToday,
    effectiveCap,
    dailyCap,
    bounceRate,
    failureRate,
    jobsByStatus,
    jobsByRoute,
    manualWaitingCount,
    authHealth,
    dryRun,
    killSwitch,
  });
});

// 2. GET /api/review-queue: Email drafts waiting for approval
app.get('/api/review-queue', async (c) => {
  const profileRow = await c.env.DB.prepare('SELECT data FROM profile WHERE id = ?')
    .bind('default')
    .first<{ data: string }>();

  let autoApproveThreshold = 85;
  if (profileRow?.data) {
    try {
      const profile = ProfileSchema.parse(JSON.parse(profileRow.data));
      autoApproveThreshold = profile.send_settings?.auto_approve_above_score ?? 85;
    } catch {
      // fallback
    }
  }

  const { results: rawRows } = await c.env.DB.prepare(
    `SELECT
       a.id, a.job_id, a.status, a.cover_letter, a.subject, a.resume_id, a.validator_errors, a.updated_at,
       j.title, j.company, j.location, j.salary_raw, j.description, j.apply_url, j.contact_email, j.contact_source,
       j.match_score, j.match_reasons, j.red_flags, j.untrusted, j.route_reason,
       r.label AS resume_label
     FROM applications a
     JOIN jobs j ON a.job_id = j.id
     LEFT JOIN resumes r ON a.resume_id = r.id
     WHERE a.channel = 'email' AND a.status IN ('draft', 'needs_review')
     ORDER BY j.match_score DESC, a.updated_at DESC`,
  ).all();

  const items = (rawRows || []).map((row: any) => {
    let redFlagsList: string[] = [];
    try {
      if (row.red_flags) redFlagsList = JSON.parse(row.red_flags);
    } catch {
      // fallback
    }

    const hasRedFlags = redFlagsList.length > 0;
    const isUntrusted = Boolean(row.untrusted);
    const score = Number(row.match_score ?? 0);
    const hasSafeContact =
      row.contact_source &&
      row.contact_source !== 'guessed' &&
      row.contact_source !== 'none' &&
      Boolean(row.contact_email);

    const isSafeForBulk =
      score >= autoApproveThreshold && hasSafeContact && !hasRedFlags && !isUntrusted;

    return {
      ...row,
      red_flags: redFlagsList,
      is_safe_for_bulk: isSafeForBulk,
    };
  });

  return c.json({ items });
});

// 3. PATCH /api/applications/:id/letter: Edits cover letter & re-runs guardrail validator
app.patch('/api/applications/:id/letter', async (c) => {
  const id = c.req.param('id');
  const body = await c.req
    .json<{ cover_letter?: string }>()
    .catch(() => ({}) as { cover_letter?: string });

  if (!body.cover_letter || typeof body.cover_letter !== 'string') {
    return c.json({ error: 'Missing cover_letter in request body' }, 400);
  }

  const appRow = await c.env.DB.prepare(
    `SELECT a.id, a.subject, j.title, j.company
     FROM applications a
     JOIN jobs j ON a.job_id = j.id
     WHERE a.id = ?`,
  )
    .bind(id)
    .first<{ id: string; subject: string; title: string; company: string }>();

  if (!appRow) {
    return c.json({ error: `Application '${id}' not found` }, 404);
  }

  const profileRow = await c.env.DB.prepare('SELECT data FROM profile WHERE id = ?')
    .bind('default')
    .first<{ data: string }>();

  if (!profileRow?.data) {
    return c.json({ error: 'Profile not configured' }, 400);
  }
  const profile = ProfileSchema.parse(JSON.parse(profileRow.data));

  // Run pure guardrail validator
  const errors = validateCoverLetter(
    body.cover_letter,
    appRow.subject || '',
    profile,
    { title: appRow.title, company: appRow.company },
  );

  const nowIso = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE applications
     SET cover_letter = ?, validator_errors = ?, updated_at = ?
     WHERE id = ?`,
  )
    .bind(
      body.cover_letter,
      errors.length > 0 ? JSON.stringify(errors) : null,
      nowIso,
      id,
    )
    .run();

  // Audit event
  await c.env.DB.prepare(
    `INSERT INTO events (id, entity, entity_id, type, payload, created_at)
     VALUES (?, 'application', ?, 'cover_letter_edited', ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      id,
      JSON.stringify({ error_count: errors.length, errors }),
      nowIso,
    )
    .run();

  return c.json({ ok: true, validator_errors: errors });
});

// 4. PATCH /api/applications/:id/resume: Updates resume assignment
app.patch('/api/applications/:id/resume', async (c) => {
  const id = c.req.param('id');
  const body = await c.req
    .json<{ resume_id?: string }>()
    .catch(() => ({}) as { resume_id?: string });

  if (!body.resume_id) {
    return c.json({ error: 'Missing resume_id in body' }, 400);
  }

  const nowIso = new Date().toISOString();
  await c.env.DB.prepare(
    'UPDATE applications SET resume_id = ?, updated_at = ? WHERE id = ?',
  )
    .bind(body.resume_id, nowIso, id)
    .run();

  return c.json({ ok: true });
});

// 5. POST /api/applications/:id/reject: Rejects application
app.post('/api/applications/:id/reject', async (c) => {
  const id = c.req.param('id');
  const appRow = await c.env.DB.prepare('SELECT status FROM applications WHERE id = ?')
    .bind(id)
    .first<{ status: string }>();

  if (!appRow) {
    return c.json({ error: `Application '${id}' not found` }, 404);
  }

  await transition(
    c.env.DB,
    'application',
    id,
    'rejected',
    'Rejected during review',
  );

  return c.json({ ok: true });
});

// 6. GET /api/applications: Search and filter applications
app.get('/api/applications', async (c) => {
  const status = c.req.query('status') || null;
  const channel = c.req.query('channel') || null;
  const source = c.req.query('source') || null;
  const company = c.req.query('company') || null;
  const search = c.req.query('search') || null;
  const limit = Math.min(Number.parseInt(c.req.query('limit') || '50', 10), 200);
  const offset = Math.max(Number.parseInt(c.req.query('offset') || '0', 10), 0);

  const searchPattern = search ? `%${search.toLowerCase()}%` : null;
  const companyPattern = company ? `%${company.toLowerCase()}%` : null;

  const { results: rawRows } = await c.env.DB.prepare(
    `SELECT
       a.id, a.job_id, a.kind, a.channel, a.status, a.scheduled_at, a.sent_at, a.applied_at,
       a.resume_id, a.cover_letter, a.subject, a.retry_count, a.follow_up_count, a.notes,
       a.validator_errors, a.synced_at, a.updated_at,
       j.title, j.company, j.location, j.source, j.source_kind, j.contact_email, j.match_score, j.apply_route
     FROM applications a
     JOIN jobs j ON a.job_id = j.id
     WHERE (? IS NULL OR a.status = ?)
       AND (? IS NULL OR a.channel = ?)
       AND (? IS NULL OR j.source = ?)
       AND (? IS NULL OR LOWER(j.company) LIKE ?)
       AND (? IS NULL OR (LOWER(j.title) LIKE ? OR LOWER(j.company) LIKE ?))
     ORDER BY a.updated_at DESC
     LIMIT ? OFFSET ?`,
  )
    .bind(
      status,
      status,
      channel,
      channel,
      source,
      source,
      companyPattern,
      companyPattern,
      searchPattern,
      searchPattern,
      searchPattern,
      limit,
      offset,
    )
    .all();

  return c.json({ items: rawRows || [] });
});

// 7. GET /api/sources: Source circuit and parser health
app.get('/api/sources', async (c) => {
  const { results: rawRows } = await c.env.DB.prepare(
    `SELECT source, consecutive_failures, circuit_state, opened_at, last_run_at, error, parser_empty_streak, untrusted
     FROM source_state
     ORDER BY source ASC`,
  ).all();

  const sources = (rawRows || []).map((row: any) => ({
    ...row,
    parser_suspect: (row.parser_empty_streak ?? 0) >= 3 || Boolean(row.untrusted),
  }));

  return c.json({ sources });
});

// 8. GET /api/settings: Profile, Dry Run, Kill Switch, Resumes
app.get('/api/settings', async (c) => {
  const env = c.get('validatedEnv');
  const profileRow = await c.env.DB.prepare('SELECT data FROM profile WHERE id = ?')
    .bind('default')
    .first<{ data: string }>();

  let profile = null;
  if (profileRow?.data) {
    try {
      profile = JSON.parse(profileRow.data);
    } catch {
      // fallback
    }
  }

  const { results: rawResumes } = await c.env.DB.prepare(
    'SELECT id, label, tags, is_default, created_at FROM resumes ORDER BY created_at DESC',
  ).all();

  const kvKillSwitch =
    (await c.env.CONFIG.get('kill_switch')) === 'true' ||
    (await c.env.CONFIG.get('KILL_SWITCH')) === 'true';
  const killSwitch = kvKillSwitch || env.KILL_SWITCH;

  const kvDryRun = await c.env.CONFIG.get('DRY_RUN');
  const dryRun = kvDryRun !== null ? kvDryRun === 'true' : env.DRY_RUN;

  return c.json({
    profile,
    resumes: rawResumes || [],
    dryRun,
    killSwitch,
  });
});

// 9. POST /api/settings: Validates and updates profile settings
app.post('/api/settings', async (c) => {
  const body = await c.req
    .json<{ profile?: unknown }>()
    .catch(() => ({}) as { profile?: unknown });

  if (!body.profile || typeof body.profile !== 'object') {
    return c.json({ error: 'Missing profile object in request body' }, 400);
  }

  let validatedProfile;
  try {
    validatedProfile = ProfileSchema.parse(body.profile);
  } catch (err: any) {
    return c.json({ error: `Invalid profile settings: ${err.message}` }, 400);
  }

  const nowIso = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT OR REPLACE INTO profile (id, data, updated_at) VALUES (?, ?, ?)`,
  )
    .bind('default', JSON.stringify(validatedProfile), nowIso)
    .run();

  await c.env.DB.prepare(
    `INSERT INTO events (id, entity, entity_id, type, payload, created_at)
     VALUES (?, 'settings', 'profile', 'profile_updated', ?, ?)`,
  )
    .bind(crypto.randomUUID(), JSON.stringify({ name: validatedProfile.name }), nowIso)
    .run();

  return c.json({ ok: true, profile: validatedProfile });
});

// 10. POST /api/settings/dry-run: Toggles DRY_RUN
app.post('/api/settings/dry-run', async (c) => {
  const body = await c.req
    .json<{ dry_run?: boolean }>()
    .catch(() => ({}) as { dry_run?: boolean });
  if (typeof body.dry_run !== 'boolean') {
    return c.json({ error: 'Missing or invalid dry_run boolean' }, 400);
  }

  await c.env.CONFIG.put('DRY_RUN', body.dry_run ? 'true' : 'false');

  const nowIso = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO events (id, entity, entity_id, type, payload, created_at)
     VALUES (?, 'settings', 'dry_run', 'dry_run_toggled', ?, ?)`,
  )
    .bind(crypto.randomUUID(), JSON.stringify({ dry_run: body.dry_run }), nowIso)
    .run();

  return c.json({ ok: true, dryRun: body.dry_run });
});

// 11. POST /api/settings/kill-switch: Toggles KILL SWITCH with confirmation
app.post('/api/settings/kill-switch', async (c) => {
  const body = await c.req
    .json<{ kill_switch?: boolean; confirmed?: boolean }>()
    .catch(() => ({}) as { kill_switch?: boolean; confirmed?: boolean });

  if (typeof body.kill_switch !== 'boolean') {
    return c.json({ error: 'Missing or invalid kill_switch boolean' }, 400);
  }

  if (body.confirmed !== true) {
    return c.json({ error: 'Kill switch toggle requires confirmation' }, 400);
  }

  const val = body.kill_switch ? 'true' : 'false';
  await c.env.CONFIG.put('kill_switch', val);
  await c.env.CONFIG.put('KILL_SWITCH', val);

  const nowIso = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO events (id, entity, entity_id, type, payload, created_at)
     VALUES (?, 'settings', 'kill_switch', 'kill_switch_toggled', ?, ?)`,
  )
    .bind(crypto.randomUUID(), JSON.stringify({ kill_switch: body.kill_switch }), nowIso)
    .run();

  return c.json({ ok: true, killSwitch: body.kill_switch });
});

// 12. GET /api/events: Searchable audit log
app.get('/api/events', async (c) => {
  const search = c.req.query('search') || null;
  const entity = c.req.query('entity') || null;
  const type = c.req.query('type') || null;
  const limit = Math.min(Number.parseInt(c.req.query('limit') || '50', 10), 200);
  const offset = Math.max(Number.parseInt(c.req.query('offset') || '0', 10), 0);

  const searchPattern = search ? `%${search.toLowerCase()}%` : null;

  const { results: rawEvents } = await c.env.DB.prepare(
    `SELECT id, entity, entity_id, type, payload, created_at
     FROM events
     WHERE (? IS NULL OR entity = ?)
       AND (? IS NULL OR type = ?)
       AND (? IS NULL OR (LOWER(entity_id) LIKE ? OR LOWER(type) LIKE ? OR LOWER(payload) LIKE ?))
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
  )
    .bind(
      entity,
      entity,
      type,
      type,
      searchPattern,
      searchPattern,
      searchPattern,
      searchPattern,
      limit,
      offset,
    )
    .all();

  return c.json({ events: rawEvents || [] });
});

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Bindings): Promise<void> {
    const enabledSources = await getEnabledSources(env.CONFIG);
    for (const source of enabledSources) {
      await env.JOBS_QUEUE.send({ source });
    }
    // Housekeeping: expire 30-day-old manual_pending items
    await expireStaleManualPending(env.DB);
    // Send daily digest
    const notifier = createWorkerNotifier(env);
    await sendManualDailyDigest({ db: env.DB, notifier });

    // Sync to Google Sheet every cron run (10 min) if OAuth configured
    if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
      try {
        await env.JOBS_QUEUE.send({ action: 'sync_sheet' });
      } catch (err) {
        console.error('Error enqueuing scheduled sheet sync:', err);
      }
    }

    // Poll Gmail inbox every cron run (15 min) if OAuth configured
    if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
      try {
        await env.JOBS_QUEUE.send({ action: 'poll_inbox' });
      } catch (err) {
        console.error('Error enqueuing scheduled inbox poll:', err);
      }
    }

    // Daily Google Auth health ping if credentials configured
    if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
      try {
        const secrets: GoogleOAuthSecrets = {
          clientId: env.GOOGLE_CLIENT_ID as string,
          clientSecret: env.GOOGLE_CLIENT_SECRET as string,
          tokenEncryptionKey:
            (env.GOOGLE_TOKEN_ENCRYPTION_KEY as string) ||
            'default-pigeon-token-encryption-key-32b',
        };
        await pingGoogleAuthHealth({
          config: env.CONFIG,
          secrets,
          notifier,
        });
      } catch (err) {
        console.error('Error during scheduled Google auth health ping:', err);
      }
    }
  },
  async queue(batch: MessageBatch<unknown>, env: Bindings): Promise<void> {
    for (const msg of batch.messages) {
      const body = msg.body as { source?: string; action?: string };
      if (body && typeof body.source === 'string') {
        try {
          await ingestSource(body.source, {
            db: env.DB,
            kv: env.CONFIG,
            secrets: {
              ADZUNA_APP_ID: env.ADZUNA_APP_ID,
              ADZUNA_APP_KEY: env.ADZUNA_APP_KEY,
            },
          });
        } catch (err) {
          // Log error so that one source failure does not break other sources in the batch
          console.error(`Ingestion error for source ${body.source}:`, err);
        }
      } else if (body && body.action === 'score_and_route') {
        try {
          const profileRow = await env.DB.prepare('SELECT data FROM profile WHERE id = ?')
            .bind('default')
            .first<{ data: string }>();

          if (profileRow?.data) {
            const profile = ProfileSchema.parse(JSON.parse(profileRow.data));
            const llmClient = createLLMClient({
              provider: (env.LLM_PROVIDER as 'workers-ai' | 'gemini') || 'workers-ai',
              aiBinding: env.AI as CloudflareAiBinding | undefined,
              geminiApiKey: env.GEMINI_API_KEY,
            });
            const scorer = new DefaultScorer(llmClient);
            const maxScoredRaw = await env.CONFIG.get('MAX_SCORED_PER_DAY');
            const maxScoredPerDay = maxScoredRaw ? Number.parseInt(maxScoredRaw, 10) : 200;

            await processJobPipeline({
              db: env.DB,
              profile,
              scorer,
              config: { max_scored_per_day: maxScoredPerDay },
            });
          }
        } catch (err) {
          console.error('Error during score_and_route queue task:', err);
        }
      } else if (
        body &&
        body.action === 'create_application' &&
        typeof (body as { jobId?: string }).jobId === 'string'
      ) {
        try {
          const jobId = (body as { jobId: string }).jobId;
          const profileRow = await env.DB.prepare('SELECT data FROM profile WHERE id = ?')
            .bind('default')
            .first<{ data: string }>();

          if (profileRow?.data) {
            const profile = ProfileSchema.parse(JSON.parse(profileRow.data));
            const llmClient = createLLMClient({
              provider: (env.LLM_PROVIDER as 'workers-ai' | 'gemini') || 'workers-ai',
              ai: env.AI as CloudflareAiBinding | undefined,
              geminiApiKey: env.GEMINI_API_KEY,
            });
            const generator = new DefaultCoverLetterGenerator(llmClient);
            await ApplicationFactory.createForJob({
              db: env.DB,
              jobId,
              profile,
              generator,
            });
          }
        } catch (err) {
          console.error('Error during create_application queue task:', err);
        }
      } else if (
        body &&
        body.action === 'send_application' &&
        typeof (body as { applicationId?: string }).applicationId === 'string'
      ) {
        try {
          const applicationId = (body as { applicationId: string }).applicationId;
          const profileRow = await env.DB.prepare('SELECT data FROM profile WHERE id = ?')
            .bind('default')
            .first<{ data: string }>();

          if (profileRow?.data) {
            const profile = ProfileSchema.parse(JSON.parse(profileRow.data));
            const appRow = await env.DB.prepare(
              `SELECT
                 a.id, a.job_id, a.channel, a.status, a.cover_letter, a.subject,
                 a.resume_id, a.message_id_header, a.gmail_message_id, a.gmail_thread_id,
                 a.retry_count, j.title, j.company, j.company_normalized, j.contact_email
               FROM applications a
               JOIN jobs j ON a.job_id = j.id
               WHERE a.id = ?`,
            )
              .bind(applicationId)
              .first<ApplicationToSend>();

            if (appRow) {
              const secrets: GoogleOAuthSecrets = {
                clientId: (env.GOOGLE_CLIENT_ID as string) || 'client-id',
                clientSecret: (env.GOOGLE_CLIENT_SECRET as string) || 'client-secret',
                tokenEncryptionKey:
                  (env.GOOGLE_TOKEN_ENCRYPTION_KEY as string) ||
                  'default-pigeon-token-encryption-key-32b',
              };

              const notifier = createWorkerNotifier(env);
              const gmailSender = new RestGmailSender(() =>
                getValidAccessToken({
                  config: env.CONFIG,
                  secrets,
                  notifier,
                }),
              );

              const dryRunVal =
                typeof env.DRY_RUN === 'boolean' ? env.DRY_RUN : env.DRY_RUN !== 'false';
              const killSwitchVal =
                typeof env.KILL_SWITCH === 'boolean' ? env.KILL_SWITCH : env.KILL_SWITCH === 'true';

              await sendApplicationEmail({
                db: env.DB,
                config: env.CONFIG,
                resumesBucket: env.RESUMES,
                gmailSender,
                profile,
                notifier,
                dryRun: dryRunVal,
                killSwitch: killSwitchVal,
                application: appRow,
              });
            }
          }
        } catch (err) {
          console.error('Error during send_application queue task:', err);
        }
      } else if (body && body.action === 'sync_sheet') {
        try {
          const secrets: GoogleOAuthSecrets = {
            clientId: (env.GOOGLE_CLIENT_ID as string) || 'client-id',
            clientSecret: (env.GOOGLE_CLIENT_SECRET as string) || 'client-secret',
            tokenEncryptionKey:
              (env.GOOGLE_TOKEN_ENCRYPTION_KEY as string) ||
              'default-pigeon-token-encryption-key-32b',
          };

          const notifier = createWorkerNotifier(env);
          const sheetsClient = new RestSheetsClient(() =>
            getValidAccessToken({
              config: env.CONFIG,
              secrets,
              notifier,
            }),
          );

          await syncApplicationsToSheet({
            db: env.DB,
            config: env.CONFIG,
            sheetsClient,
            spreadsheetId: env.GOOGLE_SHEET_ID as string | undefined,
            notifier,
          });
        } catch (err) {
          console.error('Error during sync_sheet queue task:', err);
        }
      } else if (body && body.action === 'poll_inbox') {
        try {
          const profileRow = await env.DB.prepare('SELECT data FROM profile WHERE id = ?')
            .bind('default')
            .first<{ data: string }>();

          if (profileRow?.data) {
            const profile = ProfileSchema.parse(JSON.parse(profileRow.data));
            const secrets: GoogleOAuthSecrets = {
              clientId: (env.GOOGLE_CLIENT_ID as string) || 'client-id',
              clientSecret: (env.GOOGLE_CLIENT_SECRET as string) || 'client-secret',
              tokenEncryptionKey:
                (env.GOOGLE_TOKEN_ENCRYPTION_KEY as string) ||
                'default-pigeon-token-encryption-key-32b',
            };

            const notifier = createWorkerNotifier(env);
            const gmailSender = new RestGmailSender(() =>
              getValidAccessToken({
                config: env.CONFIG,
                secrets,
                notifier,
              }),
            );

            let llmClient = undefined;
            if (env.AI || env.GEMINI_API_KEY) {
              try {
                llmClient = createLLMClient({
                  provider: (env.LLM_PROVIDER as 'workers-ai' | 'gemini') || 'workers-ai',
                  aiBinding: env.AI as CloudflareAiBinding | undefined,
                  geminiApiKey: env.GEMINI_API_KEY,
                });
              } catch {
                // Fallback to deterministic rules
              }
            }

            const result = await pollInboxAndTrackOutcomes({
              db: env.DB,
              config: env.CONFIG,
              gmailSender,
              profile,
              notifier,
              llmClient,
            });

            if (result.bouncedCount > 0 || result.repliedCount > 0 || result.followUpsCreated > 0) {
              try {
                await env.JOBS_QUEUE.send({ action: 'sync_sheet' });
              } catch {
                // Non-fatal
              }
            }
          }
        } catch (err) {
          console.error('Error during poll_inbox queue task:', err);
        }
      }
      msg.ack();
    }
  },
  async email(
    message: ForwardableEmailMessage,
    env: Bindings,
    _ctx?: ExecutionContext,
  ): Promise<void> {
    let configuredForwardingAddress =
      typeof env.ALERT_FORWARDING_ADDRESS === 'string' ? env.ALERT_FORWARDING_ADDRESS : undefined;

    if (!configuredForwardingAddress) {
      const profileRow = await env.DB.prepare('SELECT data FROM profile WHERE id = ?')
        .bind('default')
        .first<{ data: string }>();

      if (profileRow?.data) {
        try {
          const profile = JSON.parse(profileRow.data) as { email?: string };
          if (profile.email) {
            configuredForwardingAddress = profile.email;
          }
        } catch {
          // Ignore JSON parse errors in profile
        }
      }
    }

    const notifier = createWorkerNotifier(env);

    await ingestAlertEmail(message.raw, {
      db: env.DB,
      envelope: {
        from: message.from,
        to: message.to,
        headers: message.headers,
      },
      configuredForwardingAddress,
      notifier,
    });
  },
};
