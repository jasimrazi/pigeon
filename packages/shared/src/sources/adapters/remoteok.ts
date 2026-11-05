import type { JobSource, JobSourceConfig, RawJob, NormalizedJob } from '../types.js';
import { normalizeCompanyName } from '../dedupe.js';
import { extractContactEmail } from '../email-extractor.js';
import { stripHtml } from '../html-utils.js';
import { fetchWithRetry } from '../circuit-breaker.js';

export const remoteokAdapter: JobSource = {
  name: 'remoteok',
  kind: 'api',

  async fetch(config?: JobSourceConfig): Promise<RawJob[]> {
    const userAgent =
      config?.userAgent || 'Pigeon/1.0 (Job Application Assistant; +https://github.com/pigeon)';

    const res = await fetchWithRetry(
      'https://remoteok.com/api',
      {
        headers: {
          'User-Agent': userAgent,
          Accept: 'application/json',
        },
      },
      { fetchFn: config?.fetchFn },
    );

    if (!res.ok) {
      throw new Error(`RemoteOK API returned HTTP ${res.status}`);
    }

    const data = (await res.json()) as Array<Record<string, unknown>>;
    // RemoteOK puts legal disclaimer as first element without an id
    return data
      .filter((item) => item['id'] && item['position'])
      .map((item) => ({ ...item, source: 'remoteok' }));
  },

  normalize(raw: RawJob): NormalizedJob {
    const title = String(raw['position'] || '').trim();
    const company = String(raw['company'] || 'Unknown').trim();
    const location = String(raw['location'] || 'Worldwide').trim();
    const description = stripHtml(String(raw['description'] || ''));

    const salaryMin = typeof raw['salary_min'] === 'number' ? raw['salary_min'] : null;
    const salaryMax = typeof raw['salary_max'] === 'number' ? raw['salary_max'] : salaryMin;
    const salaryRaw =
      salaryMin !== null && salaryMax !== null ? `${salaryMin} - ${salaryMax} USD` : null;

    const email = extractContactEmail(description);
    let postedAt: string | null = (raw['date'] as string) || null;
    if (!postedAt && typeof raw['epoch'] === 'number') {
      postedAt = new Date(raw['epoch'] * 1000).toISOString();
    }

    return {
      source: 'remoteok',
      source_kind: 'api',
      source_job_id: raw['id'] ? String(raw['id']) : null,
      title,
      company,
      company_normalized: normalizeCompanyName(company),
      location,
      remote: true,
      salary_min: salaryMin,
      salary_max: salaryMax,
      currency: salaryMin !== null ? 'USD' : null,
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
