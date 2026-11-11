import { z } from 'zod';

export const RESUME_TAG_REGEX = /^[a-z0-9+#._-]+$/;
export const MAX_RESUMES_COUNT = 20;

export const ResumeTagSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'Tag cannot be empty')
  .max(24, 'Tag cannot exceed 24 characters')
  .regex(RESUME_TAG_REGEX, 'Tags may only contain lowercase letters, numbers, +, #, ., _, and -');

export const ResumeTagsArraySchema = z
  .array(ResumeTagSchema)
  .max(10, 'Maximum 10 tags allowed')
  .transform((tags) => Array.from(new Set(tags)));

export const UpdateResumeSchema = z
  .object({
    label: z
      .string()
      .trim()
      .min(1, 'Resume label is required')
      .max(80, 'Resume label cannot exceed 80 characters')
      .optional(),
    tags: z
      .union([z.array(z.string()).max(50), z.string()])
      .transform((val) => normalizeResumeTags(val))
      .pipe(ResumeTagsArraySchema)
      .optional(),
    is_default: z.boolean().optional(),
  })
  .strict();

export type UpdateResumeInput = z.infer<typeof UpdateResumeSchema>;

export const ReassignResumeSchema = z
  .object({
    target_resume_id: z.string().trim().min(1, 'Target resume ID is required'),
  })
  .strict();

export type ReassignResumeInput = z.infer<typeof ReassignResumeSchema>;

export interface ResumeUsage {
  open: number; // draft, needs_review, approved, sending
  sent: number; // sent, manual_applied, etc.
}

export interface ResumeSummary {
  id: string;
  label: string;
  tags: string[];
  is_default: boolean;
  size_bytes: number;
  created_at: string;
  archived: boolean;
  usage: ResumeUsage;
  download_url: string;
}

/**
 * Normalizes tags from array or string (JSON array or comma-separated).
 * Converts to lowercase, trims, deduplicates, and limits length.
 */
export function normalizeResumeTags(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return Array.from(new Set(raw.map((t) => String(t).trim().toLowerCase()).filter(Boolean)));
  }

  if (typeof raw !== 'string') {
    return [];
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return normalizeResumeTags(parsed);
      }
    } catch {
      // Fall through to comma-separated
    }
  }

  return Array.from(
    new Set(
      trimmed
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}

/**
 * Sanitizes a label for use in Content-Disposition header.
 * Strips carriage returns, line feeds, quotes, and non-ASCII chars for the basic filename,
 * and encodes with RFC 5987 for filename*.
 */
export function formatContentDisposition(
  label: string,
  disposition: 'attachment' | 'inline' = 'attachment',
): string {
  // Strip CR, LF, and double quotes
  const safeAscii =
    label
      .replace(/[\r\n"]/g, '')
      .replace(/[^\x20-\x7E]/g, '_')
      .trim() || 'resume';

  const asciiFilename = `${safeAscii.endsWith('.pdf') ? safeAscii : `${safeAscii}.pdf`}`;

  // RFC 5987 UTF-8 encoded filename
  const cleanUtf8 = label.replace(/[\r\n"]/g, '').trim() || 'resume';
  const fullUtf8Filename = cleanUtf8.endsWith('.pdf') ? cleanUtf8 : `${cleanUtf8}.pdf`;
  const rfc5987Filename = encodeURIComponent(fullUtf8Filename).replace(/'/g, '%27');

  return `${disposition}; filename="${asciiFilename}"; filename*=UTF-8''${rfc5987Filename}`;
}
