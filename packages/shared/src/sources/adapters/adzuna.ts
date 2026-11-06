import type { JobSource, JobSourceConfig, RawJob, NormalizedJob } from '../types.js';
import { normalizeCompanyName } from '../dedupe.js';
import { extractContactEmail } from '../email-extractor.js';
import { stripHtml } from '../html-utils.js';
import { fetchWithRetry } from '../circuit-breaker.js';
import { ConfigError } from '../../env.js';

export const adzunaAdapter: JobSource = {
  name: 'adzuna',
  kind: 'api',

  async fetch(config?: JobSourceConfig): Promise<RawJob[]> {
    const appId = config?.secrets?.ADZUNA_APP_ID;
    const appKey = config?.secrets?.ADZUNA_APP_KEY;
    if (!appId || !appKey) {
      throw new ConfigError('Missing required Adzuna credentials: ADZUNA_APP_ID and ADZUNA_APP_KEY must be configured');
    }
    const userAgent =
      config?.userAgent || 'Pigeon/1.0 (Job Application Assistant; +https://github.com/pigeon)';

    const url = `https://api.adzuna.com/v1/api/jobs/in/search/1?app_id=${encodeURIComponent(
      appId,
    )}&app_key=${encodeURIComponent(appKey)}&results_per_page=50&content-type=application/json`;

    const res = await fetchWithRetry(
      url,
      {
        headers: {
          'User-Agent': userAgent,
          Accept: 'application/json',
        },
      },
      { fetchFn: config?.fetchFn },
    );

    if (!res.ok) {
      throw new Error(`Adzuna API returned HTTP ${res.status}`);
    }

    const data = (await res.json()) as { results?: RawJob[] };
    return (data.results || []).map((j) => ({ ...j, source: 'adzuna' }));
  },

  normalize(raw: RawJob): NormalizedJob {
    const title = String(raw['title'] || '').trim();
    const companyObj = raw['company'] as { display_name?: string } | undefined;
    const company = String(companyObj?.display_name || raw['company'] || 'Unknown').trim();
    const locationObj = raw['location'] as { display_name?: string } | undefined;
    const location = String(locationObj?.display_name || raw['location'] || 'India').trim();
    const description = stripHtml(String(raw['description'] || ''));

    const isRemote =
      /remote|anywhere|wfh/i.test(title) ||
      /remote|anywhere|wfh/i.test(location) ||
      /work from home|fully remote/i.test(description);

    const salaryMin = typeof raw['salary_min'] === 'number' ? raw['salary_min'] : null;
    const salaryMax = typeof raw['salary_max'] === 'number' ? raw['salary_max'] : salaryMin;
    const salaryRaw =
      salaryMin !== null && salaryMax !== null ? `${salaryMin} - ${salaryMax} INR` : null;

    const email = extractContactEmail(description);

    return {
      source: 'adzuna',
      source_kind: 'api',
      source_job_id: raw['id'] ? String(raw['id']) : null,
      title,
      company,
      company_normalized: normalizeCompanyName(company),
      location,
      remote: isRemote,
      salary_min: salaryMin,
      salary_max: salaryMax,
      currency: salaryMin !== null ? 'INR' : null,
      salary_raw: salaryRaw,
      description,
      apply_url: (raw['redirect_url'] as string) || null,
      contact_email: email,
      contact_source: email ? 'posting' : 'none',
      posted_at: (raw['created'] as string) || null,
      untrusted: true,
    };
  },
};
