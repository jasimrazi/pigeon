import type { JobSource, JobSourceConfig, RawJob, NormalizedJob } from '../types.js';
import { normalizeCompanyName } from '../dedupe.js';
import { extractContactEmail } from '../email-extractor.js';
import { stripHtml } from '../html-utils.js';
import { fetchWithRetry } from '../circuit-breaker.js';
import { HimalayasResponseSchema } from '../schemas.js';

export const himalayasAdapter: JobSource = {
  name: 'himalayas',
  kind: 'api',

  async fetch(config?: JobSourceConfig): Promise<RawJob[]> {
    const userAgent =
      config?.userAgent || 'Pigeon/1.0 (Job Application Assistant; +https://github.com/pigeon)';

    const res = await fetchWithRetry(
      'https://himalayas.app/jobs/api?limit=50',
      {
        headers: {
          'User-Agent': userAgent,
          Accept: 'application/json',
        },
      },
      { fetchFn: config?.fetchFn, delayFn: config?.delayFn },
    );

    if (!res.ok) {
      throw new Error(`Himalayas API returned HTTP ${res.status}`);
    }

    const json: unknown = await res.json();
    const data = HimalayasResponseSchema.parse(json);

    return (data.data || []).map((item) => ({ ...item, source: 'himalayas' }));
  },

  normalize(raw: RawJob): NormalizedJob {
    const title = String(raw['title'] || '').trim();
    const company = String(raw['company_name'] || 'Unknown').trim();
    const location = String(raw['location'] || 'Worldwide').trim();
    const description = stripHtml(String(raw['description'] || title));

    const minSalary = typeof raw['min_salary'] === 'number' ? raw['min_salary'] : null;
    const maxSalary = typeof raw['max_salary'] === 'number' ? raw['max_salary'] : minSalary;
    const currency = (raw['currency'] as string) || (minSalary !== null ? 'USD' : null);
    const salaryRaw =
      minSalary !== null && maxSalary !== null
        ? `${minSalary} - ${maxSalary} ${currency || 'USD'}`
        : null;

    const email = extractContactEmail(description);
    const postedAt = (raw['pub_date'] as string) || null;

    return {
      source: 'himalayas',
      source_kind: 'api',
      source_job_id: raw['id'] ? String(raw['id']) : null,
      title,
      company,
      company_normalized: normalizeCompanyName(company),
      location,
      remote: true,
      salary_min: minSalary,
      salary_max: maxSalary,
      currency,
      salary_raw: salaryRaw,
      description,
      apply_url: (raw['application_url'] as string) || null,
      contact_email: email,
      contact_source: email ? 'posting' : 'none',
      posted_at: postedAt,
      untrusted: true,
    };
  },
};
