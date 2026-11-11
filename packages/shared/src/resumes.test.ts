import { describe, it, expect } from 'vitest';
import { UpdateResumeSchema, normalizeResumeTags, formatContentDisposition } from './resumes.js';

describe('Resume Validation and Helpers', () => {
  it('normalizes tags: lowercases, trims, and deduplicates', () => {
    const raw = [' TypeScript ', 'TYPESCRIPT', 'react', 'Node.JS', ' '];
    const tags = normalizeResumeTags(raw);
    expect(tags).toEqual(['typescript', 'react', 'node.js']);
  });

  it('normalizes tags from comma-separated string', () => {
    const raw = 'Cloudflare, workers, R2, Cloudflare ';
    const tags = normalizeResumeTags(raw);
    expect(tags).toEqual(['cloudflare', 'workers', 'r2']);
  });

  it('normalizes tags from JSON array string', () => {
    const raw = JSON.stringify(['Distributed', 'Systems', 'systems']);
    const tags = normalizeResumeTags(raw);
    expect(tags).toEqual(['distributed', 'systems']);
  });

  it('validates UpdateResumeSchema with valid inputs', () => {
    const result = UpdateResumeSchema.safeParse({
      label: 'Staff Systems Engineer',
      tags: ['systems', 'distributed', 'c++'],
      is_default: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tags).toEqual(['systems', 'distributed', 'c++']);
    }
  });

  it('rejects invalid tag characters in UpdateResumeSchema', () => {
    const result = UpdateResumeSchema.safeParse({
      label: 'Staff Engineer',
      tags: ['systems$', 'hello world!'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty or whitespace-only label in UpdateResumeSchema', () => {
    const result = UpdateResumeSchema.safeParse({
      label: '   ',
    });
    expect(result.success).toBe(false);
  });

  it('formats Content-Disposition with sanitized ASCII and RFC 5987 UTF-8', () => {
    const dis = formatContentDisposition('Alex Mercer - Systems & Cloud');
    expect(dis).toContain('attachment; filename="Alex Mercer - Systems & Cloud.pdf"');
    expect(dis).toContain("filename*=UTF-8''Alex%20Mercer%20-%20Systems%20%26%20Cloud.pdf");
  });

  it('sanitizes CR, LF, and double quotes from Content-Disposition headers', () => {
    const dis = formatContentDisposition('Hacker\r\nInjected"Name', 'inline');
    expect(dis).toContain('inline;');
    expect(dis).not.toContain('\r');
    expect(dis).not.toContain('\n');
    expect(dis).not.toContain('"Name');
  });
});
