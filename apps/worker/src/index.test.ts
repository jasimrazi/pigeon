import { describe, it, expect, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { http, HttpResponse } from 'msw';
import worker, { app } from './index.js';
import { validateWorkerEnv, type Bindings } from './env.js';
import { server } from '../fixtures/server.js';
import type { HealthResponse, ErrorResponse } from '@pigeon/shared';

const workerEnv = env as unknown as Bindings;

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

  describe('Cloudflare Bindings (D1, KV, Queue, AI)', () => {
    it('D1, KV and Queue bindings are usable inside the test pool (write then read)', async () => {
      // 1. KV write then read
      await workerEnv.CONFIG.put('pigeon:test_key', 'kv_test_val');
      const kvVal = await workerEnv.CONFIG.get('pigeon:test_key');
      expect(kvVal).toBe('kv_test_val');

      // 2. D1 resume binary storage write then read
      await workerEnv.DB.exec(
        'CREATE TABLE IF NOT EXISTS test_resume_files (resume_id TEXT PRIMARY KEY, file_bytes BLOB, size_bytes INTEGER)',
      );
      const testBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
      await workerEnv.DB.prepare(
        'INSERT INTO test_resume_files (resume_id, file_bytes, size_bytes) VALUES (?, ?, ?)',
      )
        .bind('res-test-1', testBytes, testBytes.byteLength)
        .run();
      const fileRow = await workerEnv.DB.prepare(
        'SELECT file_bytes, size_bytes FROM test_resume_files WHERE resume_id = ?',
      )
        .bind('res-test-1')
        .first<{ file_bytes: ArrayBuffer | Uint8Array; size_bytes: number }>();
      expect(fileRow).not.toBeNull();
      expect(fileRow?.size_bytes).toBe(4);

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

      // 5. Workers AI binding exists
      expect(workerEnv.AI).toBeDefined();
    });
  });

  describe('Outbound HTTP Mocking', () => {
    it('unmocked outbound fetch to a real URL rejects with the guard specific error', async () => {
      await expect(fetch('https://example.com/')).rejects.toThrow(
        /Cannot bypass a request when using the "error" strategy for the "onUnhandledRequest" option/,
      );
    });

    it('positive control: with an MSW handler registered, fetch succeeds', async () => {
      server.use(
        http.get('https://example.com/', () => {
          return HttpResponse.json({ mocked: true, site: 'example.com' });
        }),
      );

      const res = await fetch('https://example.com/');
      expect(res.status).toBe(200);
      const data = (await res.json()) as { mocked: boolean; site: string };
      expect(data).toEqual({ mocked: true, site: 'example.com' });
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
      const origPrepare = workerEnv.DB.prepare;
      workerEnv.DB.prepare = vi.fn().mockImplementation(() => {
        throw new Error('Simulated failure');
      });
      try {
        const res = await app.request('/api/overview', {}, workerEnv);
        expect(res.status).toBe(500);
        expect(res.headers.get('content-type')).toContain('application/json');
        const body = (await res.json()) as Record<string, unknown>;
        expect(body['error']).toBe('Simulated failure');
        expect(body['stack']).toBeUndefined();
      } finally {
        workerEnv.DB.prepare = origPrepare;
      }
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

    it('defaults LLM_PROVIDER to "workers-ai" and validates with no API keys', () => {
      const validated = validateWorkerEnv(workerEnv, true);
      expect(validated.LLM_PROVIDER).toBe('workers-ai');
      expect(validated.GEMINI_API_KEY).toBeUndefined();
    });

    it('accepts "gemini" as LLM_PROVIDER with optional GEMINI_API_KEY', () => {
      const validated = validateWorkerEnv(
        {
          ...workerEnv,
          LLM_PROVIDER: 'gemini',
          GEMINI_API_KEY: 'test-gemini-key',
        },
        true,
      );
      expect(validated.LLM_PROVIDER).toBe('gemini');
      expect(validated.GEMINI_API_KEY).toBe('test-gemini-key');
    });

    it('rejects any other value for LLM_PROVIDER', () => {
      expect(() => {
        validateWorkerEnv(
          {
            ...workerEnv,
            LLM_PROVIDER: 'openai',
          },
          true,
        );
      }).toThrow(/LLM_PROVIDER/);
    });
  });

  describe('Body Limit Middleware (HTTP 413)', () => {
    it('returns 413 when JSON route exceeds 1 MB', async () => {
      const largePayload = JSON.stringify({
        ids: ['id-1'],
        action: 'applied',
        data: 'a'.repeat(1024 * 1024 + 100),
      });
      const res = await app.request(
        '/api/manual/bulk',
        {
          method: 'POST',
          headers: {
            Origin: 'http://localhost:5173',
            'Content-Type': 'application/json',
          },
          body: largePayload,
        },
        workerEnv,
      );
      expect(res.status).toBe(413);
      const json = (await res.json()) as { error: string };
      expect(json.error).toBe('Payload Too Large');
    });

    it('returns 413 when /api/resumes exceeds 5 MB', async () => {
      const boundary = '----WebKitFormBoundaryTest123';
      const preamble = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="large.pdf"\r\nContent-Type: application/pdf\r\n\r\n`;
      const epilogue = `\r\n--${boundary}--\r\n`;
      const body = preamble + 'x'.repeat(5 * 1024 * 1024 + 1024) + epilogue;
      const res = await app.request(
        '/api/resumes',
        {
          method: 'POST',
          headers: {
            Origin: 'http://localhost:5173',
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
          },
          body,
        },
        workerEnv,
      );
      expect(res.status).toBe(413);
      const json = (await res.json()) as { error: string };
      expect(json.error).toBe('Payload Too Large');
    });

    it('allows /api/resumes payload below 5 MB (e.g. 2 MB) through to normal route handling', async () => {
      const boundary = '----WebKitFormBoundaryTest456';
      const pdfHeader = '%PDF-1.4\n';
      const fileData = pdfHeader + 'x'.repeat(2 * 1024 * 1024);
      const preamble = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="valid.pdf"\r\nContent-Type: application/pdf\r\n\r\n`;
      const labelPart = `\r\n--${boundary}\r\nContent-Disposition: form-data; name="label"\r\n\r\nLarge Resume`;
      const epilogue = `\r\n--${boundary}--\r\n`;
      const body = preamble + fileData + labelPart + epilogue;

      const res = await app.request(
        '/api/resumes',
        {
          method: 'POST',
          headers: {
            Origin: 'http://localhost:5173',
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
          },
          body,
        },
        workerEnv,
      );
      expect(res.status).not.toBe(413);
    });
  });
});
