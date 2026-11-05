import type { JobSource, JobSourceConfig, RawJob, NormalizedJob } from '../types.js';
import { normalizeCompanyName } from '../dedupe.js';
import { extractContactEmail } from '../email-extractor.js';
import { parseSalary } from '../salary.js';
import { stripHtml } from '../html-utils.js';
import { fetchWithRetry } from '../circuit-breaker.js';

export const remotiveAdapter: JobSource = {
  name: 'remotive',
  kind: 'api',

  async fetch(config?: JobSourceConfig): Promise<RawJob[]> {
    const userAgent =
      config?.userAgent || 'Pigeon/1.0 (Job Application Assistant; +https://github.com/pigeon)';

    const res = await fetchWithRetry(
      'https://remotive.com/api/remote-jobs',
      {
        headers: {
          'User-Agent': userAgent,
          Accept: 'application/json',
        },
      },
      { fetchFn: config?.fetchFn },
    );

    if (!res.ok) {
      throw new Error(`Remotive API returned HTTP ${res.status}`);
    }

    const data = (await res.json()) as { jobs?: RawJob[] };
    return (data.jobs || []).map((j) => ({ ...j, source: 'remotive' }));
  },

  normalize(raw: RawJob): NormalizedJob {
    const title = String(raw['title'] || '').trim();
    const company = String(raw['company_name'] || 'Unknown').trim();
    const location = String(raw['candidate_required_location'] || 'Worldwide').trim();
    const description = stripHtml(String(raw['description'] || ''));

    const parsedSalary = parseSalary(raw['salary'] as string | undefined);
    const email = extractContactEmail(description);

    return {
      source: 'remotive',
      source_kind: 'api',
      source_job_id: raw['id'] ? String(raw['id']) : null,
      title,
      company,
      company_normalized: normalizeCompanyName(company),
      location,
      remote: true,
      salary_min: parsedSalary.salary_min,
      salary_max: parsedSalary.salary_max,
      currency: parsedSalary.currency,
      salary_raw: parsedSalary.salary_raw,
      description,
      apply_url: (raw['url'] as string) || null,
      contact_email: email,
      contact_source: email ? 'posting' : 'none',
      posted_at: (raw['publication_date'] as string) || null,
      untrusted: true,
    };
  },
};
