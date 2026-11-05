import type { D1LikeDatabase } from '../state-machine.js';
import { transition } from '../state-machine.js';
import type { Profile } from '../profile.js';
import { ProfileSchema } from '../profile.js';
import type { ApplicationChannel, ApplicationStatus } from '../schema.js';
import type { CoverLetterGenerator, GeneratedCoverLetter } from './generator.js';
import {
  ResumeSelector,
  type ResumeSelectorOptions,
  type SelectableResume,
} from './resume-selector.js';
import { validateCoverLetter } from './validator.js';

export interface CreateForJobOptions {
  db: D1LikeDatabase;
  jobId: string;
  generator: CoverLetterGenerator;
  profile?: Profile | undefined;
  resumeSelectorOptions?: ResumeSelectorOptions | undefined;
  bannedPhrases?: string[] | undefined;
  nowMs?: number | undefined;
}

export interface ApplicationRow {
  id: string;
  job_id: string;
  kind: 'initial' | 'follow_up';
  channel: ApplicationChannel;
  resume_id: string | null;
  cover_letter: string | null;
  subject: string | null;
  status: ApplicationStatus;
  retry_count: number;
  follow_up_count: number;
  notes: string | null;
  validator_errors: string | null;
  created_at?: string;
  updated_at: string;
}

export interface CreateApplicationResult {
  application: ApplicationRow;
  created: boolean;
  regenerated: boolean;
  validation_passed: boolean;
}

export interface UpdateCoverLetterOptions {
  db: D1LikeDatabase;
  applicationId: string;
  coverLetter: string;
  subject?: string | undefined;
  profile?: Profile | undefined;
  bannedPhrases?: string[] | undefined;
  nowMs?: number | undefined;
}

/**
 * Idempotently creates an initial application for a given job.
 */
