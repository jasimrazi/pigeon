import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  Logger,
  logger,
  maskEmail,
  sanitizeString,
  sanitizeLogData,
  type StructuredLogEntry,
} from './logger.js';

describe('Structured JSON Logger', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleDebugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('PII and Secret Sanitization', () => {
    it('masks email addresses properly', () => {
      expect(maskEmail('recruiter@acme.com')).toBe('r***@acme.com');
      expect(maskEmail('candidate.john@example.org')).toBe('c***@example.org');
      expect(maskEmail('invalid')).toBe('[REDACTED_EMAIL]');
    });

    it('sanitizes strings containing emails and Bearer tokens', () => {
      const input = 'Sent email to recruiter@example.com with Bearer eyJhbGciOi...';
      const output = sanitizeString(input);
      expect(output).toContain('r***@example.com');
      expect(output).toContain('Bearer [REDACTED_TOKEN]');
      expect(output).not.toContain('recruiter@example.com');
    });

    it('redacts sensitive object keys (tokens, secrets, passwords)', () => {
      const sensitiveData = {
        api_key: 'secret-12345',
        client_secret: 'top-secret',
        jwt_token: 'token-abc',
        password: 'pass',
        normal_key: 'visible-value',
      };

      const sanitized = sanitizeLogData(sensitiveData) as Record<string, unknown>;
      expect(sanitized.api_key).toBe('[REDACTED_SECRET]');
      expect(sanitized.client_secret).toBe('[REDACTED_SECRET]');
      expect(sanitized.jwt_token).toBe('[REDACTED_SECRET]');
      expect(sanitized.password).toBe('[REDACTED_SECRET]');
      expect(sanitized.normal_key).toBe('visible-value');
    });

    it('redacts full email and cover letter bodies', () => {
      const data = {
        id: 'app-1',
        cover_letter: 'Dear Hiring Manager, I am thrilled to apply for the position...',
        raw_email: 'MIME-Version: 1.0\nFrom: jobs@linkedin.com...',
      };

      const sanitized = sanitizeLogData(data) as Record<string, unknown>;
      expect(sanitized.cover_letter).toContain('[REDACTED_BODY] (length: ');
      expect(sanitized.raw_email).toContain('[REDACTED_BODY] (length: ');
      expect(sanitized.cover_letter).not.toContain('Dear Hiring Manager');
    });

    it('masks emails inside nested structures', () => {
      const nested = {
        company: 'Stripe',
        recruiter: {
          email: 'jane@stripe.com',
          status: 'pending',
        },
        recipients: ['bob@stripe.com', 'alice@stripe.com'],
      };

      const sanitized = sanitizeLogData(nested) as {
        recruiter: { email: string; status: string };
        recipients: string[];
      };
      expect(sanitized.recruiter.email).toBe('j***@stripe.com');
      expect(sanitized.recipients[0]).toBe('b***@stripe.com');
      expect(sanitized.recipients[1]).toBe('a***@stripe.com');
    });
  });

  describe('Logger JSON Output', () => {
    it('outputs valid JSON with prefix "pigeon" for info', () => {
      const testLogger = new Logger();
      testLogger.info('Job ingestion completed', { source: 'adzuna', count: 12 });

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const rawLog = consoleLogSpy.mock.calls[0][0];
      const parsed: StructuredLogEntry = JSON.parse(rawLog);

      expect(parsed.prefix).toBe('pigeon');
      expect(parsed.level).toBe('info');
      expect(parsed.message).toBe('Job ingestion completed');
      expect(parsed.context).toEqual({ source: 'adzuna', count: 12 });
      expect(parsed.timestamp).toBeDefined();
    });

    it('outputs warn logs with prefix "pigeon"', () => {
      logger.warn('Rate limit approaching', { remaining: 5 });

      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      const parsed: StructuredLogEntry = JSON.parse(consoleWarnSpy.mock.calls[0][0]);
      expect(parsed.prefix).toBe('pigeon');
      expect(parsed.level).toBe('warn');
      expect(parsed.message).toBe('Rate limit approaching');
      expect(parsed.context).toEqual({ remaining: 5 });
    });

    it('outputs error logs with sanitized Error object', () => {
      logger.error('Failed to send email to contact@victim.com', new Error('API error'));

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      const parsed: StructuredLogEntry = JSON.parse(consoleErrorSpy.mock.calls[0][0]);
      expect(parsed.prefix).toBe('pigeon');
      expect(parsed.level).toBe('error');
      expect(parsed.message).toBe('Failed to send email to c***@victim.com');
      expect(parsed.error?.name).toBe('Error');
      expect(parsed.error?.message).toBe('API error');
    });

    it('outputs debug logs with prefix "pigeon"', () => {
      logger.debug('State machine evaluated', { state: 'routed' });

      expect(consoleDebugSpy).toHaveBeenCalledTimes(1);
      const parsed: StructuredLogEntry = JSON.parse(consoleDebugSpy.mock.calls[0][0]);
      expect(parsed.prefix).toBe('pigeon');
      expect(parsed.level).toBe('debug');
    });
  });
});
