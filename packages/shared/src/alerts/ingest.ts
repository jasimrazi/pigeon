import PostalMime from 'postal-mime';
import type { D1LikeDatabase } from '../state-machine.js';
import type { Notifier } from '../notifier.js';
import type { AlertIngestResult, PortalType } from './types.js';
import { ParsedAlertJobsSchema } from './types.js';
import { isAllowedSender, isAuthorizedForwarding } from './validator.js';
import { detectPortal, parseAlertEmail } from './parsers/index.js';
import { handleParserHealth } from './parser-health.js';
import { cleanTrackingUrl } from './tracking-cleaner.js';
import { computeDedupeKey, normalizeCompanyName } from '../sources/dedupe.js';
import { parseSalary } from '../sources/salary.js';
import { stripHtml } from '../sources/html-utils.js';

export interface AlertIngestEnvelope {
  from?: string | undefined;
  to?: string | undefined;
  headers?:
    | {
        get(name: string): string | null;
      }
    | undefined;
}

export interface AlertIngestOptions {
  db: D1LikeDatabase;
  envelope?: AlertIngestEnvelope | undefined;
  configuredForwardingAddress?: string | undefined;
  notifier?: Notifier | undefined;
  nowIso?: string | undefined;
}

export async function ingestAlertEmail(
  rawEmail: ReadableStream<Uint8Array> | ArrayBuffer | string,
  options: AlertIngestOptions,
): Promise<AlertIngestResult> {
  const { db, envelope, configuredForwardingAddress, notifier } = options;
  const nowIso = options.nowIso || new Date().toISOString();

  // 1. Parse email using PostalMime
  // PostalMime supports ReadableStream, ArrayBuffer, or string
  const email = await new PostalMime().parse(rawEmail);

  const originalFromAddress = email.from?.address || '';
  const envelopeSender = envelope?.from || '';
  const recipientAddress = envelope?.to || email.to?.[0]?.address || '';

  // 2. Validate sender domain allowlist against the original From: header
  if (!isAllowedSender(originalFromAddress)) {
    const dropEventId = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO events (id, entity, entity_id, type, payload, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        dropEventId,
        'email_alert',
        dropEventId,
        'email_dropped',
        JSON.stringify({
          reason: 'unauthorized_sender',
          from: originalFromAddress,
          to: recipientAddress,
        }),
        nowIso,
      )
      .run();

    return {
      portal: 'fallback',
      dropped: true,
      dropReason: 'unauthorized_sender',
      jobsFound: 0,
      newJobs: 0,
      duplicates: 0,
      emptyStreak: 0,
      isSuspect: false,
      untrusted: false,
    };
  }

  // 3. Strictly validate that the envelope sender equals the configured forwarding address
  const isAuthorized = isAuthorizedForwarding({
    envelopeSender,
    configuredAddress: configuredForwardingAddress,
  });

  if (!isAuthorized) {
    const dropEventId = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO events (id, entity, entity_id, type, payload, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        dropEventId,
        'email_alert',
        dropEventId,
        'email_dropped',
        JSON.stringify({
          reason: 'invalid_forwarding_address',
          from: envelopeSender || originalFromAddress,
          to: recipientAddress,
        }),
        nowIso,
      )
      .run();

    return {
      portal: 'fallback',
      dropped: true,
      dropReason: 'invalid_forwarding_address',
      jobsFound: 0,
      newJobs: 0,
      duplicates: 0,
      emptyStreak: 0,
      isSuspect: false,
      untrusted: false,
    };
  }

  // 4. Detect portal from the original From: address
  const portal: PortalType = detectPortal(originalFromAddress);

  // 5. Parse jobs from HTML (or plain text fallback)
  const htmlContent = email.html || email.text || '';
  const parsedJobs = ParsedAlertJobsSchema.parse(parseAlertEmail(portal, htmlContent));

  // 6. Handle parser health and empty streak tracking
  const health = await handleParserHealth({
    db,
    portal,
    jobsCount: parsedJobs.length,
    notifier,
    nowIso,
  });

  // 7. Normalize, deduplicate, and insert
  let newJobs = 0;
  let duplicates = 0;

  for (const job of parsedJobs) {
    const cleanTitle = stripHtml(job.title);
    const cleanCompany = stripHtml(job.company);
    const companyNorm = normalizeCompanyName(cleanCompany);
    const applyUrl = cleanTrackingUrl(job.apply_url);
    const locBucket = job.location ? stripHtml(job.location) : null;
    const isRemote =
      locBucket?.toLowerCase().includes('remote') ||
      cleanTitle.toLowerCase().includes('remote') ||
      null;

    const salary = job.salary_raw ? parseSalary(job.salary_raw) : null;

    const dedupeKey = await computeDedupeKey(cleanCompany, cleanTitle, locBucket, isRemote);

    // Check if job already exists in D1
    const existing = await db
      .prepare(`SELECT id FROM jobs WHERE dedupe_key = ?`)
      .bind(dedupeKey)
      .first<{ id: string }>();

    if (existing) {
      duplicates++;
      continue;
    }

    const jobId = crypto.randomUUID();

    await db
      .prepare(
        `INSERT INTO jobs (
          id, dedupe_key, source, source_kind, source_job_id,
          title, company, company_normalized, location, remote,
          salary_min, salary_max, currency, salary_raw,
          description, apply_url, contact_email, contact_source,
          posted_at, fetched_at, status, apply_route, route_reason,
          untrusted, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        jobId,
        dedupeKey,
        portal,
        'alert_email',
        applyUrl,
        cleanTitle,
        cleanCompany,
        companyNorm,
        locBucket,
        isRemote ? 1 : 0,
        salary?.salary_min ?? null,
        salary?.salary_max ?? null,
        salary?.currency ?? null,
        job.salary_raw ?? null,
        stripHtml(job.description) || `${cleanTitle} at ${cleanCompany}`,
        applyUrl,
        null, // contact_email is strictly null for alert_email
        'none', // contact_source is none
        nowIso,
        nowIso,
        'new',
        null, // apply_route is null at ingest (phase 4 router owns routing)
        null, // route_reason is null at ingest
        health.portalUntrusted ? 1 : 0,
        nowIso,
      )
      .run();

    newJobs++;
  }

  return {
    portal,
    dropped: false,
    jobsFound: parsedJobs.length,
    newJobs,
    duplicates,
    emptyStreak: health.streak,
    isSuspect: health.isSuspect,
    untrusted: health.portalUntrusted,
  };
}
