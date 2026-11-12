import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
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
  setGoogleAuthHealth,
  pingGoogleAuthHealth,
  approveApplication,
  bulkApproveApplications,
  canBulkApprove,
  getTokenKey,
  sendApplicationEmail,
  RestGmailSender,
  RestSheetsClient,
  syncApplicationsToSheet,
  getValidAccessToken,
  pollInboxAndTrackOutcomes,
  verifyCfAccessJwt,
  calculateEffectiveCap,
  calculateFailureRate,
  checkFailureRateAlert,
  transition,
  TelegramNotifier,
  KILL_SWITCH_KV_KEY,
  DRY_RUN_KV_KEY,
  isKillSwitchActive,
  getEffectiveDryRun,
  createPendingFollowUps,
  seedLocalData,
  logger,
  purgeExpiredJobDescriptions,
  getConfig,
  setAppSetting,
  deleteAppSetting,
  invalidateConfigCache,
  validateSettingValue,
  getMasterKey,
  MIGRATED_SETTING_KEYS,
  SETTING_DEFINITIONS,
  type MigratedSettingKey,
  type AppConfig,
  type Notifier,
  type NotificationPayload,
  type CloudflareAiBinding,
  type GoogleOAuthSecrets,
  type ApplicationToSend,
  type Profile,
  MAX_RESUMES_COUNT,
  RESUME_TAG_REGEX,
  normalizeResumeTags,
  formatContentDisposition,
  UpdateResumeSchema,
  ReassignResumeSchema,
  type ResumeSummary,
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
  const path = c.req.path;
  if (path.startsWith('/api') || path.startsWith('/auth')) {
    const envMode = c.env.ENV;
    if (!envMode || !['dev', 'staging', 'prod'].includes(envMode)) {
      return c.json({ error: 'Service Unavailable: Missing or invalid ENV configuration' }, 503);
    }
    if (envMode === 'staging' || envMode === 'prod') {
      if (
        !c.env.CF_ACCESS_AUD ||
        !c.env.CF_ACCESS_TEAM_DOMAIN ||
        !c.env.CF_ACCESS_ALLOWED_EMAIL ||
        !c.env.OWNER_GMAIL
      ) {
        return c.json(
          { error: 'Service Unavailable: Cloudflare Access or Owner configuration missing' },
          503,
        );
      }
    }
  }

  const validated = validateWorkerEnv(c.env);
  c.set('validatedEnv', validated);
  await next();
});

// -------------------------------------------------------------
// Body Size Limit Middleware: 1 MB on JSON routes, 5 MB on /api/resumes (HTTP 413)
// -------------------------------------------------------------
app.use('*', async (c, next) => {
  if (c.req.method === 'GET' || c.req.method === 'HEAD' || c.req.method === 'OPTIONS') {
    return next();
  }
  const isResumeUpload = c.req.path === '/api/resumes' || c.req.path.startsWith('/api/resumes/');
  const maxSize = isResumeUpload ? 5 * 1024 * 1024 : 1024 * 1024;
  return bodyLimit({
    maxSize,
    onError: (ctx) =>
      ctx.json({ ok: false, code: 'PAYLOAD_TOO_LARGE', error: 'Payload Too Large' }, 413),
  })(c, next);
});

export const ManualBulkActionRequestSchema = z.object({
  ids: z.array(z.string().max(100)).min(1).max(100),
  action: z.enum(['applied', 'skip']),
  reason: z.string().max(500).optional(),
  note: z.string().max(2000).optional(),
});

export const BulkApproveRequestSchema = z
  .object({
    ids: z.array(z.string().max(100)).max(100).optional(),
    application_ids: z.array(z.string().max(100)).max(100).optional(),
  })
  .refine((data) => Array.isArray(data.ids) || Array.isArray(data.application_ids), {
    message: "Missing required 'ids' or 'application_ids' array in body",
  });

// -------------------------------------------------------------
// Security Middleware: CORS, State-Changing Requests, CF Access
// -------------------------------------------------------------
app.use('*', async (c, next) => {
  const origin = c.req.header('origin') || '';
  const dashboardOrigin = (c.env.DASHBOARD_ORIGIN as string) || 'http://localhost:5173';

  // Allowed origins: dashboardOrigin, localhost dev/test origins, or matching request host
  let isHostMatch = false;
  try {
    if (origin) {
      isHostMatch = new URL(origin).host === new URL(c.req.url).host;
    }
  } catch {
    isHostMatch = false;
  }

  const allowedOrigins = [
    dashboardOrigin,
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:3000',
  ];
  const isAllowedOrigin = origin ? allowedOrigins.includes(origin) || isHostMatch : false;

  if (origin && isAllowedOrigin) {
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Access-Control-Allow-Credentials', 'true');
    c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    c.header(
      'Access-Control-Allow-Headers',
      'Content-Type, Cf-Access-Jwt-Assertion, Authorization',
    );
  }

  // Preflight
  if (c.req.method === 'OPTIONS') {
    return c.body(null, 204);
  }

  const path = c.req.path;
  const isStateChanging = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method);

  // State-changing endpoint Origin check
  if (isStateChanging && path.startsWith('/api/')) {
    if (!origin || !isAllowedOrigin) {
      return c.json({ error: 'Forbidden: Origin mismatch' }, 403);
    }

    // Require multipart/form-data for /api/resumes, and application/json for other mutations with bodies
    const contentType = c.req.header('content-type') || '';
    if (path === '/api/resumes') {
      if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
        return c.json({ error: 'Unsupported Media Type: expected multipart/form-data' }, 415);
      }
    } else if (path === '/api/dev/feed-eml') {
      // feed-eml receives raw RFC822 email content
    } else {
      const contentLength = c.req.header('content-length');
      const hasBody =
        (contentLength !== undefined && contentLength !== '0') || c.req.raw.body !== null;
      if (hasBody && !contentType.includes('application/json')) {
        return c.json({ error: 'Unsupported Media Type: expected application/json' }, 415);
      }
    }
  }

  // Cloudflare Access JWT Assertion check for /api/* and /auth/*
  if (path.startsWith('/api') || path.startsWith('/auth')) {
    const envMode = c.env.ENV as string;
    const isDev = envMode === 'dev';
    const allowInsecureDevAuth =
      c.env.ALLOW_INSECURE_DEV_AUTH === true || c.env.ALLOW_INSECURE_DEV_AUTH === 'true';

    // Cloudflare Access JWT Assertion check for /api/* and /auth/google/*
    if (isDev && allowInsecureDevAuth) {
      // Skip the check only when ENV=dev AND ALLOW_INSECURE_DEV_AUTH=true
    } else {
      const cfAccessAud = (c.env.CF_ACCESS_AUD as string) || undefined;
      const cfAccessTeamDomain = (c.env.CF_ACCESS_TEAM_DOMAIN as string) || undefined;
      const cfAccessAllowedEmail = (c.env.CF_ACCESS_ALLOWED_EMAIL as string) || undefined;

      // If Cloudflare Access is unconfigured: fail closed (503)
      if (!cfAccessAud || !cfAccessTeamDomain) {
        return c.json({ error: 'Service Unavailable: Cloudflare Access not configured' }, 503);
      }

      const assertion = c.req.header('cf-access-jwt-assertion');
      if (!assertion) {
        return c.json({ error: 'Unauthorized: Missing Cf-Access-Jwt-Assertion header' }, 401);
      }

      const verifyRes = await verifyCfAccessJwt(assertion, {
        teamDomain: cfAccessTeamDomain,
        audience: cfAccessAud,
        allowedEmail: cfAccessAllowedEmail,
      });

      if (!verifyRes.valid) {
        return c.json({ error: `Unauthorized: ${verifyRes.reason || 'Invalid Access JWT'}` }, 401);
      }
    }
  }

  await next();
});

