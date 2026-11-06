/**
 * Pigeon Structured JSON Logger
 * Formats log entries as JSON with prefix "pigeon", strictly redacting PII, tokens, and email bodies.
 */

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface StructuredLogEntry {
  prefix: 'pigeon';
  level: LogLevel;
  timestamp: string;
  message: string;
  context?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const SENSITIVE_KEY_REGEX =
  /(token|secret|password|credential|jwt|cookie|auth|api_key|encryption_key|private_key|^key$)/i;
const BODY_FIELD_REGEX = /^(body|cover_letter|raw|raw_email|html|letter)$/i;

/**
 * Mask an email address to preserve domain structure while scrubbing PII (e.g. u***@domain.com).
 */
export function maskEmail(email: string): string {
  const parts = email.split('@');
  if (parts.length !== 2) return '[REDACTED_EMAIL]';
  const user = parts[0] ?? '';
  const domain = parts[1] ?? '';
  const visible = user.slice(0, 1);
  return `${visible}***@${domain}`;
}

/**
 * Sanitize a string by redacting email addresses and authorization tokens.
 */
export function sanitizeString(text: string): string {
  let sanitized = text.replace(EMAIL_REGEX, (match) => maskEmail(match));
  // Mask Bearer tokens
  sanitized = sanitized.replace(/Bearer\s+[a-zA-Z0-9._~+/-]+=*/gi, 'Bearer [REDACTED_TOKEN]');
  return sanitized;
}

/**
 * Deeply sanitize an arbitrary object or value, masking sensitive keys, tokens, emails, and email bodies.
 */
export function sanitizeLogData(data: unknown, depth = 0): unknown {
  if (depth > 6) return '[MAX_DEPTH_REACHED]';
  if (data === null || data === undefined) return data;

  if (typeof data === 'string') {
    return sanitizeString(data);
  }

  if (typeof data === 'number' || typeof data === 'boolean') {
    return data;
  }

  if (data instanceof Error) {
    return {
      name: data.name,
      message: sanitizeString(data.message),
    };
  }

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeLogData(item, depth + 1));
  }

  if (typeof data === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (SENSITIVE_KEY_REGEX.test(key)) {
        result[key] = '[REDACTED_SECRET]';
      } else if (BODY_FIELD_REGEX.test(key)) {
        if (typeof value === 'string') {
          result[key] = `[REDACTED_BODY] (length: ${value.length})`;
        } else {
          result[key] = '[REDACTED_BODY]';
        }
      } else {
        result[key] = sanitizeLogData(value, depth + 1);
      }
    }
    return result;
  }

  return String(data);
}

export class Logger {
  private formatEntry(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
    error?: unknown,
  ): StructuredLogEntry {
    const entry: StructuredLogEntry = {
      prefix: 'pigeon',
      level,
      timestamp: new Date().toISOString(),
      message: sanitizeString(message),
    };

    if (context && Object.keys(context).length > 0) {
      entry.context = sanitizeLogData(context) as Record<string, unknown>;
    }

    if (error) {
      if (error instanceof Error) {
        entry.error = {
          name: error.name,
          message: sanitizeString(error.message),
        };
      } else {
        entry.error = {
          name: 'Error',
          message: sanitizeString(String(error)),
        };
      }
    }

    return entry;
  }

  info(message: string, context?: Record<string, unknown>): void {
    const entry = this.formatEntry('info', message, context);
    console.log(JSON.stringify(entry));
  }

  warn(message: string, context?: Record<string, unknown>): void {
    const entry = this.formatEntry('warn', message, context);
    console.warn(JSON.stringify(entry));
  }

  error(message: string, errorOrContext?: unknown): void {
    let context: Record<string, unknown> | undefined;
    let err: unknown;

    if (errorOrContext instanceof Error) {
      err = errorOrContext;
    } else if (typeof errorOrContext === 'object' && errorOrContext !== null) {
      context = errorOrContext as Record<string, unknown>;
    } else if (errorOrContext !== undefined) {
      err = new Error(String(errorOrContext));
    }

    const entry = this.formatEntry('error', message, context, err);
    console.error(JSON.stringify(entry));
  }

  debug(message: string, context?: Record<string, unknown>): void {
    const entry = this.formatEntry('debug', message, context);
    console.debug(JSON.stringify(entry));
  }
}

export const logger = new Logger();
