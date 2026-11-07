import type { JobSource, JobSourceConfig, RawJob, NormalizedJob } from '../types.js';
import { normalizeCompanyName } from '../dedupe.js';
import { extractContactEmail } from '../email-extractor.js';
import { parseSalary } from '../salary.js';
import { stripHtml } from '../html-utils.js';
import { fetchWithRetry } from '../circuit-breaker.js';
import { getAtsSlugs, disableAtsSlug } from './greenhouse.js';
import { LeverResponseSchema } from '../schemas.js';

export const leverAdapter: JobSource = {
  name: 'lever',
  kind: 'ats',

  async fetch(config?: JobSourceConfig): Promise<RawJob[]> {
    const userAgent =
      config?.userAgent || 'Pigeon/1.0 (Job Application Assistant; +https://github.com/pigeon)';

    const slugs = await getAtsSlugs('lever', config, ['cloudflare']);
    const allJobs: RawJob[] = [];

    for (const slug of slugs) {
      const url = `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`;

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

      if (res.status === 404) {
        // Slug returns 404 -> disable in KV
        await disableAtsSlug('lever', slug, config);
        continue;
      }

      if (!res.ok) {
        throw new Error(`Lever API for ${slug} returned HTTP ${res.status}`);
      }

      const data = LeverResponseSchema.parse(await res.json());
      for (const job of data) {
        allJobs.push({
          ...job,
          source: 'lever',
          company_slug: slug,
        });
      }
    }

    return allJobs;
  },

  normalize(raw: RawJob): NormalizedJob {
    const title = String(raw['text'] || raw['title'] || '').trim();
    const slug = String(raw['company_slug'] || 'company');
    const company = slug.charAt(0).toUpperCase() + slug.slice(1);

    const categories = raw['categories'] as { location?: string; commitment?: string } | undefined;
    const location = String(categories?.location || raw['location'] || 'Remote').trim();
    const description = stripHtml(String(raw['description'] || ''));

    const isRemote =
      /remote|anywhere|wfh/i.test(location) || /remote/i.test(title) || /remote/i.test(description);

    const parsedSalary = parseSalary(description);
    const email = extractContactEmail(description);

    let postedAt: string | null = null;
    if (typeof raw['createdAt'] === 'number') {
      postedAt = new Date(raw['createdAt']).toISOString();
    }

    return {
      source: 'lever',
      source_kind: 'ats',
      source_job_id: raw['id'] ? String(raw['id']) : null,
      title,
      company,
      company_normalized: normalizeCompanyName(company),
      location,
      remote: isRemote,
      salary_min: parsedSalary.salary_min,
      salary_max: parsedSalary.salary_max,
      currency: parsedSalary.currency,
      salary_raw: parsedSalary.salary_raw,
      description,
      apply_url: (raw['hostedUrl'] as string) || null,
      contact_email: email,
      contact_source: email ? 'posting' : 'none',
      posted_at: postedAt,
      untrusted: true,
    };
  },
};
