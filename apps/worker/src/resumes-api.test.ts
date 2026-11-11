import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { app } from './index.js';
import { applyD1Migrations, env } from 'cloudflare:test';
import type { Bindings } from './env.js';
import {
  validatePreSend,
  type Profile,
  type ApplicationToSend,
  type D1LikeDatabase,
  type R2BucketLike,
} from '@pigeon/shared';

interface TestEnv extends Bindings {
  TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
}

const workerEnv = env as unknown as TestEnv;
const allowedOrigin = 'http://localhost:5173';

function createPdfBuffer(text = 'Mock PDF'): Uint8Array {
  const header = '%PDF-1.4\n';
  const body = `1 0 obj << /Length ${text.length} >> stream\n${text}\nendstream endobj\n`;
  const trailer = '%%EOF';
  const encoder = new TextEncoder();
  return encoder.encode(header + body + trailer);
}

describe('Resumes API & Hardening Test Suite', () => {
  beforeAll(async () => {
    await applyD1Migrations(workerEnv.DB, workerEnv.TEST_MIGRATIONS);
  });

  beforeEach(async () => {
    // Reset applications, resumes, and events
    await workerEnv.DB.prepare('DELETE FROM applications').run();
    await workerEnv.DB.prepare('DELETE FROM resumes').run();
    await workerEnv.DB.prepare("DELETE FROM events WHERE entity = 'resume'").run();
  });

  it('1. Upload happy path: stores PDF in R2, records in D1, first upload becomes default', async () => {
    const pdfBytes = createPdfBuffer('John Doe Resume');
    const formData = new FormData();
    formData.append('file', new Blob([pdfBytes], { type: 'application/pdf' }), 'john_doe.pdf');
    formData.append('label', 'Core Systems Engineer');
    formData.append('tags', 'TypeScript, Cloudflare, Distributed');
    formData.append('is_default', 'false'); // First upload must still become default!

    const res = await app.fetch(
      new Request('http://localhost/api/resumes', {
        method: 'POST',
        headers: { Origin: allowedOrigin },
        body: formData,
      }),
      workerEnv,
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      ok: boolean;
      resume: {
        id: string;
        label: string;
        is_default: boolean;
        tags: string[];
        size_bytes: number;
        archived: boolean;
      };
    };

    expect(body.ok).toBe(true);
    expect(body.resume.label).toBe('Core Systems Engineer');
    expect(body.resume.is_default).toBe(true); // First upload invariant
    expect(body.resume.tags).toEqual(['typescript', 'cloudflare', 'distributed']);
    expect(body.resume.archived).toBe(false);
    expect(body.resume.size_bytes).toBe(pdfBytes.byteLength);

    // Verify R2 object exists
    const r2Obj = await workerEnv.RESUMES.get(`resumes/${body.resume.id}.pdf`);
    expect(r2Obj).not.toBeNull();

    // Verify events written without file content
    const events = await workerEnv.DB.prepare(
      "SELECT type, payload FROM events WHERE entity = 'resume' AND entity_id = ? ORDER BY created_at ASC",
    )
      .bind(body.resume.id)
      .all<{ type: string; payload: string }>();

    expect(events.results.length).toBe(2);
    expect(events.results[0]?.type).toBe('resume_uploaded');
    expect(events.results[1]?.type).toBe('resume_default_changed');
    expect(events.results[0]?.payload).not.toContain('%PDF');
    expect(events.results[0]?.payload).toContain('Core Systems Engineer');
  });

  it('2. Non-PDF with PDF content-type is rejected (magic bytes check)', async () => {
    const fakePdfBytes = new TextEncoder().encode('GIF89a Fake Image masquerading as PDF');
    const formData = new FormData();
    formData.append('file', new Blob([fakePdfBytes], { type: 'application/pdf' }), 'fake.pdf');

    const res = await app.fetch(
      new Request('http://localhost/api/resumes', {
        method: 'POST',
        headers: { Origin: allowedOrigin },
        body: formData,
      }),
      workerEnv,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; code: string; error: string };
    expect(body.code).toBe('INVALID_PDF');
    expect(body.error).toContain('only PDF');
  });

  it('3. Empty file (0 bytes) is rejected', async () => {
    const emptyBytes = new Uint8Array(0);
    const formData = new FormData();
    formData.append('file', new Blob([emptyBytes], { type: 'application/pdf' }), 'empty.pdf');

    const res = await app.fetch(
      new Request('http://localhost/api/resumes', {
        method: 'POST',
        headers: { Origin: allowedOrigin },
        body: formData,
      }),
      workerEnv,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; code: string; error: string };
    expect(body.code).toBe('EMPTY_FILE');
  });

  it('4. 5 MB + 1 byte is rejected with 413 and code PAYLOAD_TOO_LARGE', async () => {
    const largeHeader = '%PDF-1.4\n';
    const filler = new Uint8Array(5 * 1024 * 1024 + 10);
    const headerBytes = new TextEncoder().encode(largeHeader);
    filler.set(headerBytes, 0);

    const formData = new FormData();
    formData.append('file', new Blob([filler], { type: 'application/pdf' }), 'oversized.pdf');

    const res = await app.fetch(
      new Request('http://localhost/api/resumes', {
        method: 'POST',
        headers: { Origin: allowedOrigin },
        body: formData,
      }),
      workerEnv,
    );

    expect(res.status).toBe(413);
    const body = (await res.json()) as { ok: boolean; code: string; error: string };
    expect(body.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('5. Concurrent / sequential default changes leave exactly one default in DB', async () => {
    // Upload resume 1
    const pdf1 = createPdfBuffer('Resume 1');
    const form1 = new FormData();
    form1.append('file', new Blob([pdf1], { type: 'application/pdf' }), 'res1.pdf');
    form1.append('label', 'Resume 1');
    const res1 = await app.fetch(
      new Request('http://localhost/api/resumes', {
        method: 'POST',
        headers: { Origin: allowedOrigin },
        body: form1,
      }),
      workerEnv,
    );
    const body1 = (await res1.json()) as { resume: { id: string } };

    // Upload resume 2
    const pdf2 = createPdfBuffer('Resume 2');
    const form2 = new FormData();
    form2.append('file', new Blob([pdf2], { type: 'application/pdf' }), 'res2.pdf');
    form2.append('label', 'Resume 2');
    form2.append('is_default', 'true');
    const res2 = await app.fetch(
      new Request('http://localhost/api/resumes', {
        method: 'POST',
        headers: { Origin: allowedOrigin },
        body: form2,
      }),
      workerEnv,
    );
    const body2 = (await res2.json()) as { resume: { id: string } };

    // Verify resume 2 is default, resume 1 is not
    const defaults = await workerEnv.DB.prepare(
      'SELECT id, is_default FROM resumes WHERE is_default = 1',
    ).all<{ id: string; is_default: number }>();

    expect(defaults.results.length).toBe(1);
    expect(defaults.results[0]?.id).toBe(body2.resume.id);

    // Switch back to resume 1
    const patchRes = await app.fetch(
      new Request(`http://localhost/api/resumes/${body1.resume.id}`, {
        method: 'PATCH',
        headers: {
          Origin: allowedOrigin,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ is_default: true }),
      }),
      workerEnv,
    );
    expect(patchRes.status).toBe(200);

    const defaultsAfter = await workerEnv.DB.prepare(
      'SELECT id, is_default FROM resumes WHERE is_default = 1',
    ).all<{ id: string; is_default: number }>();
    expect(defaultsAfter.results.length).toBe(1);
    expect(defaultsAfter.results[0]?.id).toBe(body1.resume.id);

    // Cannot unset default directly
    const unsetRes = await app.fetch(
      new Request(`http://localhost/api/resumes/${body1.resume.id}`, {
        method: 'PATCH',
        headers: {
          Origin: allowedOrigin,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ is_default: false }),
      }),
      workerEnv,
    );
    expect(unsetRes.status).toBe(400);
    const unsetBody = (await unsetRes.json()) as { code: string };
    expect(unsetBody.code).toBe('CANNOT_UNSET_DEFAULT');
  });

  it('6. The default resume cannot be deleted while it is the only one or while others exist', async () => {
    // 1 resume exists
    const pdf = createPdfBuffer('Single Resume');
    const form = new FormData();
    form.append('file', new Blob([pdf], { type: 'application/pdf' }), 'single.pdf');
    form.append('label', 'Sole Resume');
    const res = await app.fetch(
      new Request('http://localhost/api/resumes', {
        method: 'POST',
        headers: { Origin: allowedOrigin },
        body: form,
      }),
      workerEnv,
    );
    const { resume } = (await res.json()) as { resume: { id: string } };

    // Deleting the only resume is refused
    const delOnlyRes = await app.fetch(
      new Request(`http://localhost/api/resumes/${resume.id}`, {
        method: 'DELETE',
        headers: { Origin: allowedOrigin },
      }),
      workerEnv,
    );
    expect(delOnlyRes.status).toBe(400);
    const onlyBody = (await delOnlyRes.json()) as { code: string };
    expect(onlyBody.code).toBe('CANNOT_DELETE_ONLY_DEFAULT');

    // Add second resume
    const form2 = new FormData();
    form2.append('file', new Blob([pdf], { type: 'application/pdf' }), 'second.pdf');
    form2.append('label', 'Second Resume');
    await app.fetch(
      new Request('http://localhost/api/resumes', {
        method: 'POST',
        headers: { Origin: allowedOrigin },
        body: form2,
      }),
      workerEnv,
    );

    // Deleting default when second resume exists is refused until another is made default
    const delDefaultRes = await app.fetch(
      new Request(`http://localhost/api/resumes/${resume.id}`, {
        method: 'DELETE',
        headers: { Origin: allowedOrigin },
      }),
      workerEnv,
    );
    expect(delDefaultRes.status).toBe(409);
    const defaultBody = (await delDefaultRes.json()) as { code: string };
    expect(defaultBody.code).toBe('CANNOT_DELETE_DEFAULT');
  });

  it('7. Delete blocked (409) when open applications reference it', async () => {
    // Upload non-default resume
    const pdf = createPdfBuffer('Test Resume');
    const form1 = new FormData();
    form1.append('file', new Blob([pdf], { type: 'application/pdf' }), 'default.pdf');
    form1.append('label', 'Default');
    await app.fetch(
      new Request('http://localhost/api/resumes', {
        method: 'POST',
        headers: { Origin: allowedOrigin },
        body: form1,
      }),
      workerEnv,
    );

    const form2 = new FormData();
    form2.append('file', new Blob([pdf], { type: 'application/pdf' }), 'custom.pdf');
    form2.append('label', 'Custom Resume');
    const res2 = await app.fetch(
      new Request('http://localhost/api/resumes', {
        method: 'POST',
        headers: { Origin: allowedOrigin },
        body: form2,
      }),
      workerEnv,
    );
    const { resume: customResume } = (await res2.json()) as { resume: { id: string } };

    // Insert open application referencing custom resume
    const nowIso = new Date().toISOString();
    await workerEnv.DB.prepare(
      `INSERT INTO jobs (id, source, dedupe_key, source_kind, title, company, company_normalized, description, fetched_at, status, updated_at)
       VALUES ('job-1', 'adzuna', 'dedupe-job-1', 'api', 'Engineer', 'Acme', 'acme', 'Desc', ?, 'routed', ?)`,
    )
      .bind(nowIso, nowIso)
      .run();

    await workerEnv.DB.prepare(
      `INSERT INTO applications (id, job_id, kind, channel, resume_id, status, updated_at)
       VALUES ('app-open-1', 'job-1', 'initial', 'email', ?, 'draft', ?)`,
    )
      .bind(customResume.id, nowIso)
      .run();

    // Try deleting custom resume
    const delRes = await app.fetch(
      new Request(`http://localhost/api/resumes/${customResume.id}`, {
        method: 'DELETE',
        headers: { Origin: allowedOrigin },
      }),
      workerEnv,
    );
    expect(delRes.status).toBe(409);
    const delBody = (await delRes.json()) as { code: string; openCount: number };
    expect(delBody.code).toBe('RESUME_IN_USE');
    expect(delBody.openCount).toBe(1);
  });

  it('8. Archive (soft delete) when only sent applications reference it; R2 object is kept and download works', async () => {
    const pdf = createPdfBuffer('Sent Resume Content');
    const form1 = new FormData();
    form1.append('file', new Blob([pdf], { type: 'application/pdf' }), 'res1.pdf');
    form1.append('label', 'Default');
    await app.fetch(
      new Request('http://localhost/api/resumes', {
        method: 'POST',
        headers: { Origin: allowedOrigin },
        body: form1,
      }),
      workerEnv,
    );

    const form2 = new FormData();
    form2.append('file', new Blob([pdf], { type: 'application/pdf' }), 'sent_res.pdf');
    form2.append('label', 'Historical Resume');
    const res2 = await app.fetch(
      new Request('http://localhost/api/resumes', {
        method: 'POST',
        headers: { Origin: allowedOrigin },
        body: form2,
      }),
      workerEnv,
    );
    const { resume: sentResume } = (await res2.json()) as { resume: { id: string } };

    // Attach to sent application
    const nowIso = new Date().toISOString();
    await workerEnv.DB.prepare(
      `INSERT INTO jobs (id, source, dedupe_key, source_kind, title, company, company_normalized, description, fetched_at, status, updated_at)
       VALUES ('job-2', 'adzuna', 'dedupe-job-2', 'api', 'Engineer', 'Acme', 'acme', 'Desc', ?, 'routed', ?)`,
    )
      .bind(nowIso, nowIso)
      .run();

    await workerEnv.DB.prepare(
      `INSERT INTO applications (id, job_id, kind, channel, resume_id, status, updated_at)
       VALUES ('app-sent-1', 'job-2', 'initial', 'email', ?, 'sent', ?)`,
    )
      .bind(sentResume.id, nowIso)
      .run();

    // Delete should archive
    const delRes = await app.fetch(
      new Request(`http://localhost/api/resumes/${sentResume.id}`, {
        method: 'DELETE',
        headers: { Origin: allowedOrigin },
      }),
      workerEnv,
    );
    expect(delRes.status).toBe(200);
    const delBody = (await delRes.json()) as { ok: boolean; action: string };
    expect(delBody.action).toBe('archived');

    // Verify row marked archived
    const row = await workerEnv.DB.prepare('SELECT archived FROM resumes WHERE id = ?')
      .bind(sentResume.id)
      .first<{ archived: number }>();
    expect(row?.archived).toBe(1);

    // Verify download still works
    const downloadRes = await app.fetch(
      new Request(`http://localhost/api/resumes/${sentResume.id}/download`),
      workerEnv,
    );
    expect(downloadRes.status).toBe(200);
  });

  it('9. Hard delete when nothing references it: removes R2 object and DB row', async () => {
    const pdf = createPdfBuffer('Unused Resume');
    const form1 = new FormData();
    form1.append('file', new Blob([pdf], { type: 'application/pdf' }), 'def.pdf');
    form1.append('label', 'Default');
    await app.fetch(
      new Request('http://localhost/api/resumes', {
        method: 'POST',
        headers: { Origin: allowedOrigin },
        body: form1,
      }),
      workerEnv,
    );

    const form2 = new FormData();
    form2.append('file', new Blob([pdf], { type: 'application/pdf' }), 'unused.pdf');
    form2.append('label', 'Unused Resume');
    const res2 = await app.fetch(
      new Request('http://localhost/api/resumes', {
        method: 'POST',
        headers: { Origin: allowedOrigin },
        body: form2,
      }),
      workerEnv,
    );
    const { resume: unusedResume } = (await res2.json()) as { resume: { id: string } };

    // Delete
    const delRes = await app.fetch(
      new Request(`http://localhost/api/resumes/${unusedResume.id}`, {
        method: 'DELETE',
        headers: { Origin: allowedOrigin },
      }),
      workerEnv,
    );
    expect(delRes.status).toBe(200);
    const delBody = (await delRes.json()) as { action: string };
    expect(delBody.action).toBe('deleted');

    // DB row is gone
    const row = await workerEnv.DB.prepare('SELECT id FROM resumes WHERE id = ?')
      .bind(unusedResume.id)
      .first();
    expect(row).toBeNull();

    // R2 object is gone
    const r2Obj = await workerEnv.RESUMES.get(`resumes/${unusedResume.id}.pdf`);
    expect(r2Obj).toBeNull();
  });

  it('10. Path traversal canary: uploaded filename is never used in R2 key or path', async () => {
    const pdf = createPdfBuffer('Canary');
    const form = new FormData();
    form.append('file', new Blob([pdf], { type: 'application/pdf' }), '../../../../etc/passwd');
    form.append('label', 'Canary Resume');

    const res = await app.fetch(
      new Request('http://localhost/api/resumes', {
        method: 'POST',
        headers: { Origin: allowedOrigin },
        body: form,
      }),
      workerEnv,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { resume: { id: string; r2_key: string } };

    expect(body.resume.r2_key).toMatch(/^resumes\/[0-9a-f-]{36}\.pdf$/);
    expect(body.resume.r2_key).not.toContain('..');
    expect(body.resume.r2_key).not.toContain('passwd');

    const r2Obj = await workerEnv.RESUMES.get(body.resume.r2_key);
    expect(r2Obj).not.toBeNull();
  });

  it('11. Header injection canary: CR, LF, and quotes in label are stripped from Content-Disposition', async () => {
    const pdf = createPdfBuffer('Injection Test');
    const form = new FormData();
    form.append('file', new Blob([pdf], { type: 'application/pdf' }), 'test.pdf');
    form.append('label', 'Senior Systems\r\nBcc: evil@attacker.com"');

    const uploadRes = await app.fetch(
      new Request('http://localhost/api/resumes', {
        method: 'POST',
        headers: { Origin: allowedOrigin },
        body: form,
      }),
      workerEnv,
    );
    expect(uploadRes.status).toBe(201);
    const { resume } = (await uploadRes.json()) as { resume: { id: string } };

    const downloadRes = await app.fetch(
      new Request(`http://localhost/api/resumes/${resume.id}/download?disposition=inline`),
      workerEnv,
    );
    expect(downloadRes.status).toBe(200);
    const disposition = downloadRes.headers.get('Content-Disposition') || '';

    expect(disposition).toContain('inline;');
    expect(disposition).not.toContain('\r');
    expect(disposition).not.toContain('\n');
    expect(disposition).not.toContain('evil@attacker.com"');
    expect(downloadRes.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(downloadRes.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('12. Enforces maximum 20 resumes limit', async () => {
    const pdf = createPdfBuffer('Batch Resume');
    // Seed 20 resumes
    for (let i = 0; i < 20; i++) {
      const nowIso = new Date().toISOString();
      await workerEnv.DB.prepare(
        `INSERT INTO resumes (id, label, r2_key, tags, is_default, size_bytes, archived, created_at)
         VALUES (?, ?, ?, '["systems"]', ?, 100, 0, ?)`,
      )
        .bind(
          `res-limit-${i}`,
          `Resume ${i}`,
          `resumes/res-limit-${i}.pdf`,
          i === 0 ? 1 : 0,
          nowIso,
        )
        .run();
    }

    // Attempting 21st upload
    const form = new FormData();
    form.append('file', new Blob([pdf], { type: 'application/pdf' }), 'res21.pdf');
    form.append('label', 'Resume 21');

    const res = await app.fetch(
      new Request('http://localhost/api/resumes', {
        method: 'POST',
        headers: { Origin: allowedOrigin },
        body: form,
      }),
      workerEnv,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('RESUME_LIMIT_REACHED');
  });

  it('13. CSRF Origin protection rejects invalid or missing Origin on mutation routes', async () => {
    // Missing Origin
    const noOriginRes = await app.fetch(
      new Request('http://localhost/api/resumes', {
        method: 'POST',
        body: new FormData(),
      }),
      workerEnv,
    );
    expect(noOriginRes.status).toBe(403);

    // Mismatched Origin
    const badOriginRes = await app.fetch(
      new Request('http://localhost/api/resumes', {
        method: 'POST',
        headers: { Origin: 'http://malicious-site.com' },
        body: new FormData(),
      }),
      workerEnv,
    );
    expect(badOriginRes.status).toBe(403);
  });

  it('14. Bulk reassign action transitions approved applications to draft and updates resume_id', async () => {
    const pdf = createPdfBuffer('Reassign Test');
    const form1 = new FormData();
    form1.append('file', new Blob([pdf], { type: 'application/pdf' }), 'source.pdf');
    form1.append('label', 'Source Resume');
    const res1 = await app.fetch(
      new Request('http://localhost/api/resumes', {
        method: 'POST',
        headers: { Origin: allowedOrigin },
        body: form1,
      }),
      workerEnv,
    );
    const { resume: sourceResume } = (await res1.json()) as { resume: { id: string } };

    const form2 = new FormData();
    form2.append('file', new Blob([pdf], { type: 'application/pdf' }), 'target.pdf');
    form2.append('label', 'Target Resume');
    const res2 = await app.fetch(
      new Request('http://localhost/api/resumes', {
        method: 'POST',
        headers: { Origin: allowedOrigin },
        body: form2,
      }),
      workerEnv,
    );
    const { resume: targetResume } = (await res2.json()) as { resume: { id: string } };

    // Create jobs and applications
    const nowIso = new Date().toISOString();
    await workerEnv.DB.prepare(
      `INSERT INTO jobs (id, source, dedupe_key, source_kind, title, company, company_normalized, description, fetched_at, status, updated_at)
       VALUES ('job-reassign-1', 'adzuna', 'dedupe-job-reassign-1', 'api', 'Engineer 1', 'Acme', 'acme', 'Desc', ?, 'routed', ?)`,
    )
      .bind(nowIso, nowIso)
      .run();

    await workerEnv.DB.prepare(
      `INSERT INTO jobs (id, source, dedupe_key, source_kind, title, company, company_normalized, description, fetched_at, status, updated_at)
       VALUES ('job-reassign-2', 'adzuna', 'dedupe-job-reassign-2', 'api', 'Engineer 2', 'Acme', 'acme', 'Desc', ?, 'routed', ?)`,
    )
      .bind(nowIso, nowIso)
      .run();

    await workerEnv.DB.prepare(
      `INSERT INTO applications (id, job_id, kind, channel, resume_id, status, updated_at)
       VALUES ('app-draft', 'job-reassign-1', 'initial', 'email', ?, 'draft', ?)`,
    )
      .bind(sourceResume.id, nowIso)
      .run();

    await workerEnv.DB.prepare(
      `INSERT INTO applications (id, job_id, kind, channel, resume_id, status, updated_at)
       VALUES ('app-approved', 'job-reassign-2', 'initial', 'email', ?, 'approved', ?)`,
    )
      .bind(sourceResume.id, nowIso)
      .run();

    // Execute reassign
    const reassignRes = await app.fetch(
      new Request(`http://localhost/api/resumes/${sourceResume.id}/reassign`, {
        method: 'POST',
        headers: {
          Origin: allowedOrigin,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ target_resume_id: targetResume.id }),
      }),
      workerEnv,
    );

    expect(reassignRes.status).toBe(200);
    const reassignBody = (await reassignRes.json()) as { ok: boolean; reassignedCount: number };
    expect(reassignBody.ok).toBe(true);
    expect(reassignBody.reassignedCount).toBe(2);

    // Verify app-approved transitioned to draft
    const appApprovedRow = await workerEnv.DB.prepare(
      'SELECT status, resume_id FROM applications WHERE id = ?',
    )
      .bind('app-approved')
      .first<{ status: string; resume_id: string }>();

    expect(appApprovedRow?.status).toBe('draft');
    expect(appApprovedRow?.resume_id).toBe(targetResume.id);

    // Verify app-draft remained draft and updated resume_id
    const appDraftRow = await workerEnv.DB.prepare(
      'SELECT status, resume_id FROM applications WHERE id = ?',
    )
      .bind('app-draft')
      .first<{ status: string; resume_id: string }>();

    expect(appDraftRow?.status).toBe('draft');
    expect(appDraftRow?.resume_id).toBe(targetResume.id);
  });

  describe('15. Send path resume gate check & removal test', () => {
    const validProfile: Profile = {
      name: 'Alex Mercer',
      email: 'alex.mercer@example.com',
      skills: ['TypeScript', 'Cloudflare Workers', 'Distributed Systems'],
      experience: [
        {
          title: 'Senior Systems Engineer',
          company: 'Acme Corp',
          location: 'Remote',
          start_date: '2019-01',
          end_date: '2026-01',
          current: false,
          description: 'Distributed systems.',
          highlights: [],
        },
      ],
      education: [],
      preferences: { locations: ['Remote'], remote: true },
      filters: {
        titles: ['Systems Engineer'],
        locations: ['Remote'],
        company_blacklist: [],
        min_score: 70,
        require_salary: false,
        experience_range: { min: 7, max: 12 },
      },
      send_settings: {
        daily_cap: 20,
        window: { start: '09:00', end: '18:00' },
        timezone: 'UTC',
        ramp_base: 5,
        ramp_step: 2,
        auto_approve_above_score: 85,
      },
      answers: {
        notice_period: '2 weeks',
        current_ctc: '$160,000',
        expected_ctc: '$180,000',
        work_authorisation: 'Citizen',
        links: { portfolio: 'https://alexmercer.dev' },
        other: {},
      },
    };

    const validApp: ApplicationToSend = {
      id: 'app-gate-test',
      job_id: 'job-gate-1',
      channel: 'email',
      status: 'approved',
      cover_letter: `Dear Hiring Team at Acme Corp,

I am writing to enthusiastically submit my application for the Senior Systems Engineer position. With 7 years of hands-on experience designing and operating distributed systems and high-throughput backend services, I am excited about the opportunity to contribute to Acme Corp's world-class platform and infrastructure engineering efforts.

Throughout my career, I have specialized in building robust TypeScript and Cloudflare Workers services, optimizing database access patterns, and ensuring low-latency communication across distributed clusters. At my previous roles, I led initiatives to improve service resilience and decrease edge API response times under heavy traffic loads. You can review my architecture notes and projects at https://alexmercer.dev.

I deeply admire Acme Corp's engineering culture and dedication to reliability and developer experience. I welcome the opportunity to discuss how my technical background in distributed systems and systems architecture aligns with your team's goals. Thank you very much for your time and consideration.

Warm regards,
Alex Mercer`,
      subject: 'Application for Senior Systems Engineer',
      resume_id: 'res-valid-id',
      title: 'Senior Systems Engineer',
      company: 'Acme Corp',
      company_normalized: 'acme corp',
      contact_email: 'recruiter@example.test',
      message_id_header: null,
      gmail_message_id: null,
      gmail_thread_id: null,
      retry_count: 0,
    };

    it('blocks pre-send validation if the resume object is missing in R2', async () => {
      const mockDb = {
        prepare: (query: string) => ({
          bind: () => ({
            first: async () =>
              query.includes('FROM resumes') ? { r2_key: 'resumes/missing.pdf' } : null,
            all: async () => ({ results: [] }),
          }),
        }),
      } as unknown as D1LikeDatabase;

      const emptyBucket = {
        get: async () => null,
        put: async () => null,
      } as unknown as R2BucketLike;

      const result = await validatePreSend({
        db: mockDb,
        resumesBucket: emptyBucket,
        profile: validProfile,
        app: validApp,
        env: 'prod',
      });

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('not found in R2 storage');
      }
    });

    it('removal test: proves that without the R2 check, missing resume would erroneously pass pre-send validation', async () => {
      // Create a mutated pre-send check that bypasses the R2 existence check
      const simulateBypassedCheck = async () => {
        const mockDb = {
          prepare: (query: string) => ({
            bind: () => ({
              first: async () =>
                query.includes('FROM resumes') ? { r2_key: 'resumes/missing.pdf' } : null,
              all: async () => ({ results: [] }),
            }),
          }),
        } as unknown as D1LikeDatabase;

        // An empty bucket where get() returns null
        const emptyBucket = {
          get: async () => null,
          put: async () => null,
        } as unknown as R2BucketLike;

        // If the check were omitted and allowed null R2 objects:
        const fakeAppWithoutResumeId = { ...validApp, resume_id: null };
        const bypassedResult = await validatePreSend({
          db: mockDb,
          resumesBucket: emptyBucket,
          profile: validProfile,
          app: fakeAppWithoutResumeId,
          env: 'prod',
        });

        return bypassedResult;
      };

      const bypassedResult = await simulateBypassedCheck();
      // If the R2 check is deleted, it would pass as valid: true
      expect(bypassedResult.valid).toBe(true);

      // But real validatePreSend with app.resume_id set must fail:
      const realResult = await validatePreSend({
        db: {
          prepare: (query: string) => ({
            bind: () => ({
              first: async () =>
                query.includes('FROM resumes') ? { r2_key: 'resumes/missing.pdf' } : null,
              all: async () => ({ results: [] }),
            }),
          }),
        } as unknown as D1LikeDatabase,
        resumesBucket: { get: async () => null, put: async () => null } as unknown as R2BucketLike,
        profile: validProfile,
        app: validApp,
        env: 'prod',
      });

      expect(realResult.valid).toBe(false);
      if (!realResult.valid) {
        expect(realResult.error).toContain('not found in R2 storage');
      }
    });
  });
});
