import type { JobSource, JobSourceConfig, RawJob, NormalizedJob } from '../types.js';
import { normalizeCompanyName } from '../dedupe.js';
import { extractContactEmail } from '../email-extractor.js';
import { stripHtml } from '../html-utils.js';
import { fetchWithRetry } from '../circuit-breaker.js';
import { JobicyResponseSchema } from '../schemas.js';

export const jobicyAdapter: JobSource = {
  name: 'jobicy',
  kind: 'api',

  async fetch(config?: JobSourceConfig): Promise<RawJob[]> {
    const userAgent =
      config?.userAgent || 'Pigeon/1.0 (Job Application Assistant; +https://github.com/pigeon)';

    const res = await fetchWithRetry(
      'https://jobicy.com/api/v2/remote-jobs?count=50',
      {
        headers: {
          'User-Agent': userAgent,
          Accept: 'application/json',
        },
      },
      { fetchFn: config?.fetchFn, delayFn: config?.delayFn },
    );

    if (!res.ok) {
      throw new Error(`Jobicy API returned HTTP ${res.status}`);
    }

    const json: unknown = await res.json();
    const data = JobicyResponseSchema.parse(json);

    return (data.jobs || []).map((item) => ({ ...item, source: 'jobicy' }));
  },

  normalize(raw: RawJob): NormalizedJob {
    const title = String(raw['jobTitle'] || '').trim();
    const company = String(raw['companyName'] || 'Unknown').trim();
    const location = String(raw['jobGeo'] || 'Worldwide').trim();
    const description = stripHtml(String(raw['jobDescription'] || title));

    const parseNum = (val: unknown): number | null => {
      if (typeof val === 'number' && !Number.isNaN(val)) return val;
      if (typeof val === 'string') {
        const cleaned = val.replace(/[^0-9.]/g, '');
        const num = parseFloat(cleaned);
        return Number.isNaN(num) ? null : num;
      }
      return null;
    };

    const minSalary = parseNum(raw['annualSalaryMin']);
    const maxSalary = parseNum(raw['annualSalaryMax']) ?? minSalary;
    const currency = (raw['salaryCurrency'] as string) || (minSalary !== null ? 'USD' : null);
    const salaryRaw =
      minSalary !== null && maxSalary !== null
        ? `${minSalary} - ${maxSalary} ${currency || 'USD'}`
        : null;

    const email = extractContactEmail(description);
    const postedAt = (raw['pubDate'] as string) || null;

    return {
      source: 'jobicy',
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
      apply_url: (raw['url'] as string) || null,
      contact_email: email,
      contact_source: email ? 'posting' : 'none',
      posted_at: postedAt,
      untrusted: true,
    };
  },
};
