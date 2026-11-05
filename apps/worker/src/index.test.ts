import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { env } from 'cloudflare:test';
import worker, { app } from './index.js';
import { validateWorkerEnv, type Bindings } from './env.js';
import { server, startMockServer } from '../fixtures/server.js';
import type { HealthResponse, ErrorResponse } from '@pigeon/shared';

const workerEnv = env as unknown as Bindings;

beforeAll(() => {
  startMockServer();
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

describe('Pigeon Worker', () => {
  describe('GET /health', () => {
    it('returns 200 with dryRun: true when DRY_RUN is "true"', async () => {
      const testEnv: Bindings = {
        ...workerEnv,
        DRY_RUN: 'true',
        ENV: 'dev',
      };
      const res = await app.request('/health', {}, testEnv);
      expect(res.status).toBe(200);
      const json = (await res.json()) as HealthResponse;
      expect(json).toEqual({
        ok: true,
        dryRun: true,
        env: 'dev',
      });
    });

    it('returns 200 with dryRun: false when DRY_RUN is "false"', async () => {
      const testEnv: Bindings = {
        ...workerEnv,
        DRY_RUN: 'false',
        ENV: 'staging',
      };
      const res = await app.request('/health', {}, testEnv);
      expect(res.status).toBe(200);
      const json = (await res.json()) as HealthResponse;
      expect(json).toEqual({
        ok: true,
        dryRun: false,
        env: 'staging',
      });
    });
  });

  describe('Cloudflare Bindings (D1, KV, R2, Queue)', () => {
    it('D1, KV, R2 and Queue bindings are usable inside the test pool (write then read)', async () => {
      // 1. KV write then read
      await workerEnv.CONFIG.put('pigeon:test_key', 'kv_test_val');
      const kvVal = await workerEnv.CONFIG.get('pigeon:test_key');
      expect(kvVal).toBe('kv_test_val');

      // 2. R2 write then read
      await workerEnv.RESUMES.put('resumes/test_resume.pdf', 'dummy pdf content', {
        httpMetadata: { contentType: 'application/pdf' },
      });
      const r2Obj = await workerEnv.RESUMES.get('resumes/test_resume.pdf');
      expect(r2Obj).not.toBeNull();
      const r2Content = await r2Obj?.text();
      expect(r2Content).toBe('dummy pdf content');

      // 3. D1 write then read
      await workerEnv.DB.exec(
        'CREATE TABLE IF NOT EXISTS test_jobs (id INTEGER PRIMARY KEY, title TEXT, company TEXT)',
      );
      await workerEnv.DB.prepare('INSERT INTO test_jobs (id, title, company) VALUES (?, ?, ?)')
        .bind(101, 'Senior Cloud Engineer', 'Cloudflare')
        .run();
      const row = await workerEnv.DB.prepare('SELECT title, company FROM test_jobs WHERE id = ?')
        .bind(101)
        .first<{ title: string; company: string }>();
      expect(row).toEqual({
        title: 'Senior Cloud Engineer',
        company: 'Cloudflare',
      });

      // 4. Queue producer and consumer
      await workerEnv.JOBS_QUEUE.send({
        jobId: 'job_101',
        action: 'ingest',
      });

      // Test queue consumer handler
      const ackMock = vi.fn();
      const retryMock = vi.fn();
      const mockBatch: MessageBatch<unknown> = {
        queue: 'pigeon-jobs',
        messages: [
          {
            id: 'msg-1',
            timestamp: new Date(),
            body: { jobId: 'job_101', action: 'ingest' },
            ack: ackMock,
            retry: retryMock,
            attempts: 1,
          },
        ],
        ackAll: vi.fn(),
        retryAll: vi.fn(),
        metadata: {
          metrics: {
            backlogCount: 0,
            backlogBytes: 0,
          },
        },
      };

      await worker.queue(mockBatch, workerEnv);
      expect(ackMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('Outbound HTTP Mocking', () => {
    it('an unmocked outbound fetch fails the test', async () => {
      await expect(fetch('https://api.unmocked-service.com/data')).rejects.toThrow();
    });
  });

  describe('Routing and Error Handling', () => {
    it('unknown route returns JSON 404', async () => {
      const res = await app.request('/unknown-endpoint', {}, workerEnv);
      expect(res.status).toBe(404);
      expect(res.headers.get('content-type')).toContain('application/json');
      const body = (await res.json()) as ErrorResponse;
      expect(body).toEqual({ error: 'Not Found' });
      expect(body).not.toHaveProperty('stack');
    });

    it('a thrown error returns JSON 500 with no stack trace', async () => {
      const res = await app.request('/test-error', {}, workerEnv);
      expect(res.status).toBe(500);
      expect(res.headers.get('content-type')).toContain('application/json');
      const body = (await res.json()) as Record<string, unknown>;
      expect(body['error']).toBe('Simulated failure');
      expect(body['stack']).toBeUndefined();
    });
  });

  describe('Environment Validation', () => {
    it('env schema rejects a bad DRY_RUN value', () => {
      expect(() => {
        validateWorkerEnv(
          {
            ...workerEnv,
            DRY_RUN: 'invalid-boolean-string',
          },
          true,
        );
      }).toThrow(/DRY_RUN must be "true" or "false"/);
    });
  });
});
