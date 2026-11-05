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
  getValidAccessToken,
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

  const notifier = new EventsNotifier(c.env.DB);
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

  const notifier = new EventsNotifier(c.env.DB);
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

  return c.json({ ok: true, success: true });
});

app.post('/api/applications/approve-bulk', async (c) => {
  const body = await c.req.json<{ ids?: string[] }>().catch(() => ({}) as { ids?: string[] });

  if (!body.ids || !Array.isArray(body.ids)) {
    return c.json({ error: "Missing required 'ids' array in body" }, 400);
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
    ids: body.ids,
    profile,
  });

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

  const notifier = new EventsNotifier(c.env.DB);
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

  return c.json({ ok: result.success, ...result });
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
    const notifier = new EventsNotifier(env.DB);
    await sendManualDailyDigest({ db: env.DB, notifier });

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

              const notifier = new EventsNotifier(env.DB);
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

    const notifier = new EventsNotifier(env.DB);

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
