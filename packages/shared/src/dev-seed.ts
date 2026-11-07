import type { D1LikeDatabase } from './state-machine.js';
import type { KVLike } from './google/auth.js';
import { validateCoverLetter } from './applications/validator.js';

export interface R2BucketLike {
  put(
    key: string,
    value: ArrayBuffer | Uint8Array | string,
    options?: Record<string, unknown>,
  ): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
}

export interface SeedOptions {
  db: D1LikeDatabase;
  resumesBucket: R2BucketLike;
  config: KVLike;
  env: string;
  nowIso?: string;
}

/**
 * Generates a minimal valid PDF-1.4 binary buffer on the fly.
 */
export function createMinimalPdfBuffer(title: string): Uint8Array {
  const content = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >> endobj
4 0 obj << /Length 44 >> stream
BT /F1 12 Tf 100 700 Td (${title}) Tj ET
endstream endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000214 00000 n 
trailer << /Root 1 0 R /Size 5 >>
startxref
308
%%EOF`;
  return new TextEncoder().encode(content);
}

export const SEED_PROFILE = {
  name: 'Alex Mercer',
  email: 'alex.mercer@example.test',
  skills: [
    'TypeScript',
    'Cloudflare Workers',
    'Distributed Systems',
    'SQLite',
    'Hono',
    'React',
    'Node.js',
    'API Architecture',
  ],
  experience: [
    {
      title: 'Senior Systems Engineer',
      company: 'Tech Corp',
      location: 'Remote',
      start_date: '2019-01',
      end_date: '2026-01',
      current: false,
      description: 'Distributed systems.',
      highlights: [],
    },
  ],
  education: [],
  preferences: {
    locations: ['Remote'],
    remote: true,
  },
  filters: {
    titles: ['Systems Engineer', 'Infrastructure Engineer', 'Platform Engineer'],
    locations: ['Remote'],
    company_blacklist: [],
    min_score: 70,
    require_salary: false,
    experience_range: { min: 7, max: 12 },
  },
  send_settings: {
    daily_cap: 20,
    window: { start: '09:00', end: '18:00' },
    timezone: 'Asia/Kolkata',
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
  resume_variants: {
    default: 'resumes/alex-mercer-systems.pdf',
    fullstack: 'resumes/alex-mercer-fullstack.pdf',
  },
};

/**
 * Seeds local development database, R2 buckets, and KV state.
 * Refuses immediately unless ENV=dev.
 */
export async function seedLocalData(options: SeedOptions): Promise<{
  success: boolean;
  jobsCount: number;
  appsCount: number;
  resumesCount: number;
}> {
  const { db, resumesBucket, config, env } = options;

  if (env !== 'dev') {
    throw new Error(
      `Refusing to seed database: ENV is '${env}', but seeding is strictly permitted only when ENV='dev'.`,
    );
  }

  const nowIso = options.nowIso || new Date().toISOString();

  // 1. Seed Profile
  await db
    .prepare(`INSERT OR REPLACE INTO profile (id, data, updated_at) VALUES ('default', ?, ?)`)
    .bind(JSON.stringify(SEED_PROFILE), nowIso)
    .run();

  // 2. Put 2 minimal PDF resumes into R2 and insert rows into resumes table
  const systemsPdf = createMinimalPdfBuffer('Alex Mercer - Senior Systems Engineer');
  const fullstackPdf = createMinimalPdfBuffer('Alex Mercer - Fullstack Edge Engineer');

  await resumesBucket.put('resumes/alex-mercer-systems.pdf', systemsPdf, {
    httpMetadata: { contentType: 'application/pdf' },
  });
  await resumesBucket.put('resumes/alex-mercer-fullstack.pdf', fullstackPdf, {
    httpMetadata: { contentType: 'application/pdf' },
  });

  await db
    .prepare(
      `INSERT OR REPLACE INTO resumes (id, label, r2_key, is_default, parsed_text, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      'res-systems',
      'Systems Engineering Resume',
      'resumes/alex-mercer-systems.pdf',
      1,
      'Alex Mercer - Senior Systems Engineer. Distributed systems, Cloudflare Workers, TypeScript.',
      nowIso,
    )
    .run();

  await db
    .prepare(
      `INSERT OR REPLACE INTO resumes (id, label, r2_key, is_default, parsed_text, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      'res-fullstack',
      'Fullstack / Edge Resume',
      'resumes/alex-mercer-fullstack.pdf',
      0,
      'Alex Mercer - Fullstack Engineer. React, TypeScript, Hono, Edge APIs.',
      nowIso,
    )
    .run();

  // 3. Seed ATS Sources in KV
  await config.put('sources:greenhouse', JSON.stringify(['cloudflare', 'stripe']));
  await config.put('sources:lever', JSON.stringify(['netflix']));
  await config.put('sources:ashby', JSON.stringify(['linear']));
  await config.put('sources:active', JSON.stringify(['greenhouse', 'lever', 'ashby']));

  // Helper valid cover letters (150-250 words)
  const buildValidLetter = (company: string, title: string) => `Dear Hiring Team at ${company},

I am writing to enthusiastically submit my application for the ${title} position at ${company}. With 7 years of hands-on experience designing and operating distributed systems and high-throughput backend services, I am excited about the opportunity to contribute to ${company}'s world-class platform and infrastructure engineering efforts.

Throughout my career, I have specialized in building robust TypeScript and Cloudflare Workers services, optimizing database access patterns, and ensuring low-latency communication across distributed clusters. At my previous roles, I led initiatives to improve service resilience and decrease edge API response times under heavy traffic loads. You can review my architecture notes and projects at https://alexmercer.dev.

I deeply admire ${company}'s engineering culture and dedication to reliability and developer experience. I welcome the opportunity to discuss how my technical background in distributed systems and systems architecture aligns with your team's goals. Thank you very much for your time and consideration.

Warm regards,
Alex Mercer`;

  // 4. Seed Policies: Do Not Contact & 90-day Cooldown
  await db
    .prepare(
      `INSERT OR REPLACE INTO do_not_contact (id, value, reason, created_at)
       VALUES ('dnc-1', 'badcompany.example.test', 'Requested no contact', ?)`,
    )
    .bind(nowIso)
    .run();

  const tenDaysAgoIso = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
  await db
    .prepare(
      `INSERT OR REPLACE INTO companies_contacted (company_normalized, last_contacted_at, last_channel)
       VALUES ('recentco', ?, 'email')`,
    )
    .bind(tenDaysAgoIso)
    .run();

  // 5. Seed 12 Jobs and Applications
  interface JobSeedDef {
    id: string;
    company: string;
    title: string;
    apply_route: 'auto_email' | 'manual_portal' | 'manual_review' | null;
    route_reason: string | null;
    status: 'new' | 'scored' | 'routed' | 'applied' | 'skipped';
    contact_email: string | null;
    contact_source: 'posting' | 'finder' | 'guessed' | 'none';
    filter_reason?: string | null;
    match_score?: number;
    red_flags?: string[];
  }

  const jobsData: JobSeedDef[] = [
    // 1. Draft ready (auto_email from posting)
    {
      id: 'seed-job-1',
      company: 'CloudScale Inc',
      title: 'Senior Systems Engineer',
      apply_route: 'auto_email',
      route_reason: 'OK',
      status: 'routed',
      contact_email: 'jobs-cloudscale@example.test',
      contact_source: 'posting',
      match_score: 94,
    },
    // 2. Draft ready (auto_email from contact finder)
    {
      id: 'seed-job-2',
      company: 'EdgeMesh Networks',
      title: 'Lead Platform Engineer',
      apply_route: 'auto_email',
      route_reason: 'OK',
      status: 'routed',
      contact_email: 'talent-edgemesh@example.test',
      contact_source: 'finder',
      match_score: 91,
    },
    // 3. Draft with validator warning (short letter)
    {
      id: 'seed-job-3',
      company: 'DataFlow Systems',
      title: 'Distributed Systems Architect',
      apply_route: 'auto_email',
      route_reason: 'OK',
      status: 'routed',
      contact_email: 'recruiting-dataflow@example.test',
      contact_source: 'posting',
      match_score: 88,
    },
    // 4. Approved 1 (ready to send)
    {
      id: 'seed-job-4',
      company: 'StreamVibe Media',
      title: 'Senior Backend Engineer',
      apply_route: 'auto_email',
      route_reason: 'OK',
      status: 'routed',
      contact_email: 'careers-streamvibe@example.test',
      contact_source: 'posting',
      match_score: 90,
    },
    // 5. Approved 2 (ready to send)
    {
      id: 'seed-job-5',
      company: 'QuantumQueue Labs',
      title: 'Staff Infrastructure Engineer',
      apply_route: 'auto_email',
      route_reason: 'OK',
      status: 'routed',
      contact_email: 'hiring-quantumqueue@example.test',
      contact_source: 'posting',
      match_score: 95,
    },
    // 6. Already-sent application
    {
      id: 'seed-job-6',
      company: 'Apex Computing',
      title: 'Site Reliability Engineer',
      apply_route: 'auto_email',
      route_reason: 'OK',
      status: 'routed',
      contact_email: 'sre-apex@example.test',
      contact_source: 'posting',
      match_score: 89,
    },
    // 7. Applied with follow_up ready 6 business days later
    {
      id: 'seed-job-7',
      company: 'HyperScale Storage',
      title: 'Principal Storage Architect',
      apply_route: 'auto_email',
      route_reason: 'OK',
      status: 'routed',
      contact_email: 'storage-hyperscale@example.test',
      contact_source: 'posting',
      match_score: 93,
    },
    // 8. Manual Pending (portal route)
    {
      id: 'seed-job-8',
      company: 'Stripe Portal Corp',
      title: 'Infrastructure Engineer',
      apply_route: 'manual_portal',
      route_reason: 'PORTAL_NO_EMAIL',
      status: 'routed',
      contact_email: null,
      contact_source: 'none',
      match_score: 92,
    },
    // 9. Manual Pending (manual review route)
    {
      id: 'seed-job-9',
      company: 'FinTech Dynamics',
      title: 'Senior Database Engineer',
      apply_route: 'manual_review',
      route_reason: 'FREEMAIL_CONTACT',
      status: 'routed',
      contact_email: 'fintech-hiring@example.test',
      contact_source: 'posting',
      match_score: 87,
    },
    // 10. Skipped: LOW_SCORE
    {
      id: 'seed-job-10',
      company: 'Legacy Enterprise',
      title: 'COBOL Mainframe Maintainer',
      apply_route: null,
      route_reason: null,
      status: 'skipped',
      filter_reason: 'LOW_SCORE',
      match_score: 35,
      contact_email: null,
      contact_source: 'none',
    },
    // 11. Skipped: RED_FLAGS
    {
      id: 'seed-job-11',
      company: 'CryptoMoon LLC',
      title: 'Unpaid Web3 Intern',
      apply_route: null,
      route_reason: null,
      status: 'skipped',
      filter_reason: 'RED_FLAGS',
      match_score: 75,
      red_flags: ['unpaid internship', 'requires own crypto tokens'],
      contact_email: null,
      contact_source: 'none',
    },
    // 12. Blocked by do_not_contact
    {
      id: 'seed-job-12',
      company: 'BadCompany Ltd',
      title: 'Cloud DevOps Engineer',
      apply_route: 'auto_email',
      route_reason: 'OK',
      status: 'routed',
      contact_email: 'badcompany-jobs@example.test',
      contact_source: 'posting',
      match_score: 86,
    },
    // 13. Blocked by 90-day cooldown
    {
      id: 'seed-job-13',
      company: 'RecentCo',
      title: 'Senior Systems Architect',
      apply_route: 'auto_email',
      route_reason: 'OK',
      status: 'routed',
      contact_email: 'team-recentco@example.test',
      contact_source: 'posting',
      match_score: 89,
    },
  ];

  for (const j of jobsData) {
    if (j.contact_email && !j.contact_email.endsWith('@example.test')) {
      throw new Error(
        `Safety violation in seed data: contact email '${j.contact_email}' does not end in '@example.test'`,
      );
    }

    const norm = j.company.toLowerCase().replace(/[^a-z0-9]/g, '');
    const dedupeKey = `dedupe:${norm}:${j.title.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

    await db
      .prepare(
        `INSERT OR REPLACE INTO jobs (
          id, dedupe_key, source, source_kind, title, company, company_normalized,
          description, contact_email, contact_source, status, apply_route, route_reason,
          filter_reason, match_score, red_flags, posted_at, fetched_at, updated_at
        ) VALUES (?, ?, 'ats', 'ats', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        j.id,
        dedupeKey,
        j.title,
        j.company,
        norm,
        `Job description for ${j.title} at ${j.company}.`,
        j.contact_email,
        j.contact_source,
        j.status,
        j.apply_route,
        j.route_reason,
        j.filter_reason ?? null,
        j.match_score ?? null,
        j.red_flags ? JSON.stringify(j.red_flags) : null,
        nowIso,
        nowIso,
        nowIso,
      )
      .run();
  }

  // Applications
  const shortWarningLetter = `Hi, I want to apply for Distributed Systems Architect. Alex Mercer`;
  const validatorWarningErrors = validateCoverLetter(
    shortWarningLetter,
    'Application for Distributed Systems Architect',
    SEED_PROFILE,
    { title: 'Distributed Systems Architect', company: 'DataFlow Systems' },
  );

  const eightBusinessDaysAgo = new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString();
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

  const appsData = [
    // seed-app-1: draft
    {
      id: 'seed-app-1',
      job_id: 'seed-job-1',
      kind: 'initial' as const,
      channel: 'email' as const,
      status: 'draft',
      cover_letter: buildValidLetter('CloudScale Inc', 'Senior Systems Engineer'),
      subject: 'Application for Senior Systems Engineer',
      resume_id: 'res-systems',
      validator_errors: null,
      updated_at: nowIso,
    },
    // seed-app-2: draft
    {
      id: 'seed-app-2',
      job_id: 'seed-job-2',
      kind: 'initial' as const,
      channel: 'email' as const,
      status: 'draft',
      cover_letter: buildValidLetter('EdgeMesh Networks', 'Lead Platform Engineer'),
      subject: 'Application for Lead Platform Engineer',
      resume_id: 'res-fullstack',
      validator_errors: null,
      updated_at: nowIso,
    },
    // seed-app-3: draft with validator warning
    {
      id: 'seed-app-3',
      job_id: 'seed-job-3',
      kind: 'initial' as const,
      channel: 'email' as const,
      status: 'draft',
      cover_letter: shortWarningLetter,
      subject: 'Application for Distributed Systems Architect',
      resume_id: 'res-systems',
      validator_errors: JSON.stringify(validatorWarningErrors),
      updated_at: nowIso,
    },
    // seed-app-4: approved
    {
      id: 'seed-app-4',
      job_id: 'seed-job-4',
      kind: 'initial' as const,
      channel: 'email' as const,
      status: 'approved',
      cover_letter: buildValidLetter('StreamVibe Media', 'Senior Backend Engineer'),
      subject: 'Application for Senior Backend Engineer',
      resume_id: 'res-systems',
      validator_errors: null,
      updated_at: nowIso,
    },
    // seed-app-5: approved
    {
      id: 'seed-app-5',
      job_id: 'seed-job-5',
      kind: 'initial' as const,
      channel: 'email' as const,
      status: 'approved',
      cover_letter: buildValidLetter('QuantumQueue Labs', 'Staff Infrastructure Engineer'),
      subject: 'Application for Staff Infrastructure Engineer',
      resume_id: 'res-systems',
      validator_errors: null,
      updated_at: nowIso,
    },
    // seed-app-6: sent
    {
      id: 'seed-app-6',
      job_id: 'seed-job-6',
      kind: 'initial' as const,
      channel: 'email' as const,
      status: 'sent',
      cover_letter: buildValidLetter('Apex Computing', 'Site Reliability Engineer'),
      subject: 'Application for Site Reliability Engineer',
      resume_id: 'res-systems',
      sent_at: twoDaysAgo,
      gmail_message_id: 'seed-g-msg-6',
      gmail_thread_id: 'seed-g-th-6',
      validator_errors: null,
      updated_at: twoDaysAgo,
    },
    // seed-app-7-init: sent (applied 8 business days ago)
    {
      id: 'seed-app-7-init',
      job_id: 'seed-job-7',
      kind: 'initial' as const,
      channel: 'email' as const,
      status: 'sent',
      cover_letter: buildValidLetter('HyperScale Storage', 'Principal Storage Architect'),
      subject: 'Application for Principal Storage Architect',
      resume_id: 'res-systems',
      sent_at: eightBusinessDaysAgo,
      gmail_message_id: 'seed-g-msg-7',
      gmail_thread_id: 'seed-g-th-7',
      validator_errors: null,
      updated_at: eightBusinessDaysAgo,
    },
    // seed-app-7-followup: follow_up draft ready 6 business days later
    {
      id: 'seed-app-7-followup',
      job_id: 'seed-job-7',
      kind: 'follow_up' as const,
      channel: 'email' as const,
      status: 'draft',
      cover_letter: `Dear Hiring Team at HyperScale Storage,

I hope this note finds you well. I am following up on the application I submitted last week for the Principal Storage Architect position at HyperScale Storage. I wanted to reiterate my strong enthusiasm for this role and express my continued excitement about the opportunity to contribute to HyperScale Storage's ongoing engineering initiatives.

With my background in TypeScript, Cloudflare Workers, and Distributed Systems, I am eager to help your team build resilient, high-performance systems and solve challenging platform problems. I understand that reviewing candidates requires considerable time and effort, and I appreciate your attention and diligence throughout the recruitment process.

I would welcome the opportunity to speak with you or a member of the engineering team to discuss how my technical experience directly aligns with your goals for HyperScale Storage. Please let me know if you would like any additional materials, work samples, or architectural notes from my side.

Thank you very much for your time and consideration.

Warm regards,
Alex Mercer`,
      subject: 'Re: Application for Principal Storage Architect',
      resume_id: 'res-systems',
      gmail_thread_id: 'seed-g-th-7',
      scheduled_at: nowIso,
      validator_errors: null,
      updated_at: nowIso,
    },
    // seed-app-8: manual_pending (portal)
    {
      id: 'seed-app-8',
      job_id: 'seed-job-8',
      kind: 'initial' as const,
      channel: 'portal' as const,
      status: 'manual_pending',
      cover_letter: buildValidLetter('Stripe Portal Corp', 'Infrastructure Engineer'),
      subject: 'Application for Infrastructure Engineer',
      resume_id: 'res-systems',
      validator_errors: null,
      updated_at: nowIso,
    },
    // seed-app-9: manual_pending (manual review)
    {
      id: 'seed-app-9',
      job_id: 'seed-job-9',
      kind: 'initial' as const,
      channel: 'email' as const,
      status: 'manual_pending',
      cover_letter: buildValidLetter('FinTech Dynamics', 'Senior Database Engineer'),
      subject: 'Application for Senior Database Engineer',
      resume_id: 'res-systems',
      validator_errors: null,
      updated_at: nowIso,
    },
    // seed-app-12: approved (blocked by DNC)
    {
      id: 'seed-app-12',
      job_id: 'seed-job-12',
      kind: 'initial' as const,
      channel: 'email' as const,
      status: 'approved',
      cover_letter: buildValidLetter('BadCompany Ltd', 'Cloud DevOps Engineer'),
      subject: 'Application for Cloud DevOps Engineer',
      resume_id: 'res-systems',
      validator_errors: null,
      updated_at: nowIso,
    },
    // seed-app-13: approved (blocked by 90-day cooldown)
    {
      id: 'seed-app-13',
      job_id: 'seed-job-13',
      kind: 'initial' as const,
      channel: 'email' as const,
      status: 'approved',
      cover_letter: buildValidLetter('RecentCo', 'Senior Systems Architect'),
      subject: 'Application for Senior Systems Architect',
      resume_id: 'res-systems',
      validator_errors: null,
      updated_at: nowIso,
    },
  ];

  for (const a of appsData) {
    await db
      .prepare(
        `INSERT OR REPLACE INTO applications (
          id, job_id, kind, channel, status, cover_letter, subject, resume_id,
          validator_errors, sent_at, scheduled_at, gmail_message_id, gmail_thread_id,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        a.id,
        a.job_id,
        a.kind,
        a.channel,
        a.status,
        a.cover_letter,
        a.subject,
        a.resume_id,
        a.validator_errors,
        (a as { sent_at?: string }).sent_at ?? null,
        (a as { scheduled_at?: string }).scheduled_at ?? null,
        (a as { gmail_message_id?: string }).gmail_message_id ?? null,
        (a as { gmail_thread_id?: string }).gmail_thread_id ?? null,
        a.updated_at,
      )
      .run();
  }

  return {
    success: true,
    jobsCount: jobsData.length,
    appsCount: appsData.length,
    resumesCount: 2,
  };
}