export async function createForJob(options: CreateForJobOptions): Promise<CreateApplicationResult> {
  const { db, jobId, generator, resumeSelectorOptions, bannedPhrases, nowMs } = options;
  const nowIso = new Date(nowMs ?? Date.now()).toISOString();

  // 1. Idempotency check: see if initial application already exists
  const existing = await db
    .prepare(`SELECT * FROM applications WHERE job_id = ? AND kind = 'initial'`)
    .bind(jobId)
    .first<ApplicationRow>();

  if (existing) {
    return {
      application: existing,
      created: false,
      regenerated: false,
      validation_passed: !existing.validator_errors,
    };
  }

  // 2. Fetch Job
  const job = await db.prepare(`SELECT * FROM jobs WHERE id = ?`).bind(jobId).first<{
    id: string;
    title: string;
    company: string;
    description: string;
    apply_route: string | null;
    route_reason: string | null;
  }>();

  if (!job) {
    throw new Error(`Job with id '${jobId}' not found`);
  }

  // 3. Fetch Profile
  let profile = options.profile;
  if (!profile) {
    const profileRow = await db
      .prepare(`SELECT data FROM profile WHERE id = ?`)
      .bind('default')
      .first<{ data: string }>();

    if (!profileRow?.data) {
      throw new Error('Default profile not configured in database');
    }
    profile = ProfileSchema.parse(JSON.parse(profileRow.data));
  }

  // 4. Select Resume
  let selectedResumeId: string | null = null;
  const { results: resumes } = await db
    .prepare(`SELECT id, label, tags, is_default FROM resumes`)
    .bind()
    .all<SelectableResume>();

  if (resumes && resumes.length > 0) {
    const selection = await ResumeSelector.selectResume(
      resumes,
      { title: job.title, description: job.description },
      resumeSelectorOptions,
    );
    selectedResumeId = selection.resume_id;
  }

  // 5. Generate and Validate Cover Letter (with 1 retry on validation failure)
  let finalDraft: GeneratedCoverLetter;
  let validatorErrors: string[] = [];
  let regenerated = false;
  let validationPassed = false;

  // Attempt 1
  const draft1 = await generator.generate({
    profile,
    job: {
      title: job.title,
      company: job.company,
      description: job.description,
    },
  });

  const errors1 = validateCoverLetter(
    draft1.body,
    draft1.subject,
    profile,
    { title: job.title, company: job.company },
    { bannedPhrases },
  );

  if (errors1.length === 0) {
    finalDraft = draft1;
    validationPassed = true;
  } else {
    // Validation failure -> regenerate once passing errors back
    regenerated = true;
    const draft2 = await generator.generate({
      profile,
      job: {
        title: job.title,
        company: job.company,
        description: job.description,
      },
      previousErrors: errors1,
    });

    const errors2 = validateCoverLetter(
      draft2.body,
      draft2.subject,
      profile,
      { title: job.title, company: job.company },
      { bannedPhrases },
    );

    finalDraft = draft2;
    if (errors2.length === 0) {
      validationPassed = true;
    } else {
      // Failed twice: keep last attempt and its errors
      validatorErrors = errors2;
      validationPassed = false;
    }
  }

  // 6. Determine Channel and Status based on apply_route and validation
  let channel: ApplicationChannel = 'manual';
  let status: ApplicationStatus = 'needs_review';
  let notes: string | null = null;

  const route = job.apply_route;

  if (route === 'auto_email') {
    channel = 'email';
    if (validationPassed) {
      status = 'draft';
    } else {
      // Two failed generations -> set application to needs_review,
      // and flip job route to manual_review with reason LETTER_FAILED
      status = 'needs_review';

      await db
        .prepare(
          `UPDATE jobs SET apply_route = 'manual_review', route_reason = 'LETTER_FAILED', updated_at = ? WHERE id = ?`,
        )
        .bind(nowIso, job.id)
        .run();

      const eventId = crypto.randomUUID();
      const payload = JSON.stringify({
        from_route: 'auto_email',
        to_route: 'manual_review',
        reason: 'LETTER_FAILED',
      });
      await db
        .prepare(
          `INSERT INTO events (id, entity, entity_id, type, payload, created_at) VALUES (?, 'job', ?, 'route_changed', ?, ?)`,
        )
        .bind(eventId, job.id, payload, nowIso)
        .run();
    }
  } else if (route === 'manual_portal') {
    channel = 'manual';
    status = 'manual_pending';
    if (!validationPassed) {
      notes = 'Cover letter failed validation; must be written or reviewed by hand.';
    }
  } else {
    // manual_review
    channel = 'manual';
    status = 'needs_review';
  }

  // 7. Insert Application Row
  const applicationId = crypto.randomUUID();
  const validatorErrorsJson = validatorErrors.length > 0 ? JSON.stringify(validatorErrors) : null;

  const insertStmt = db
    .prepare(
      `INSERT INTO applications (
           id, job_id, kind, channel, resume_id, cover_letter, subject,
           status, retry_count, follow_up_count, notes, validator_errors, updated_at
         ) VALUES (?, ?, 'initial', ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)`,
    )
    .bind(
      applicationId,
      job.id,
      channel,
      selectedResumeId,
      finalDraft.body,
      finalDraft.subject,
      status,
      notes,
      validatorErrorsJson,
      nowIso,
    );

  const eventStmt = db
    .prepare(
      `INSERT INTO events (id, entity, entity_id, type, payload, created_at)
         VALUES (?, 'application', ?, 'status_change', ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      applicationId,
      JSON.stringify({ from: null, to: status, reason: 'created' }),
      nowIso,
    );

  await db.batch([insertStmt, eventStmt]);

  const createdApplication: ApplicationRow = {
    id: applicationId,
    job_id: job.id,
    kind: 'initial',
    channel,
    resume_id: selectedResumeId,
    cover_letter: finalDraft.body,
    subject: finalDraft.subject,
    status,
    retry_count: 0,
    follow_up_count: 0,
    notes,
    validator_errors: validatorErrorsJson,
    updated_at: nowIso,
  };

  return {
    application: createdApplication,
    created: true,
    regenerated,
    validation_passed: validationPassed,
  };
}

/**
 * Updates an application's cover letter, re-running the validator.
 * Only leaves 'needs_review' when the letter passes validation.
 */
export async function updateCoverLetter(options: UpdateCoverLetterOptions): Promise<{
  application: ApplicationRow;
  validation_passed: boolean;
  errors: string[];
}> {
  const { db, applicationId, coverLetter, subject, bannedPhrases, nowMs } = options;
  const nowIso = new Date(nowMs ?? Date.now()).toISOString();

  const app = await db
    .prepare(`SELECT * FROM applications WHERE id = ?`)
    .bind(applicationId)
    .first<ApplicationRow>();

  if (!app) {
    throw new Error(`Application with id '${applicationId}' not found`);
  }

  const job = await db
    .prepare(`SELECT id, title, company, apply_route FROM jobs WHERE id = ?`)
    .bind(app.job_id)
    .first<{ id: string; title: string; company: string; apply_route: string | null }>();

  if (!job) {
    throw new Error(`Associated job for application '${applicationId}' not found`);
  }

  let profile = options.profile;
  if (!profile) {
    const profileRow = await db
      .prepare(`SELECT data FROM profile WHERE id = ?`)
      .bind('default')
      .first<{ data: string }>();

    if (!profileRow?.data) {
      throw new Error('Default profile not found in database');
    }
    profile = ProfileSchema.parse(JSON.parse(profileRow.data));
  }

  const finalSubject = subject !== undefined ? subject : app.subject || '';
  const errors = validateCoverLetter(
    coverLetter,
    finalSubject,
    profile,
    { title: job.title, company: job.company },
    { bannedPhrases },
  );

  if (errors.length > 0) {
    // Still invalid: update text and errors, remain in current status
    const errorsJson = JSON.stringify(errors);
    await db
      .prepare(
        `UPDATE applications SET
             cover_letter = ?,
             subject = ?,
             validator_errors = ?,
             updated_at = ?
           WHERE id = ?`,
      )
      .bind(coverLetter, finalSubject, errorsJson, nowIso, applicationId)
      .run();

    return {
      application: {
        ...app,
        cover_letter: coverLetter,
        subject: finalSubject,
        validator_errors: errorsJson,
        updated_at: nowIso,
      },
      validation_passed: false,
      errors,
    };
  }

  // Letter passed validation!
  // If application was in 'needs_review', transition out
  let newStatus = app.status;
  if (app.status === 'needs_review') {
    const targetStatus = app.channel === 'email' ? 'draft' : 'manual_pending';
    await transition(db, 'application', applicationId, targetStatus, 'LETTER_VALIDATED');
    newStatus = targetStatus;
  }

  await db
    .prepare(
      `UPDATE applications SET
           cover_letter = ?,
           subject = ?,
           validator_errors = null,
           notes = null,
           updated_at = ?
         WHERE id = ?`,
    )
    .bind(coverLetter, finalSubject, nowIso, applicationId)
    .run();

  return {
    application: {
      ...app,
      cover_letter: coverLetter,
      subject: finalSubject,
      status: newStatus,
      validator_errors: null,
      notes: null,
      updated_at: nowIso,
    },
    validation_passed: true,
    errors: [],
  };
}

export const ApplicationFactory = {
  createForJob,
  updateCoverLetter,
};
