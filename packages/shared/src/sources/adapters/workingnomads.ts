import type { JobSource, JobSourceConfig, RawJob, NormalizedJob } from '../types.js';
import { normalizeCompanyName } from '../dedupe.js';
import { extractContactEmail } from '../email-extractor.js';
import { parseSalary } from '../salary.js';
import { stripHtml } from '../html-utils.js';
import { fetchWithRetry } from '../circuit-breaker.js';
import { WorkingNomadsResponseSchema } from '../schemas.js';

export const workingNomadsAdapter: JobSource = {
  name: 'workingnomads',
  kind: 'api',

  async fetch(config?: JobSourceConfig): Promise<RawJob[]> {
    const userAgent =
      config?.userAgent || 'Pigeon/1.0 (Job Application Assistant; +https://github.com/pigeon)';

    const res = await fetchWithRetry(
      'https://www.workingnomads.com/api/exposed_jobs/',
      {
        headers: {
          'User-Agent': userAgent,
          Accept: 'application/json',
        },
      },
      { fetchFn: config?.fetchFn, delayFn: config?.delayFn },
    );

    if (!res.ok) {
      throw new Error(`Working Nomads API returned HTTP ${res.status}`);
    }

    const json: unknown = await res.json();
    const data = WorkingNomadsResponseSchema.parse(json);

    return data.map((item) => ({ ...item, source: 'workingnomads' }));
  },

  normalize(raw: RawJob): NormalizedJob {
    const title = String(raw['title'] || '').trim();
    const company = String(raw['company_name'] || 'Unknown').trim();
    const location = String(raw['location'] || 'Worldwide').trim();
    const description = stripHtml(String(raw['description'] || title));

    const parsedSalary = parseSalary(description);
    const email = extractContactEmail(description);
    const postedAt = (raw['pub_date'] as string) || null;

    return {
      source: 'workingnomads',
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
      posted_at: postedAt,
      untrusted: true,
    };
  },
};