export async function createWorkerNotifier(env: Bindings, config?: AppConfig): Promise<Notifier> {
  const eventsNotifier = new EventsNotifier(env.DB);
  const appConfig = config ?? (await getConfig(env, env.DB));
  const telegram = appConfig.getTelegramConfig();
  if (telegram.botToken && telegram.chatId) {
    const telegramNotifier = new TelegramNotifier({
      botToken: telegram.botToken,
      chatId: telegram.chatId,
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
  const contentType = c.req.header('content-type') || '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    return c.json({ error: 'Unsupported Media Type: expected multipart/form-data' }, 415);
  }

  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return c.json({ error: 'Failed to parse multipart form data' }, 400);
  }
  const file = formData.get('file');

  if (!file || typeof file === 'string' || !(file instanceof Blob)) {
    return c.json({ error: 'Missing or invalid file' }, 400);
  }

  // Enforce 5 MB limit on streamed bytes
  const arrayBuffer = await file.arrayBuffer();
  if (arrayBuffer.byteLength > 5 * 1024 * 1024) {
    return c.json(
      { ok: false, code: 'PAYLOAD_TOO_LARGE', error: 'File size exceeds 5 MB limit' },
      413,
    );
  }

  if (arrayBuffer.byteLength === 0) {
    return c.json(
      { ok: false, code: 'EMPTY_FILE', error: 'Empty file: uploaded file contains 0 bytes' },
      400,
    );
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
    return c.json(
      { ok: false, code: 'INVALID_PDF', error: 'Invalid file: only PDF documents are allowed' },
      400,
    );
  }

  // Invariant: Maximum 20 resumes
  const activeCountRow = await c.env.DB.prepare(
    'SELECT count(*) as count FROM resumes WHERE archived = 0',
  ).first<{ count: number }>();
  const activeCount = activeCountRow?.count ?? 0;
  if (activeCount >= MAX_RESUMES_COUNT) {
    return c.json(
      {
        ok: false,
        code: 'RESUME_LIMIT_REACHED',
        error: `Maximum limit of ${MAX_RESUMES_COUNT} resumes reached`,
      },
      400,
    );
  }

  // Label handling: required, trimmed, max 80 chars
  const labelRaw = formData.get('label');
  const fileName =
    'name' in file && typeof (file as { name?: unknown }).name === 'string'
      ? (file as { name: string }).name.replace(/\.pdf$/i, '').trim()
      : '';
  const candidateLabel =
    typeof labelRaw === 'string' && labelRaw.trim() ? labelRaw.trim() : fileName || 'Resume';

  if (!candidateLabel || candidateLabel.length > 80) {
    return c.json(
      {
        ok: false,
        code: 'INVALID_LABEL',
        error: 'Resume label is required and must be between 1 and 80 characters',
      },
      400,
    );
  }
  const label = candidateLabel;

  // Tags handling: normalized, max 10 tags, max 24 chars, regex [a-z0-9+#._-]
  const tags = normalizeResumeTags(formData.get('tags'));
  for (const tag of tags) {
    if (!RESUME_TAG_REGEX.test(tag) || tag.length > 24) {
      return c.json(
        {
          ok: false,
          code: 'INVALID_TAGS',
          error: `Invalid tag '${tag}': tags must be lowercase alphanumeric with + # . _ - and max 24 chars`,
        },
        400,
      );
    }
  }
  if (tags.length > 10) {
    return c.json({ ok: false, code: 'TOO_MANY_TAGS', error: 'Maximum 10 tags allowed' }, 400);
  }

  // Invariant: The first uploaded resume is automatically the default
  const isDefaultRaw = formData.get('is_default') === 'true' || formData.get('is_default') === '1';
  const isDefault = activeCount === 0 ? true : isDefaultRaw;

  // Key generation: server-generated UUID only, never the client filename
  const id = crypto.randomUUID();
  const r2Key = `resumes/${id}.pdf`;
  const now = new Date().toISOString();

  // Store in R2
  await c.env.RESUMES.put(r2Key, arrayBuffer, {
    httpMetadata: { contentType: 'application/pdf' },
  });

  // Single D1 batch for default switch + insert + events
  const batchStatements = [];
  if (isDefault) {
    batchStatements.push(
      c.env.DB.prepare('UPDATE resumes SET is_default = 0 WHERE is_default = 1'),
    );
  }
  batchStatements.push(
    c.env.DB.prepare(
      `INSERT INTO resumes (id, label, r2_key, tags, is_default, size_bytes, archived, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
    ).bind(id, label, r2Key, JSON.stringify(tags), isDefault ? 1 : 0, arrayBuffer.byteLength, now),
  );
  batchStatements.push(
    c.env.DB.prepare(
      `INSERT INTO events (id, entity, entity_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      'resume',
      id,
      'resume_uploaded',
      JSON.stringify({ id, label }),
      now,
    ),
  );
  if (isDefault) {
    batchStatements.push(
      c.env.DB.prepare(
        `INSERT INTO events (id, entity, entity_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        'resume',
        id,
        'resume_default_changed',
        JSON.stringify({ id, label }),
        now,
      ),
    );
  }

  await c.env.DB.batch(batchStatements);

  return c.json(
    {
      ok: true,
      resume: {
        id,
        label,
        r2_key: r2Key,
        tags,
        is_default: isDefault,
        size_bytes: arrayBuffer.byteLength,
        archived: false,
        created_at: now,
        usage: { open: 0, sent: 0 },
        download_url: `/api/resumes/${id}/download`,
      },
    },
    201,
  );
});

// GET /api/resumes: list available resumes with usage counts
app.get('/api/resumes', async (c) => {
  const { results } = await c.env.DB.prepare(
    `
    SELECT 
      r.id, r.label, r.r2_key, r.tags, r.is_default, r.size_bytes, r.archived, r.created_at,
      COUNT(CASE WHEN a.status IN ('draft', 'needs_review', 'approved', 'sending') THEN 1 END) as open_count,
      COUNT(CASE WHEN a.status NOT IN ('draft', 'needs_review', 'approved', 'sending') AND a.id IS NOT NULL THEN 1 END) as sent_count
    FROM resumes r
    LEFT JOIN applications a ON a.resume_id = r.id
    GROUP BY r.id
    ORDER BY r.archived ASC, r.is_default DESC, r.created_at DESC
  `,
  ).all<{
    id: string;
    label: string;
    r2_key: string;
    tags: string;
    is_default: number;
    size_bytes: number;
    archived: number;
    created_at: string;
    open_count: number;
    sent_count: number;
  }>();

  const resumeList: ResumeSummary[] = (results || []).map((row) => ({
    id: row.id,
    label: row.label,
    tags: normalizeResumeTags(row.tags),
    is_default: Boolean(row.is_default),
    size_bytes: Number(row.size_bytes || 0),
    created_at: row.created_at,
    archived: Boolean(row.archived),
    usage: {
      open: Number(row.open_count || 0),
      sent: Number(row.sent_count || 0),
    },
    download_url: `/api/resumes/${row.id}/download`,
  }));

  return c.json({ ok: true, resumes: resumeList });
});

// PATCH /api/resumes/:id: edit label, tags and is_default
app.patch('/api/resumes/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));

  const parsed = UpdateResumeSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        ok: false,
        code: 'INVALID_INPUT',
        error: parsed.error.issues[0]?.message || 'Invalid resume update',
      },
      400,
    );
  }

  const existing = await c.env.DB.prepare(
    'SELECT id, label, tags, is_default, size_bytes, archived, created_at FROM resumes WHERE id = ?',
  )
    .bind(id)
    .first<{
      id: string;
      label: string;
      tags: string;
      is_default: number;
      size_bytes: number;
      archived: number;
      created_at: string;
    }>();

  if (!existing) {
    return c.json({ ok: false, code: 'RESUME_NOT_FOUND', error: 'Resume not found' }, 404);
  }

  if (existing.archived) {
    return c.json(
      { ok: false, code: 'RESUME_ARCHIVED', error: 'Cannot update an archived resume' },
      400,
    );
  }

  // Invariant: cannot unset the only default resume
  if (parsed.data.is_default === false && existing.is_default === 1) {
    return c.json(
      {
        ok: false,
        code: 'CANNOT_UNSET_DEFAULT',
        error: 'Cannot unset default resume. Set another resume as default instead.',
      },
      400,
    );
  }

  const newLabel = parsed.data.label !== undefined ? parsed.data.label : existing.label;
  const newTags =
    parsed.data.tags !== undefined ? parsed.data.tags : normalizeResumeTags(existing.tags);
  const newDefault =
    parsed.data.is_default !== undefined ? parsed.data.is_default : Boolean(existing.is_default);

  const defaultChanging = newDefault && !existing.is_default;
  const now = new Date().toISOString();

  const batch = [];
  if (defaultChanging) {
    batch.push(c.env.DB.prepare('UPDATE resumes SET is_default = 0 WHERE is_default = 1'));
  }
  batch.push(
    c.env.DB.prepare('UPDATE resumes SET label = ?, tags = ?, is_default = ? WHERE id = ?').bind(
      newLabel,
      JSON.stringify(newTags),
      newDefault ? 1 : 0,
      id,
    ),
  );
  batch.push(
    c.env.DB.prepare(
      'INSERT INTO events (id, entity, entity_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(
      crypto.randomUUID(),
      'resume',
      id,
      'resume_updated',
      JSON.stringify({ id, label: newLabel }),
      now,
    ),
  );
  if (defaultChanging) {
    batch.push(
      c.env.DB.prepare(
        'INSERT INTO events (id, entity, entity_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).bind(
        crypto.randomUUID(),
        'resume',
        id,
        'resume_default_changed',
        JSON.stringify({ id, label: newLabel }),
        now,
      ),
    );
  }

  await c.env.DB.batch(batch);

  return c.json({
    ok: true,
    resume: {
      id,
      label: newLabel,
      tags: newTags,
      is_default: newDefault,
      size_bytes: existing.size_bytes,
      archived: Boolean(existing.archived),
      created_at: existing.created_at,
      download_url: `/api/resumes/${id}/download`,
    },
  });
});

// DELETE /api/resumes/:id: delete or archive according to invariants & usage
app.delete('/api/resumes/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare(
    'SELECT id, label, r2_key, is_default, archived FROM resumes WHERE id = ?',
  )
    .bind(id)
    .first<{ id: string; label: string; r2_key: string; is_default: number; archived: number }>();

  if (!existing) {
    return c.json({ ok: false, code: 'RESUME_NOT_FOUND', error: 'Resume not found' }, 404);
  }

  // Invariant: The default resume cannot be deleted or archived while it is the only one.
  // Deleting the default while others exist is refused until another is made default.
  if (existing.is_default === 1) {
    const activeRow = await c.env.DB.prepare(
      'SELECT count(*) as count FROM resumes WHERE archived = 0',
    ).first<{ count: number }>();
    const activeCount = activeRow?.count ?? 0;

    if (activeCount <= 1) {
      return c.json(
        {
          ok: false,
          code: 'CANNOT_DELETE_ONLY_DEFAULT',
          error: 'The default resume cannot be deleted or archived while it is the only one.',
        },
        400,
      );
    }
    return c.json(
      {
        ok: false,
        code: 'CANNOT_DELETE_DEFAULT',
        error: 'Deleting the default while others exist is refused until another is made default.',
      },
      409,
    );
  }

  // Check applications referencing this resume
  const usageRow = await c.env.DB.prepare(
    `
    SELECT 
      COUNT(CASE WHEN status IN ('draft', 'needs_review', 'approved', 'sending') THEN 1 END) as open_count,
      COUNT(CASE WHEN status NOT IN ('draft', 'needs_review', 'approved', 'sending') THEN 1 END) as sent_count
    FROM applications WHERE resume_id = ?
  `,
  )
    .bind(id)
    .first<{ open_count: number; sent_count: number }>();

  const openCount = usageRow?.open_count ?? 0;
  const sentCount = usageRow?.sent_count ?? 0;
  const now = new Date().toISOString();

  // Rule 1: If open applications reference it -> return 409
  if (openCount > 0) {
    return c.json(
      {
        ok: false,
        code: 'RESUME_IN_USE',
        message: `Cannot delete resume referenced by ${openCount} open application(s).`,
        openCount,
        sentCount,
      },
      409,
    );
  }

  // Rule 2: If only sent or terminal applications reference it -> archive (soft delete)
  if (sentCount > 0) {
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE resumes SET archived = 1, is_default = 0 WHERE id = ?').bind(id),
      c.env.DB.prepare(
        'INSERT INTO events (id, entity, entity_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).bind(
        crypto.randomUUID(),
        'resume',
        id,
        'resume_archived',
        JSON.stringify({ id, label: existing.label }),
        now,
      ),
    ]);
    return c.json({ ok: true, action: 'archived', id, label: existing.label, sentCount });
  }

  // Rule 3: If nothing references it -> hard delete
  await c.env.RESUMES.delete(existing.r2_key);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM resumes WHERE id = ?').bind(id),
    c.env.DB.prepare(
      'INSERT INTO events (id, entity, entity_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(
      crypto.randomUUID(),
      'resume',
      id,
      'resume_deleted',
      JSON.stringify({ id, label: existing.label }),
      now,
    ),
  ]);

  return c.json({ ok: true, action: 'deleted', id, label: existing.label });
});

// POST /api/resumes/:id/reassign: bulk reassign open applications to another resume
app.post('/api/resumes/:id/reassign', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const parsed = ReassignResumeSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { ok: false, error: parsed.error.issues[0]?.message || 'Invalid reassign request' },
      400,
    );
  }

  const targetId = parsed.data.target_resume_id;
  if (targetId === id) {
    return c.json({ ok: false, error: 'Target resume must be different from source resume' }, 400);
  }

  // Verify target resume exists and is active
  const targetResume = await c.env.DB.prepare(
    'SELECT id, label, archived FROM resumes WHERE id = ?',
  )
    .bind(targetId)
    .first<{ id: string; label: string; archived: number }>();

  if (!targetResume || targetResume.archived) {
    return c.json({ ok: false, error: 'Target resume not found or is archived' }, 404);
  }

  // Find all open applications for source resume
  const { results: openApps } = await c.env.DB.prepare(
    `SELECT id, status FROM applications WHERE resume_id = ? AND status IN ('draft', 'needs_review', 'approved', 'sending')`,
  )
    .bind(id)
    .all<{ id: string; status: string }>();

  if (!openApps || openApps.length === 0) {
    return c.json({ ok: true, reassignedCount: 0, message: 'No open applications to reassign' });
  }

  // Check if any application is currently in-flight (sending)
  if (openApps.some((a) => a.status === 'sending')) {
    return c.json(
      {
        ok: false,
        code: 'APPLICATION_SENDING',
        error: 'Cannot reassign resume while application is in sending status.',
      },
      409,
    );
  }

  // For approved applications, transition back to draft through state-machine helper
  for (const app of openApps) {
    if (app.status === 'approved') {
      await transition(
        c.env.DB,
        'application',
        app.id,
        'draft',
        'Resume reassigned - moved to draft for review',
      );
    }
  }

  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE applications SET resume_id = ?, updated_at = ? WHERE resume_id = ? AND status IN ('draft', 'needs_review')`,
  )
    .bind(targetId, now, id)
    .run();

  await c.env.DB.prepare(
    'INSERT INTO events (id, entity, entity_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(
      crypto.randomUUID(),
      'resume',
      id,
      'resume_reassigned',
      JSON.stringify({ id, target_resume_id: targetId, count: openApps.length }),
      now,
    )
    .run();

  return c.json({ ok: true, reassignedCount: openApps.length, target_resume_id: targetId });
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

// GET /api/events with search & filters
app.get('/api/events', async (c) => {
  const entity = c.req.query('entity') || null;
  const entityId = c.req.query('entity_id') || null;
  const type = c.req.query('type') || null;
  const search = c.req.query('search') || null;
  const limitParam = parseInt(c.req.query('limit') || '50', 10);
  const limit = Math.min(Math.max(1, isNaN(limitParam) ? 50 : limitParam), 200);
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
  if (search) {
    const searchPattern = `%${search.toLowerCase()}%`;
    conditions.push('(LOWER(entity_id) LIKE ? OR LOWER(type) LIKE ? OR LOWER(payload) LIKE ?)');
    params.push(searchPattern, searchPattern, searchPattern);
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

  return c.json({ ok: true, events: formattedEvents });
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
  const appConfig = await getConfig(c.env, c.env.DB);
  const llmConfig = appConfig.getLlmConfig();

  const llmClient = createLLMClient({
    provider: llmConfig.provider,
    ai: c.env.AI as CloudflareAiBinding | undefined,
    geminiApiKey: llmConfig.geminiApiKey,
    model: llmConfig.model,
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
  const appConfig = await getConfig(c.env, c.env.DB);
  const llmConfig = appConfig.getLlmConfig();

  const llmClient = createLLMClient({
    provider: llmConfig.provider,
    ai: c.env.AI as CloudflareAiBinding | undefined,
    geminiApiKey: llmConfig.geminiApiKey,
    model: llmConfig.model,
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

// PUT & PATCH /api/applications/:id/letter: Edits an application's cover letter and re-runs validation
const handleUpdateCoverLetter = async (
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
) => {
  const id = c.req.param('id');
  if (!id) {
    return c.json({ error: 'Missing application id' }, 400);
  }
  const body = await c.req
    .json<{ cover_letter?: string; subject?: string }>()
    .catch(() => ({}) as { cover_letter?: string; subject?: string });

  if (!body.cover_letter || typeof body.cover_letter !== 'string') {
    return c.json({ error: 'Missing required field: cover_letter' }, 400);
  }

  const profileRow = await c.env.DB.prepare('SELECT data FROM profile WHERE id = ?')
    .bind('default')
    .first<{ data: string }>();

  if (!profileRow?.data) {
    return c.json({ error: 'Profile not configured' }, 400);
  }

  const profile = ProfileSchema.parse(JSON.parse(profileRow.data));

  let result;
  try {
    result = await ApplicationFactory.updateCoverLetter({
      db: c.env.DB,
      applicationId: id,
      coverLetter: body.cover_letter,
      subject: body.subject,
      profile,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('not found')) {
      return c.json({ error: msg }, 404);
    }
    return c.json({ error: msg }, 500);
  }

  const nowIso = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO events (id, entity, entity_id, type, payload, created_at)
     VALUES (?, 'application', ?, 'cover_letter_edited', ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      id,
      JSON.stringify({ error_count: result.errors.length, errors: result.errors }),
      nowIso,
    )
    .run();

  return c.json({
    ok: true,
    ...result,
    validator_errors: result.errors,
  });
};

app.put('/api/applications/:id/letter', handleUpdateCoverLetter);
app.patch('/api/applications/:id/letter', handleUpdateCoverLetter);

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
  const rawBody = await c.req.json().catch(() => ({}));
  const parseResult = ManualBulkActionRequestSchema.safeParse(rawBody);
  if (!parseResult.success) {
    return c.json(
      { error: "Invalid bulk action: requires 'ids' array and action 'applied' or 'skip'" },
      400,
    );
  }
  const body = parseResult.data;
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
    return c.json({ ok: false, error: 'Resume not found' }, 404);
  }

  const object = await c.env.RESUMES.get(resume.r2_key);
  if (!object) {
    return c.json({ ok: false, error: 'Resume file not found in storage' }, 404);
  }

  const dispositionType = c.req.query('disposition') === 'inline' ? 'inline' : 'attachment';
  c.header('Content-Type', 'application/pdf');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Cache-Control', 'private, no-store');
  c.header('Content-Disposition', formatContentDisposition(resume.label, dispositionType));
  return c.body(object.body);
});

// -------------------------------------------------------------
// Google OAuth & Auth Health Routes
// -------------------------------------------------------------

app.get('/auth/google/start', async (c) => {
  const appConfig = await getConfig(c.env, c.env.DB);
  const googleOAuth = appConfig.getGoogleOAuth();
  if (!googleOAuth.clientId || !googleOAuth.clientSecret) {
    return c.json(
      {
        error:
          'Missing required Google OAuth credentials: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured',
      },
      503,
    );
  }

  const redirectUri =
    googleOAuth.redirectUri || new URL('/auth/google/callback', c.req.url).toString();
  const state = crypto.randomUUID();

  // Store state in KV for 10 minutes (600s), single use
  await c.env.CONFIG.put(`oauth_state:${state}`, 'valid', { expirationTtl: 600 });

  const authUrl = getGoogleAuthUrl({
    clientId: googleOAuth.clientId,
    redirectUri,
    state,
  });

  return c.redirect(authUrl, 302);
});

app.get('/auth/google/callback', async (c) => {
  const env = c.get('validatedEnv');
  const code = c.req.query('code');
  const state = c.req.query('state');
  const error = c.req.query('error');

  if (error) {
    return c.json({ error: `Google OAuth error: ${error}` }, 400);
  }
  if (!state) {
    return c.json({ error: 'Missing OAuth state parameter' }, 400);
  }
  if (!code) {
    return c.json({ error: 'Missing authorization code' }, 400);
  }

  // Reject missing, wrong, reused or expired state
  const storedState = await c.env.CONFIG.get(`oauth_state:${state}`);
  if (!storedState) {
    return c.json({ error: 'Invalid, expired, or reused OAuth state' }, 400);
  }

  // Single-use: delete state immediately
  await c.env.CONFIG.delete(`oauth_state:${state}`);

  const appConfig = await getConfig(c.env, c.env.DB);
  const googleOAuth = appConfig.getGoogleOAuth();
  if (!googleOAuth.clientId || !googleOAuth.clientSecret) {
    return c.json(
      {
        error:
          'Missing required Google OAuth credentials: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured',
      },
      503,
    );
  }

  let tokenEncryptionKey: string;
  try {
    tokenEncryptionKey = getTokenKey(c.env);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 503);
  }

  const redirectUri =
    googleOAuth.redirectUri || new URL('/auth/google/callback', c.req.url).toString();
  const secrets: GoogleOAuthSecrets = {
    clientId: googleOAuth.clientId,
    clientSecret: googleOAuth.clientSecret,
    tokenEncryptionKey,
    redirectUri,
  };

  const notifier = await createWorkerNotifier(c.env, appConfig);
  const ownerGmail = (c.env.OWNER_GMAIL as string) || env.OWNER_GMAIL || undefined;

  try {
    await completeGoogleAuthCallback({
      code,
      config: c.env.CONFIG,
      secrets,
      redirectUri,
      notifier,
      ownerGmail,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (errMsg.includes('does not match OWNER_GMAIL')) {
      return c.json({ error: `OAuth account email mismatch: ${errMsg}` }, 403);
    }
    return c.json({ error: `OAuth callback failed: ${errMsg}` }, 400);
  }

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
  const appConfig = await getConfig(c.env, c.env.DB, { fresh: true });
  const googleOAuth = appConfig.getGoogleOAuth();
  if (!googleOAuth.clientId || !googleOAuth.clientSecret) {
    return c.json(
      {
        error:
          'Missing required Google OAuth credentials: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured',
      },
      503,
    );
  }

  let tokenEncryptionKey: string;
  try {
    tokenEncryptionKey = getTokenKey(c.env);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 503);
  }

  const secrets: GoogleOAuthSecrets = {
    clientId: googleOAuth.clientId,
    clientSecret: googleOAuth.clientSecret,
    tokenEncryptionKey,
  };

  const notifier = await createWorkerNotifier(c.env, appConfig);
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

app.post('/api/applications/bulk-approve', async (c) => {
  const rawBody = await c.req.json().catch(() => null);
  const parseResult = BulkApproveRequestSchema.safeParse(rawBody);
  if (!parseResult.success) {
    return c.json({ error: "Missing required 'ids' or 'application_ids' array in body" }, 400);
  }
  const ids = parseResult.data.ids || parseResult.data.application_ids || [];

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

  let tokenEncryptionKey: string;
  try {
    tokenEncryptionKey = getTokenKey(c.env);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 503);
  }

  const appConfig = await getConfig(c.env, c.env.DB, { fresh: true });
  const googleOAuth = appConfig.getGoogleOAuth();
  if (!googleOAuth.clientId || !googleOAuth.clientSecret) {
    return c.json(
      {
        error:
          'Missing required Google OAuth credentials: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured',
      },
      503,
    );
  }

  const secrets: GoogleOAuthSecrets = {
    clientId: googleOAuth.clientId,
    clientSecret: googleOAuth.clientSecret,
    tokenEncryptionKey,
  };

  const notifier = await createWorkerNotifier(c.env, appConfig);
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
    env: env.ENV,
    devRecipientAllowlist: (c.env.DEV_RECIPIENT_ALLOWLIST as string) || undefined,
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
  let tokenEncryptionKey: string;
  try {
    tokenEncryptionKey = getTokenKey(c.env);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 503);
  }

  const appConfig = await getConfig(c.env, c.env.DB, { fresh: true });
  const googleOAuth = appConfig.getGoogleOAuth();
  if (!googleOAuth.clientId || !googleOAuth.clientSecret) {
    return c.json(
      {
        error:
          'Missing required Google OAuth credentials: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured',
      },
      503,
    );
  }

  const secrets: GoogleOAuthSecrets = {
    clientId: googleOAuth.clientId,
    clientSecret: googleOAuth.clientSecret,
    tokenEncryptionKey,
  };

  const notifier = await createWorkerNotifier(c.env, appConfig);
  const sheetsClient = new RestSheetsClient(() =>
    getValidAccessToken({
      config: c.env.CONFIG,
      secrets,
      notifier,
    }),
  );

  const sheetsConfig = appConfig.getSheetsConfig();
  const result = await syncApplicationsToSheet({
    db: c.env.DB,
    config: c.env.CONFIG,
    sheetsClient,
    spreadsheetId: sheetsConfig.spreadsheetId,
    tabName: sheetsConfig.tabApplications,
    notifier,
  });

  return c.json({ ok: result.success, ...result });
});

// -------------------------------------------------------------
// Inbox Poller & Outcome Tracking Route
// -------------------------------------------------------------

app.post('/api/inbox/poll', async (c) => {
  const profileRow = await c.env.DB.prepare('SELECT data FROM profile WHERE id = ?')
    .bind('default')
    .first<{ data: string }>();

  if (!profileRow?.data) {
    return c.json({ error: 'Profile not configured' }, 400);
  }
  const profile = ProfileSchema.parse(JSON.parse(profileRow.data));

  let tokenEncryptionKey: string;
  try {
    tokenEncryptionKey = getTokenKey(c.env);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 503);
  }

  const appConfig = await getConfig(c.env, c.env.DB);
  const googleOAuth = appConfig.getGoogleOAuth();
  if (!googleOAuth.clientId || !googleOAuth.clientSecret) {
    return c.json(
      {
        error:
          'Missing required Google OAuth credentials: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured',
      },
      503,
    );
  }

  const secrets: GoogleOAuthSecrets = {
    clientId: googleOAuth.clientId,
    clientSecret: googleOAuth.clientSecret,
    tokenEncryptionKey,
  };

  const notifier = new EventsNotifier(c.env.DB);
  const gmailSender = new RestGmailSender(() =>
    getValidAccessToken({
      config: c.env.CONFIG,
      secrets,
      notifier,
    }),
  );

  const llmConfig = appConfig.getLlmConfig();
  let llmClient = undefined;
  if (c.env.AI || llmConfig.geminiApiKey) {
    try {
      llmClient = createLLMClient({
        provider: llmConfig.provider,
        aiBinding: c.env.AI as CloudflareAiBinding | undefined,
        geminiApiKey: llmConfig.geminiApiKey,
        model: llmConfig.model,
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

  // Recent 24h failure rate (excludes policy blocks)
  const { failureRate } = await calculateFailureRate(c.env.DB, nowMs);

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

  // Kill switch from KV or env (single spelling KILL_SWITCH_KV_KEY)
  const killSwitch = await isKillSwitchActive(c.env.CONFIG, env.KILL_SWITCH);

  // Effective dry run = (wrangler var is true) OR (KV override is true)
  const dryRun = await getEffectiveDryRun(env.DRY_RUN, c.env.CONFIG);

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

  let profile: Profile | undefined;
  if (profileRow?.data) {
    try {
      profile = ProfileSchema.parse(JSON.parse(profileRow.data));
    } catch {
      // fallback
    }
  }

  // Pre-fetch DNC list for bulk predicate
  const dncRows = await c.env.DB.prepare('SELECT value FROM do_not_contact').all<{
    value: string;
  }>();
  const dncSet = new Set((dncRows.results || []).map((r) => r.value.toLowerCase().trim()));

  interface ReviewQueueDbRow {
    id: string;
    job_id: string;
    status: string;
    cover_letter: string;
    subject: string;
    resume_id: string | null;
    validator_errors: string | null;
    updated_at: string;
    title: string;
    company: string;
    location: string | null;
    salary_raw: string | null;
    description: string;
    apply_url: string | null;
    apply_route: string | null;
    contact_email: string | null;
    contact_source: string | null;
    match_score: number | null;
    match_reasons: string | null;
    red_flags: string | null;
    untrusted: number | boolean | null;
    route_reason: string | null;
    resume_label: string | null;
  }

  const { results: rawRows } = await c.env.DB.prepare(
    `SELECT
       a.id, a.job_id, a.status, a.cover_letter, a.subject, a.resume_id, a.validator_errors, a.updated_at,
       j.title, j.company, j.location, j.salary_raw, j.description, j.apply_url, j.apply_route, j.contact_email, j.contact_source,
       j.match_score, j.match_reasons, j.red_flags, j.untrusted, j.route_reason,
       r.label AS resume_label
     FROM applications a
     JOIN jobs j ON a.job_id = j.id
     LEFT JOIN resumes r ON a.resume_id = r.id
     WHERE a.channel = 'email' AND a.status IN ('draft', 'needs_review')
     ORDER BY j.match_score DESC, a.updated_at DESC`,
  ).all();

  const items = ((rawRows || []) as unknown as ReviewQueueDbRow[]).map((row) => {
    let redFlagsList: string[] = [];
    try {
      if (row.red_flags) redFlagsList = JSON.parse(row.red_flags);
    } catch {
      // fallback
    }

    const bulkCheck = canBulkApprove(row, {
      profile,
      doNotContact: dncSet,
    });

    return {
      ...row,
      red_flags: redFlagsList,
      is_safe_for_bulk: bulkCheck.allowed,
    };
  });

  return c.json({ items });
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

  const targetResume = await c.env.DB.prepare('SELECT id, archived FROM resumes WHERE id = ?')
    .bind(body.resume_id)
    .first<{ id: string; archived: number }>();

  if (!targetResume || targetResume.archived) {
    return c.json({ error: 'Selected resume not found or is archived' }, 400);
  }

  const nowIso = new Date().toISOString();
  await c.env.DB.prepare('UPDATE applications SET resume_id = ?, updated_at = ? WHERE id = ?')
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

  await transition(c.env.DB, 'application', id, 'rejected', 'Rejected during review');

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
  interface SourceStateDbRow {
    source: string;
    consecutive_failures: number;
    circuit_state: string;
    opened_at: string | null;
    last_run_at: string | null;
    last_error: string | null;
    parser_empty_streak: number | null;
    untrusted: number | boolean | null;
  }

  const { results: rawRows } = await c.env.DB.prepare(
    `SELECT source, consecutive_failures, circuit_state, opened_at, last_run_at, last_error, parser_empty_streak, untrusted
     FROM source_state
     ORDER BY source ASC`,
  ).all();

  const { results: recentRunEvents } = await c.env.DB.prepare(
    `SELECT entity_id as source, payload
     FROM events
     WHERE type = 'source_run'
     ORDER BY created_at DESC`,
  ).all<{ source: string; payload: string }>();

  const latestStatsBySource = new Map<string, { boards_total?: number; boards_failed?: number }>();
  for (const ev of recentRunEvents || []) {
    if (!latestStatsBySource.has(ev.source) && ev.payload) {
      try {
        const parsed = JSON.parse(ev.payload);
        if (typeof parsed.boards_total === 'number') {
          latestStatsBySource.set(ev.source, {
            boards_total: parsed.boards_total,
            boards_failed: parsed.boards_failed ?? 0,
          });
        }
      } catch {
        // ignore
      }
    }
  }

  const sources = ((rawRows || []) as unknown as SourceStateDbRow[]).map((row) => {
    const slugStats = latestStatsBySource.get(row.source);
    return {
      ...row,
      parser_suspect: (row.parser_empty_streak ?? 0) >= 3 || Boolean(row.untrusted),
      boards_total: slugStats?.boards_total,
      boards_failed: slugStats?.boards_failed,
    };
  });

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

  const killSwitch = await isKillSwitchActive(c.env.CONFIG, env.KILL_SWITCH);
  const dryRun = await getEffectiveDryRun(env.DRY_RUN, c.env.CONFIG);

  const appConfig = await getConfig(c.env, c.env.DB);
  const fields = appConfig.getAllFields();

  if (c.req.query('format') === 'array' || c.req.query('format') === 'list') {
    return c.json(fields);
  }

  return c.json({
    settings: fields,
    profile,
    resumes: rawResumes || [],
    dryRun,
    killSwitch,
    masterKeyConfigured: appConfig.masterKeyConfigured,
    masterKeyError: appConfig.masterKeyError,
    legacyEnvKeys: appConfig.getLegacyEnvKeys(),
  });
});

// 9. POST /api/settings: Validates and updates profile settings
app.post('/api/settings', async (c) => {
  const body = await c.req.json<{ profile?: unknown }>().catch(() => ({}) as { profile?: unknown });

  if (!body.profile || typeof body.profile !== 'object') {
    return c.json({ error: 'Missing profile object in request body' }, 400);
  }

  let validatedProfile;
  try {
    validatedProfile = ProfileSchema.parse(body.profile);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Invalid profile settings: ${msg}` }, 400);
  }

  const nowIso = new Date().toISOString();
  await c.env.DB.prepare(`INSERT OR REPLACE INTO profile (id, data, updated_at) VALUES (?, ?, ?)`)
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
    .json<{ dry_run?: boolean; confirmed?: boolean }>()
    .catch(() => ({}) as { dry_run?: boolean; confirmed?: boolean });
  if (typeof body.dry_run !== 'boolean') {
    return c.json({ error: 'Missing or invalid dry_run boolean' }, 400);
  }

  if (body.dry_run === false && body.confirmed !== true) {
    return c.json({ error: 'Disabling DRY_RUN requires confirmed: true' }, 400);
  }

  await c.env.CONFIG.put(DRY_RUN_KV_KEY, body.dry_run ? 'true' : 'false');

  const nowIso = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO events (id, entity, entity_id, type, payload, created_at)
     VALUES (?, 'settings', 'dry_run', 'dry_run_toggled', ?, ?)`,
  )
    .bind(crypto.randomUUID(), JSON.stringify({ dry_run: body.dry_run }), nowIso)
    .run();

  const effectiveDryRun = await getEffectiveDryRun(c.get('validatedEnv').DRY_RUN, c.env.CONFIG);
  return c.json({ ok: true, dryRun: effectiveDryRun });
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
  await c.env.CONFIG.put(KILL_SWITCH_KV_KEY, val);

  const nowIso = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO events (id, entity, entity_id, type, payload, created_at)
     VALUES (?, 'settings', 'kill_switch', 'kill_switch_toggled', ?, ?)`,
  )
    .bind(crypto.randomUUID(), JSON.stringify({ kill_switch: body.kill_switch }), nowIso)
    .run();

  return c.json({ ok: true, killSwitch: body.kill_switch });
});

// -------------------------------------------------------------
// App Settings Configuration & Diagnostic Routes (Phase 12 / Stage 3)
// -------------------------------------------------------------

// PUT /api/settings/:key: Set or update an app setting
app.put('/api/settings/:key', async (c) => {
  const key = c.req.param('key') as MigratedSettingKey;
  if (!MIGRATED_SETTING_KEYS.includes(key)) {
    return c.json({ error: 'Unknown setting key' }, 400);
  }

  const body = await c.req.json<{ value?: unknown; confirmed?: boolean }>().catch(() => null);
  if (!body || body.value === undefined) {
    return c.json({ error: 'Missing value in request body' }, 400);
  }

  const validation = validateSettingValue(key, body.value);
  if (!validation.success) {
    return c.json({ error: `Validation failed: ${validation.error}` }, 400);
  }
  const normalizedValue = validation.data;

  const appConfig = await getConfig(c.env, c.env.DB);
  const def = SETTING_DEFINITIONS[key];
  const isSecret = def.class === 'SECRET';

  if (isSecret && !appConfig.masterKeyConfigured) {
    return c.json(
      { error: 'Cannot save secret: master encryption key is missing or invalid' },
      503,
    );
  }

  const masterKey = getMasterKey(c.env as Record<string, unknown>);
  if (isSecret && !masterKey) {
    return c.json({ error: 'Cannot save secret: master encryption key is missing' }, 503);
  }

  const sourceBefore = appConfig.getField(key).source;

  // Side Effect: Spreadsheet ID changed requires confirmation & resets sync cursor
  if (key === 'GOOGLE_SHEET_ID') {
    const currentSheetId = appConfig.getSheetsConfig().spreadsheetId;
    if (currentSheetId && currentSheetId !== normalizedValue) {
      if (body.confirmed !== true) {
        return c.json(
          {
            error:
              'Changing spreadsheet ID requires confirmed: true to reset sync cursors and backfill new sheet',
          },
          400,
        );
      }
      await c.env.CONFIG.delete('sheets:last_synced_at');
      await c.env.CONFIG.delete('sheets:sync_cursor');
      await c.env.DB.prepare(
        'UPDATE applications SET synced_at = NULL WHERE synced_at IS NOT NULL',
      ).run();
      await c.env.DB.prepare(
        `INSERT INTO events (id, entity, entity_id, type, payload, created_at)
         VALUES (?, 'sheets', ?, 'sheets.cursor_reset', ?, ?)`,
      )
        .bind(
          crypto.randomUUID(),
          normalizedValue,
          JSON.stringify({ oldSheetId: currentSheetId, newSheetId: normalizedValue }),
          new Date().toISOString(),
        )
        .run();
    }
  }

  // Side Effect: Google client credentials changed -> invalidate auth health
  if (key === 'GOOGLE_CLIENT_ID' || key === 'GOOGLE_CLIENT_SECRET') {
    await setGoogleAuthHealth({
      config: c.env.CONFIG,
      status: 'invalid',
      reason: 'Google client credentials changed. Reconnection required.',
    });
  }

  await setAppSetting(c.env.DB, masterKey, key, normalizedValue, 'owner');
  invalidateConfigCache();

  const nowIso = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO events (id, entity, entity_id, type, payload, created_at)
     VALUES (?, 'settings', ?, 'settings.changed', ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      key,
      JSON.stringify({
        key,
        action: 'set',
        result: 'ok',
        actor: 'owner',
        sourceBefore,
        sourceAfter: 'ui',
      }),
      nowIso,
    )
    .run();

  return c.json({ ok: true, key });
});

// DELETE /api/settings/:key: Clear an app setting
app.delete('/api/settings/:key', async (c) => {
  const key = c.req.param('key') as MigratedSettingKey;
  if (!MIGRATED_SETTING_KEYS.includes(key)) {
    return c.json({ error: 'Unknown setting key' }, 400);
  }

  const appConfig = await getConfig(c.env, c.env.DB);
  const sourceBefore = appConfig.getField(key).source;

  await deleteAppSetting(c.env.DB, key);

  if (key === 'GOOGLE_CLIENT_ID' || key === 'GOOGLE_CLIENT_SECRET') {
    await setGoogleAuthHealth({
      config: c.env.CONFIG,
      status: 'invalid',
      reason: 'Google client credentials cleared. Reconnection required.',
    });
  }

  invalidateConfigCache();

  const nowIso = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO events (id, entity, entity_id, type, payload, created_at)
     VALUES (?, 'settings', ?, 'settings.changed', ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      key,
      JSON.stringify({
        key,
        action: 'clear',
        result: 'ok',
        actor: 'owner',
        sourceBefore,
        sourceAfter: 'unset',
      }),
      nowIso,
    )
    .run();

  return c.json({ ok: true, cleared: key });
});

// POST /api/settings/test/:target: Test an integration target
app.post('/api/settings/test/:target', async (c) => {
  const target = c.req.param('target');
  const validTargets = ['google-oauth-config', 'sheets', 'llm', 'telegram'];
  if (!validTargets.includes(target)) {
    return c.json({ ok: false, code: 'invalid_target', message: 'Unknown test target' }, 400);
  }

  // Rate-limit to 10 per minute per target using KV
  const minuteKey = Math.floor(Date.now() / 60000);
  const kvKey = `ratelimit:test:${target}:${minuteKey}`;
  const rawCount = await c.env.CONFIG.get(kvKey);
  const count = rawCount ? Number.parseInt(rawCount, 10) : 0;
  if (count >= 10) {
    return c.json(
      {
        ok: false,
        code: 'rate_limited',
        message: 'Rate limit exceeded: maximum 10 tests per minute',
      },
      429,
    );
  }
  await c.env.CONFIG.put(kvKey, String(count + 1), { expirationTtl: 120 });

  const appConfig = await getConfig(c.env, c.env.DB);
  let result: { ok: boolean; code: string; message: string; title?: string; tabExists?: boolean };

  if (target === 'google-oauth-config') {
    if (!appConfig.hasGoogleOAuth()) {
      result = {
        ok: false,
        code: 'unconfigured',
        message: 'Google OAuth client ID and secret must be configured',
      };
    } else {
      let tokenKeyFound = false;
      try {
        getTokenKey(c.env);
        tokenKeyFound = true;
      } catch {
        tokenKeyFound = false;
      }
      if (!tokenKeyFound) {
        result = {
          ok: false,
          code: 'token_key_missing',
          message: 'Master token encryption key is not configured',
        };
      } else {
        const health = await getGoogleAuthHealth(c.env.CONFIG);
        result = {
          ok: true,
          code: 'ok',
          message:
            health.status === 'ok'
              ? 'Google OAuth credentials and account connection are healthy'
              : 'Google OAuth credentials configured; connect account to complete authorization',
        };
      }
    }
  } else if (target === 'sheets') {
    if (!appConfig.hasGoogleOAuth()) {
      result = {
        ok: false,
        code: 'oauth_missing',
        message: 'Google OAuth must be configured before testing Google Sheets',
      };
    } else {
      const sheetsConfig = appConfig.getSheetsConfig();
      if (!sheetsConfig.spreadsheetId) {
        result = {
          ok: false,
          code: 'sheet_missing',
          message: 'Google Spreadsheet ID or URL must be configured',
        };
      } else {
        const health = await getGoogleAuthHealth(c.env.CONFIG);
        if (health.status !== 'ok') {
          result = {
            ok: false,
            code: 'auth_invalid',
            message: 'Google account is not connected or authorization is invalid',
          };
        } else {
          try {
            const tokenEncryptionKey = getTokenKey(c.env);
            const googleOAuth = appConfig.getGoogleOAuth();
            const secrets: GoogleOAuthSecrets = {
              clientId: googleOAuth.clientId,
              clientSecret: googleOAuth.clientSecret,
              tokenEncryptionKey,
            };
            const notifier = await createWorkerNotifier(c.env, appConfig);
            const sheetsClient = new RestSheetsClient(() =>
              getValidAccessToken({ config: c.env.CONFIG, secrets, notifier }),
            );
            const meta = await sheetsClient.getSpreadsheet(sheetsConfig.spreadsheetId);
            const tabExists = meta.sheets.some(
              (s) => s.properties.title === sheetsConfig.tabApplications,
            );
            result = {
              ok: true,
              code: 'ok',
              message: tabExists
                ? `Connected to spreadsheet "${meta.properties.title}" (tab "${sheetsConfig.tabApplications}" found)`
                : `Connected to spreadsheet "${meta.properties.title}", but tab "${sheetsConfig.tabApplications}" was not found`,
              title: meta.properties.title,
              tabExists,
            };
          } catch {
            result = {
              ok: false,
              code: 'sheets_error',
              message: 'Failed to access Google Spreadsheet metadata',
            };
          }
        }
      }
    }
  } else if (target === 'llm') {
    const llmConfig = appConfig.getLlmConfig();
    try {
      const llmClient = createLLMClient({
        provider: llmConfig.provider,
        ai: c.env.AI as CloudflareAiBinding | undefined,
        geminiApiKey: llmConfig.geminiApiKey,
        model: llmConfig.model,
      });
      await llmClient.generateText('Respond with {"ok":true}');
      result = {
        ok: true,
        code: 'ok',
        message: `LLM test completion succeeded with ${llmConfig.provider} (${llmConfig.model})`,
      };
    } catch {
      result = {
        ok: false,
        code: 'llm_error',
        message: 'LLM test completion failed',
      };
    }
  } else if (target === 'telegram') {
    const tg = appConfig.getTelegramConfig();
    if (!tg.botToken || !tg.chatId) {
      result = {
        ok: false,
        code: 'unconfigured',
        message: 'Telegram bot token and chat ID must be configured',
      };
    } else {
      try {
        const notifier = new TelegramNotifier({
          botToken: tg.botToken,
          chatId: tg.chatId,
          kv: c.env.CONFIG,
        });
        await notifier.notify('Pigeon notification test: Telegram connection is working.');
        result = {
          ok: true,
          code: 'ok',
          message: 'Telegram test message sent successfully',
        };
      } catch {
        result = {
          ok: false,
          code: 'telegram_error',
          message: 'Failed to send Telegram test message',
        };
      }
    }
  } else {
    result = { ok: false, code: 'invalid_target', message: 'Unknown test target' };
  }

  // Audit event in events table
  const nowIso = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO events (id, entity, entity_id, type, payload, created_at)
     VALUES (?, 'settings', ?, 'settings.changed', ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      target,
      JSON.stringify({
        key: target,
        action: 'test',
        result: result.ok ? 'ok' : 'failed',
        actor: 'owner',
      }),
      nowIso,
    )
    .run();

  return c.json(result, result.ok ? 200 : 400);
});

// GET /api/setup/status: First-run readiness and integration checklist
app.get('/api/setup/status', async (c) => {
  const appConfig = await getConfig(c.env, c.env.DB);
  const profileRow = await c.env.DB.prepare('SELECT data FROM profile WHERE id = ?')
    .bind('default')
    .first<{ data: string }>();

  let profileConfigured = false;
  if (profileRow?.data) {
    try {
      const p = JSON.parse(profileRow.data) as { name?: string; email?: string };
      profileConfigured = !!(p.name && p.email);
    } catch {
      profileConfigured = false;
    }
  }

  const masterKeyOk = appConfig.masterKeyConfigured;
  const googleOAuthOk = appConfig.hasGoogleOAuth();

  const authHealth = await getGoogleAuthHealth(c.env.CONFIG);
  const googleAccountOk = authHealth.status === 'ok';

  const sheetsConfig = appConfig.getSheetsConfig();
  const sheetsOk = !!sheetsConfig.spreadsheetId;

  const llmConfig = appConfig.getLlmConfig();
  const llmOk =
    llmConfig.provider === 'workers-ai'
      ? !!c.env.AI
      : !!(llmConfig.provider === 'gemini' && llmConfig.geminiApiKey);

  const telegramConfig = appConfig.getTelegramConfig();
  const telegramOk = telegramConfig.isConfigured;

  const defaultResumeRow = await c.env.DB.prepare(
    'SELECT id, label FROM resumes WHERE is_default = 1 AND archived = 0 LIMIT 1',
  ).first<{ id: string; label: string }>();
  const resumeOk = !!defaultResumeRow;

  const readyForDryRun = masterKeyOk && profileConfigured && resumeOk && llmOk;
  const readyToGoLive = readyForDryRun && googleOAuthOk && googleAccountOk && sheetsOk;

  const items = [
    {
      id: 'master_key',
      name: 'Master Encryption Key',
      status: masterKeyOk ? 'ok' : 'invalid',
      message: masterKeyOk
        ? 'Master encryption key is configured and valid'
        : appConfig.masterKeyError || 'SETTINGS_ENCRYPTION_KEY is missing or invalid',
    },
    {
      id: 'profile',
      name: 'Profile',
      status: profileConfigured ? 'ok' : 'missing',
      message: profileConfigured
        ? 'User profile is configured'
        : 'Profile name and email must be configured in Settings > Profile',
    },
    {
      id: 'resume',
      name: 'Default Resume',
      status: resumeOk ? 'ok' : 'missing',
      message: resumeOk
        ? `Default resume uploaded (${defaultResumeRow?.label || 'Active'})`
        : 'Upload at least one default PDF resume in Settings > Resumes',
    },
    {
      id: 'llm',
      name: 'LLM Provider',
      status: llmOk ? 'ok' : 'missing',
      message: llmOk
        ? `LLM configured (${llmConfig.provider}: ${llmConfig.model})`
        : llmConfig.provider === 'gemini'
          ? 'Gemini API key is required when provider is gemini'
          : 'Workers AI binding is missing',
    },
    {
      id: 'google_oauth',
      name: 'Google OAuth Credentials',
      status: googleOAuthOk ? 'ok' : 'missing',
      message: googleOAuthOk
        ? 'Google Cloud OAuth client ID and client secret are set'
        : 'Configure Google Client ID and Secret in Settings > Integrations',
    },
    {
      id: 'google_account',
      name: 'Connected Google Account',
      status: googleAccountOk ? 'ok' : googleOAuthOk ? 'needs_action' : 'missing',
      message: googleAccountOk
        ? `Connected to Google (${(c.env.OWNER_GMAIL as string) || 'Active'})`
        : 'Connect your Google account in Settings > Integrations',
    },
    {
      id: 'sheets',
      name: 'Google Sheets Tracker',
      status: sheetsOk ? 'ok' : 'missing',
      message: sheetsOk
        ? `Spreadsheet ID configured: ${sheetsConfig.spreadsheetId}`
        : 'Configure Spreadsheet ID or URL in Settings > Integrations',
    },
    {
      id: 'telegram',
      name: 'Telegram Notifications',
      status: telegramOk ? 'ok' : 'missing',
      message: telegramOk
        ? 'Telegram bot token and chat ID configured'
        : 'Optional: configure Telegram in Settings > Integrations for alerts',
    },
  ];

  return c.json({
    items,
    readyForDryRun,
    readyToGoLive,
  });
});

// GET /api/settings/export: Export non-secret settings
app.get('/api/settings/export', async (c) => {
  const appConfig = await getConfig(c.env, c.env.DB);
  const exportable: Record<string, string> = {};
  for (const field of appConfig.getAllFields()) {
    if (field.class === 'SETTING' && field.value !== undefined) {
      exportable[field.key] = field.value;
    }
  }
  return c.json({ ok: true, settings: exportable });
});

// POST /api/settings/import: Validated import of non-secret settings
app.post('/api/settings/import', async (c) => {
  const body = await c.req
    .json<{ settings?: Record<string, unknown>; apply?: boolean }>()
    .catch(() => null);

  if (!body || !body.settings || typeof body.settings !== 'object') {
    return c.json({ error: 'Missing settings object in body' }, 400);
  }

  const appConfig = await getConfig(c.env, c.env.DB);
  const validatedEntries: Array<{ key: MigratedSettingKey; value: string }> = [];

  for (const [keyStr, val] of Object.entries(body.settings)) {
    const key = keyStr as MigratedSettingKey;
    const def = SETTING_DEFINITIONS[key];
    if (!def) {
      return c.json({ error: `Cannot import unknown setting '${keyStr}'` }, 400);
    }
    if (def.class === 'SECRET') {
      return c.json(
        { error: 'Import cannot accept secret keys. Secrets must be configured in Settings UI.' },
        400,
      );
    }
    const validation = validateSettingValue(key, val);
    if (!validation.success) {
      return c.json({ error: `Validation failed for ${key}: ${validation.error}` }, 400);
    }
    validatedEntries.push({ key, value: validation.data });
  }

  // Preview mode (apply !== true)
  if (body.apply !== true) {
    const changes = validatedEntries.map((entry) => {
      const current = appConfig.getField(entry.key);
      return {
        key: entry.key,
        oldValue: current.value ?? '',
        newValue: entry.value,
      };
    });
    return c.json({ ok: true, preview: true, changes });
  }

  // Apply mode
  const masterKey = getMasterKey(c.env as Record<string, unknown>);
  let importedCount = 0;
  for (const entry of validatedEntries) {
    await setAppSetting(c.env.DB, masterKey, entry.key, entry.value, 'owner');
    importedCount++;
  }

  invalidateConfigCache();

  const nowIso = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO events (id, entity, entity_id, type, payload, created_at)
     VALUES (?, 'settings', 'import', 'settings.changed', ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      JSON.stringify({ action: 'import', count: importedCount, actor: 'owner' }),
      nowIso,
    )
    .run();

  return c.json({ ok: true, imported: importedCount });
});

// 12. POST /api/retention/purge: Manually triggers 90-day job retention purge
app.post('/api/retention/purge', async (c) => {
  const result = await purgeExpiredJobDescriptions({ db: c.env.DB });
  return c.json({ ok: true, ...result });
});

// -------------------------------------------------------------
// Local Development Trigger Routes (Strictly ENV=dev only)
// -------------------------------------------------------------
app.post('/api/dev/seed', async (c) => {
  const envMode = c.env.ENV as string;
  if (envMode !== 'dev') {
    return c.json({ error: 'Forbidden: dev seed is only available when ENV=dev' }, 403);
  }

  const result = await seedLocalData({
    db: c.env.DB,
    resumesBucket: c.env.RESUMES,
    config: c.env.CONFIG,
    env: envMode,
  });

  return c.json({ ok: true, ...result });
});

app.post('/api/dev/trigger/:action', async (c) => {
  const envMode = c.env.ENV as string;
  if (envMode !== 'dev') {
    return c.json({ error: 'Forbidden: dev triggers are only available when ENV=dev' }, 403);
  }

  const action = c.req.param('action');
  const env = c.get('validatedEnv');
  const appConfig = await getConfig(c.env, c.env.DB);

  if (action === 'ingest') {
    const enabledSources = await getEnabledSources(c.env.CONFIG);
    const identity = appConfig.getIdentityConfig();
    const userAgent = identity.userAgentContactEmail
      ? `Pigeon/1.0 (Job Application Assistant; mailto:${identity.userAgentContactEmail}; +https://github.com/pigeon)`
      : undefined;
    const results: Record<string, unknown> = {};
    for (const source of enabledSources) {
      try {
        const res = await ingestSource(source, {
          db: c.env.DB,
          kv: c.env.CONFIG,
          secrets: {
            ADZUNA_APP_ID: appConfig.getRawValue('ADZUNA_APP_ID'),
            ADZUNA_APP_KEY: appConfig.getRawValue('ADZUNA_APP_KEY'),
          },
          userAgent,
        });
        results[source] = res;
      } catch (err) {
        results[source] = { error: err instanceof Error ? err.message : String(err) };
      }
    }
    const countRow = await c.env.DB.prepare('SELECT COUNT(*) as count FROM jobs').first<{
      count: number;
    }>();
    return c.json({
      ok: true,
      action: 'ingest',
      enabledSources,
      totalJobs: countRow?.count ?? 0,
      results,
    });
  }

  if (action === 'score') {
    const profileRow = await c.env.DB.prepare('SELECT data FROM profile WHERE id = ?')
      .bind('default')
      .first<{ data: string }>();
    if (!profileRow?.data) {
      return c.json({ error: 'Profile not configured in database' }, 400);
    }
    const profile = ProfileSchema.parse(JSON.parse(profileRow.data));
    const llmConfig = appConfig.getLlmConfig();
    const llmClient = createLLMClient({
      provider: llmConfig.provider,
      ai: (env.AI ?? c.env.AI) as CloudflareAiBinding | undefined,
      geminiApiKey: llmConfig.geminiApiKey,
      model: llmConfig.model,
    });
    const scorer = new DefaultScorer(llmClient);
    const maxScoredRaw = await c.env.CONFIG.get('MAX_SCORED_PER_DAY');
    const maxScoredPerDay = maxScoredRaw ? Number.parseInt(maxScoredRaw, 10) : 200;

    const stats = await processJobPipeline({
      db: c.env.DB,
      profile,
      scorer,
      config: { max_scored_per_day: maxScoredPerDay },
    });
    return c.json({ ok: true, action: 'score', stats });
  }

  if (action === 'draft') {
    const profileRow = await c.env.DB.prepare('SELECT data FROM profile WHERE id = ?')
      .bind('default')
      .first<{ data: string }>();
    if (!profileRow?.data) {
      return c.json({ error: 'Profile not configured in database' }, 400);
    }
    const profile = ProfileSchema.parse(JSON.parse(profileRow.data));
    const llmConfig = appConfig.getLlmConfig();
    const llmClient = createLLMClient({
      provider: llmConfig.provider,
      ai: (env.AI ?? c.env.AI) as CloudflareAiBinding | undefined,
      geminiApiKey: llmConfig.geminiApiKey,
      model: llmConfig.model,
    });
    const generator = new DefaultCoverLetterGenerator(llmClient);

    const jobs = await c.env.DB.prepare(
      `SELECT j.id FROM jobs j
       LEFT JOIN applications a ON a.job_id = j.id
       WHERE j.apply_route = 'auto_email' AND j.status = 'routed' AND a.id IS NULL`,
    ).all<{ id: string }>();

    let created = 0;
    const errors: string[] = [];
    for (const job of jobs.results) {
      try {
        await ApplicationFactory.createForJob({
          db: c.env.DB,
          jobId: job.id,
          profile,
          generator,
        });
        created++;
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }
    return c.json({
      ok: true,
      action: 'draft',
      created,
      candidatesFound: jobs.results.length,
      errors,
    });
  }

  if (action === 'send') {
    const profileRow = await c.env.DB.prepare('SELECT data FROM profile WHERE id = ?')
      .bind('default')
      .first<{ data: string }>();
    if (!profileRow?.data) {
      return c.json({ error: 'Profile not configured in database' }, 400);
    }
    const profile = ProfileSchema.parse(JSON.parse(profileRow.data));
    const freshConfig = await getConfig(c.env, c.env.DB, { fresh: true });
    const googleOAuth = freshConfig.getGoogleOAuth();
    if (!googleOAuth.clientId || !googleOAuth.clientSecret) {
      return c.json({ error: 'Missing required Google OAuth credentials' }, 503);
    }
    const tokenEncryptionKey = getTokenKey(c.env);
    const secrets: GoogleOAuthSecrets = {
      clientId: googleOAuth.clientId,
      clientSecret: googleOAuth.clientSecret,
      tokenEncryptionKey,
    };
    const notifier = await createWorkerNotifier(c.env, freshConfig);
    const gmailSender = new RestGmailSender(() =>
      getValidAccessToken({
        config: c.env.CONFIG,
        secrets,
        notifier,
      }),
    );

    const approvedApps = await c.env.DB.prepare(
      `SELECT
         a.id, a.job_id, a.channel, a.status, a.cover_letter, a.subject,
         a.resume_id, a.message_id_header, a.gmail_message_id, a.gmail_thread_id,
         a.retry_count, j.title, j.company, j.company_normalized, j.contact_email
       FROM applications a
       JOIN jobs j ON a.job_id = j.id
       WHERE a.status = 'approved'`,
    ).all<ApplicationToSend>();

    let processed = 0;
    const sendResults: Array<{
      id: string;
      success: boolean;
      dryRun?: boolean | undefined;
      error?: string | undefined;
    }> = [];
    for (const app of approvedApps.results) {
      const res = await sendApplicationEmail({
        db: c.env.DB,
        config: c.env.CONFIG,
        resumesBucket: c.env.RESUMES,
        gmailSender,
        profile,
        notifier,
        dryRun: env.DRY_RUN,
        killSwitch: env.KILL_SWITCH,
        application: app,
        env: env.ENV,
        devRecipientAllowlist: (c.env.DEV_RECIPIENT_ALLOWLIST as string) || undefined,
      });
      processed++;
      sendResults.push({ id: app.id, success: res.success, dryRun: res.dryRun, error: res.error });
    }
    return c.json({ ok: true, action: 'send', processed, sendResults });
  }

  if (action === 'followups') {
    const profileRow = await c.env.DB.prepare('SELECT data FROM profile WHERE id = ?')
      .bind('default')
      .first<{ data: string }>();
    if (!profileRow?.data) {
      return c.json({ error: 'Profile not configured in database' }, 400);
    }
    const profile = ProfileSchema.parse(JSON.parse(profileRow.data));
    const result = await createPendingFollowUps({
      db: c.env.DB,
      profile,
    });
    return c.json({ ok: true, action: 'followups', ...result });
  }

  if (action === 'sheets') {
    const googleOAuth = appConfig.getGoogleOAuth();
    if (!googleOAuth.clientId || !googleOAuth.clientSecret) {
      return c.json({ error: 'Missing required Google OAuth credentials' }, 503);
    }
    const tokenEncryptionKey = getTokenKey(c.env);
    const secrets: GoogleOAuthSecrets = {
      clientId: googleOAuth.clientId,
      clientSecret: googleOAuth.clientSecret,
      tokenEncryptionKey,
    };
    const notifier = await createWorkerNotifier(c.env, appConfig);
    const sheetsConfig = appConfig.getSheetsConfig();
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
      spreadsheetId: sheetsConfig.spreadsheetId,
      tabName: sheetsConfig.tabApplications,
      notifier,
    });
    return c.json({ ok: true, action: 'sheets', ...result });
  }

  return c.json({ error: `Unknown trigger action: ${action}` }, 400);
});

app.post('/api/dev/feed-eml', async (c) => {
  const envMode = c.env.ENV as string;
  if (envMode !== 'dev') {
    return c.json({ error: 'Forbidden: dev feed-eml is only available when ENV=dev' }, 403);
  }

  const rawEml = await c.req.text();
  if (!rawEml || !rawEml.trim()) {
    return c.json({ error: 'Empty email payload received' }, 400);
  }

  const profileRow = await c.env.DB.prepare('SELECT data FROM profile WHERE id = ?')
    .bind('default')
    .first<{ data: string }>();

  const appConfig = await getConfig(c.env, c.env.DB);
  let configuredForwardingAddress = appConfig.getIdentityConfig().alertForwardingAddress;

  if (!configuredForwardingAddress && profileRow?.data) {
    try {
      const profile = JSON.parse(profileRow.data) as { email?: string };
      if (profile.email) {
        configuredForwardingAddress = profile.email;
      }
    } catch {
      // ignore
    }
  }

  const notifier = await createWorkerNotifier(c.env, appConfig);
  const result = await ingestAlertEmail(rawEml, {
    db: c.env.DB,
    envelope: {
      from: configuredForwardingAddress || 'user@example.com',
      to: 'alerts@local.test',
    },
    configuredForwardingAddress,
    notifier,
  });

  return c.json({ ok: true, ...result });
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
    // Housekeeping: purge >90-day job descriptions for unapplied jobs
    await purgeExpiredJobDescriptions({ db: env.DB });
    const appConfig = await getConfig(env, env.DB);
    // Send daily digest & check failure rate alert
    const notifier = await createWorkerNotifier(env, appConfig);
    await sendManualDailyDigest({ db: env.DB, notifier });
    await checkFailureRateAlert({ db: env.DB, notifier });

    const hasGoogleOAuth = appConfig.hasGoogleOAuth();

    // Sync to Google Sheet every cron run (10 min) if OAuth configured
    if (hasGoogleOAuth) {
      try {
        await env.JOBS_QUEUE.send({ action: 'sync_sheet' });
      } catch (err) {
        logger.error('Error enqueuing scheduled sheet sync', err);
      }
    }

    // Poll Gmail inbox every cron run (15 min) if OAuth configured
    if (hasGoogleOAuth) {
      try {
        await env.JOBS_QUEUE.send({ action: 'poll_inbox' });
      } catch (err) {
        logger.error('Error enqueuing scheduled inbox poll', err);
      }
    }

    // Daily Google Auth health ping if credentials configured
    if (hasGoogleOAuth) {
      try {
        const googleOAuth = appConfig.getGoogleOAuth();
        const tokenEncryptionKey = getTokenKey(env);
        const secrets: GoogleOAuthSecrets = {
          clientId: googleOAuth.clientId as string,
          clientSecret: googleOAuth.clientSecret as string,
          tokenEncryptionKey,
        };
        await pingGoogleAuthHealth({
          config: env.CONFIG,
          secrets,
          notifier,
        });
      } catch (err) {
        logger.error('Error during scheduled Google auth health ping', err);
      }
    }
  },
  async queue(batch: MessageBatch<unknown>, env: Bindings): Promise<void> {
    const appConfig = await getConfig(env, env.DB);
    for (const msg of batch.messages) {
      const body = msg.body as { source?: string; action?: string };
      if (body && typeof body.source === 'string') {
        try {
          const identity = appConfig.getIdentityConfig();
          const userAgent = identity.userAgentContactEmail
            ? `Pigeon/1.0 (Job Application Assistant; mailto:${identity.userAgentContactEmail}; +https://github.com/pigeon)`
            : undefined;
          await ingestSource(body.source, {
            db: env.DB,
            kv: env.CONFIG,
            secrets: {
              ADZUNA_APP_ID: appConfig.getRawValue('ADZUNA_APP_ID'),
              ADZUNA_APP_KEY: appConfig.getRawValue('ADZUNA_APP_KEY'),
            },
            userAgent,
          });
        } catch (err) {
          // Log error so that one source failure does not break other sources in the batch
          logger.error(`Ingestion error for source ${body.source}`, err);
        }
      } else if (body && body.action === 'score_and_route') {
        try {
          const profileRow = await env.DB.prepare('SELECT data FROM profile WHERE id = ?')
            .bind('default')
            .first<{ data: string }>();

          if (profileRow?.data) {
            const profile = ProfileSchema.parse(JSON.parse(profileRow.data));
            const llmConfig = appConfig.getLlmConfig();
            const llmClient = createLLMClient({
              provider: llmConfig.provider,
              aiBinding: env.AI as CloudflareAiBinding | undefined,
              geminiApiKey: llmConfig.geminiApiKey,
              model: llmConfig.model,
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
          logger.error('Error during score_and_route queue task', err);
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
            const llmConfig = appConfig.getLlmConfig();
            const llmClient = createLLMClient({
              provider: llmConfig.provider,
              ai: env.AI as CloudflareAiBinding | undefined,
              geminiApiKey: llmConfig.geminiApiKey,
              model: llmConfig.model,
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
          logger.error('Error during create_application queue task', err);
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
              const freshConfig = await getConfig(env, env.DB, { fresh: true });
              if (freshConfig.hasGoogleOAuth()) {
                const googleOAuth = freshConfig.getGoogleOAuth();
                const tokenEncryptionKey = getTokenKey(env);
                const secrets: GoogleOAuthSecrets = {
                  clientId: googleOAuth.clientId,
                  clientSecret: googleOAuth.clientSecret,
                  tokenEncryptionKey,
                };

                const notifier = await createWorkerNotifier(env, freshConfig);
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
                  typeof env.KILL_SWITCH === 'boolean'
                    ? env.KILL_SWITCH
                    : env.KILL_SWITCH === 'true';

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
                  env: env.ENV as string,
                  devRecipientAllowlist: (env.DEV_RECIPIENT_ALLOWLIST as string) || undefined,
                });
              }
            }
          }
        } catch (err) {
          logger.error('Error during send_application queue task', err);
        }
      } else if (body && body.action === 'sync_sheet') {
        try {
          if (appConfig.hasGoogleOAuth()) {
            const googleOAuth = appConfig.getGoogleOAuth();
            const sheetsConfig = appConfig.getSheetsConfig();
            const tokenEncryptionKey = getTokenKey(env);
            const secrets: GoogleOAuthSecrets = {
              clientId: googleOAuth.clientId,
              clientSecret: googleOAuth.clientSecret,
              tokenEncryptionKey,
            };

            const notifier = await createWorkerNotifier(env, appConfig);
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
              spreadsheetId: sheetsConfig.spreadsheetId,
              tabName: sheetsConfig.tabApplications,
              notifier,
            });
          }
        } catch (err) {
          logger.error('Error during sync_sheet queue task', err);
        }
      } else if (body && body.action === 'poll_inbox') {
        try {
          const profileRow = await env.DB.prepare('SELECT data FROM profile WHERE id = ?')
            .bind('default')
            .first<{ data: string }>();

          if (profileRow?.data) {
            const profile = ProfileSchema.parse(JSON.parse(profileRow.data));
            if (appConfig.hasGoogleOAuth()) {
              const googleOAuth = appConfig.getGoogleOAuth();
              const tokenEncryptionKey = getTokenKey(env);
              const secrets: GoogleOAuthSecrets = {
                clientId: googleOAuth.clientId,
                clientSecret: googleOAuth.clientSecret,
                tokenEncryptionKey,
              };

              const notifier = await createWorkerNotifier(env, appConfig);
              const gmailSender = new RestGmailSender(() =>
                getValidAccessToken({
                  config: env.CONFIG,
                  secrets,
                  notifier,
                }),
              );

              const llmConfig = appConfig.getLlmConfig();
              let llmClient = undefined;
              if (env.AI || llmConfig.geminiApiKey) {
                try {
                  llmClient = createLLMClient({
                    provider: llmConfig.provider,
                    aiBinding: env.AI as CloudflareAiBinding | undefined,
                    geminiApiKey: llmConfig.geminiApiKey,
                    model: llmConfig.model,
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

              if (
                result.bouncedCount > 0 ||
                result.repliedCount > 0 ||
                result.followUpsCreated > 0
              ) {
                try {
                  await env.JOBS_QUEUE.send({ action: 'sync_sheet' });
                } catch {
                  // Non-fatal
                }
              }
            }
          }
        } catch (err) {
          logger.error('Error during poll_inbox queue task', err);
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
    const appConfig = await getConfig(env, env.DB);
    let configuredForwardingAddress = appConfig.getIdentityConfig().alertForwardingAddress;

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

    const notifier = await createWorkerNotifier(env, appConfig);

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
