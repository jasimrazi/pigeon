import { Hono } from 'hono';
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

// Test route to verify 500 handler behavior
app.get('/test-error', () => {
  throw new Error('Simulated failure');
});

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<unknown>, _env: Bindings): Promise<void> {
    for (const msg of batch.messages) {
      msg.ack();
    }
  },
};
