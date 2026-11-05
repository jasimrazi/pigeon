import type { ApplicationToSync } from './types.js';

export const SHEET_COLUMNS = [
  'Application ID',
  'Date',
  'Company',
  'Role',
  'Source',
  'Channel',
  'Job link',
  'Location',
  'Salary',
  'Contact email',
  'Resume used',
  'Match score',
  'Route reason',
  'Status',
  'Applied or sent at',
  'Last updated',
  'Notes',
] as const;

export type SheetColumnName = (typeof SHEET_COLUMNS)[number];

/**
 * Sanitizes a cell value to prevent formula injection in Google Sheets (Rule 9).
 * Prefixes any string that starts with =, +, -, or @ with an apostrophe (').
 * Keeps numeric match scores as numbers and leaves plain text unaffected.
 */
export function sanitizeSheetCell(val: unknown): string | number {
  if (val === null || val === undefined) {
    return '';
  }
  if (typeof val === 'number') {
    return val;
  }
  if (typeof val === 'boolean') {
    return val ? 'TRUE' : 'FALSE';
  }

  const str = String(val);
  // Formula injection check: starts with =, +, -, @ (including leading whitespace)
  if (/^[\s]*[=+\-@]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

/**
 * Formats job salary information for Google Sheets.
 * If salary information is missing, renders "Not listed".
 */
export function formatSalaryForSheet(
  salaryRaw?: string | null,
  salaryMin?: number | null,
  salaryMax?: number | null,
  currency?: string | null,
): string {
  if (salaryRaw && salaryRaw.trim().length > 0) {
    return salaryRaw.trim();
  }
  if (salaryMin != null && salaryMax != null) {
    const curr = currency || 'USD';
    return `${salaryMin.toLocaleString('en-US')} - ${salaryMax.toLocaleString('en-US')} ${curr}`;
  }
  if (salaryMin != null) {
    const curr = currency || 'USD';
    return `${salaryMin.toLocaleString('en-US')}+ ${curr}`;
  }
  if (salaryMax != null) {
    const curr = currency || 'USD';
    return `Up to ${salaryMax.toLocaleString('en-US')} ${curr}`;
  }
  return 'Not listed';
}

/**
 * Formats date into YYYY-MM-DD.
 */
export function formatDateForSheet(dateStr?: string | null): string {
  if (!dateStr) return '';
  try {
    return dateStr.slice(0, 10);
  } catch {
    return '';
  }
}

/**
 * Builds and sanitizes the 17-column row representation for an application.
 */
export function formatApplicationRow(app: ApplicationToSync): Array<string | number> {
  const dateStr = formatDateForSheet(
    app.applied_at || app.sent_at || app.scheduled_at || app.updated_at,
  );
  const channelStr = app.channel === 'email' ? 'Email' : 'Manual';
  const salaryStr = formatSalaryForSheet(
    app.salary_raw,
    app.salary_min,
    app.salary_max,
    app.currency,
  );
  const resumeStr = app.resume_label || app.resume_id || 'None';
  const appliedOrSentStr = app.applied_at || app.sent_at || '';

  const rawRow: unknown[] = [
    app.id,
    dateStr,
    app.company,
    app.title,
    app.source,
    channelStr,
    app.apply_url || '',
    app.location || '',
    salaryStr,
    app.contact_email || '',
    resumeStr,
    app.match_score != null ? app.match_score : '',
    app.route_reason || '',
    app.status,
    appliedOrSentStr,
    app.updated_at,
    app.notes || '',
  ];

  return rawRow.map(sanitizeSheetCell);
}
