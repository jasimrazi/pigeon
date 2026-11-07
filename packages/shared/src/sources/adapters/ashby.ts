import { z } from 'zod';
import type { JobSource, JobSourceConfig, RawJob, NormalizedJob } from '../types.js';
import { normalizeCompanyName } from '../dedupe.js';
import { extractContactEmail } from '../email-extractor.js';
import { parseSalary } from '../salary.js';
import { stripHtml } from '../html-utils.js';
import { fetchWithRetry } from '../circuit-breaker.js';
import { getAtsSlugs, disableAtsSlug } from './greenhouse.js';
import { AshbyResponseSchema } from '../schemas.js';

export const ashbyAdapter: JobSource = {
  name: 'ashby',
  kind: 'ats',

  async fetch(config?: JobSourceConfig): Promise<RawJob[]> {
    const userAgent =
      config?.userAgent || 'Pigeon/1.0 (Job Application Assistant; +https://github.com/pigeon)';

    const slugs = await getAtsSlugs('ashby', config, ['linear']);
    const allJobs: RawJob[] = [];
    const failedSlugs: string[] = [];

    for (const slug of slugs) {
      const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`;

      try {
        const res = await fetchWithRetry(
          url,
          {
            headers: {
              'User-Agent': userAgent,
              Accept: 'application/json',
            },
          },
          { fetchFn: config?.fetchFn, delayFn: config?.delayFn },
        );

        if (res.status === 404) {
          // Slug returns 404 -> disable in KV
          await disableAtsSlug('ashby', slug, config);
          failedSlugs.push(slug);
          continue;
        }

        if (!res.ok) {
          if (res.status === 429) {
            throw new Error(`HTTP 429: Too Many Requests from ${url}`);
          }
          throw new Error(`Ashby API for ${slug} returned HTTP ${res.status}`);
        }

        const data = AshbyResponseSchema.parse(await res.json());
        for (const job of data.jobs || []) {
          allJobs.push({
            ...job,
            source: 'ashby',
            company_slug: slug,
          });
        }
      } catch (err) {
        const is429 =
          err instanceof Error &&
          (err.message.includes('429') || err.message.toLowerCase().includes('too many requests'));
        if (is429) {
          // 429 after retries: stop fetching further boards this run and throw (source-level rate limit)
          throw err;
        }

        // Any other failure after retries are exhausted (5xx, network error, timeout, non-404 4xx, validation)
        // is isolated to that board: log it, add it to failedSlugs, and continue with the remaining boards.
        if (err instanceof z.ZodError) {
          console.warn(`[ashby] Validation failed for company slug '${slug}':`, err);
        } else {
          console.warn(`[ashby] Failed to fetch or parse jobs for company slug '${slug}':`, err);
        }
        failedSlugs.push(slug);
      }
    }

    const total = slugs.length;
    const failedCount = failedSlugs.length;

    // Throw so the run counts as a source failure if every configured slug fails,
    // or if half or more fail when there are 4 or more slugs.
    if (total > 0) {
      const allFailed = failedCount === total;
      const halfOrMoreFailed = total >= 4 && failedCount >= Math.ceil(total / 2);

      if (allFailed || halfOrMoreFailed) {
        throw new Error(
          `ATS source ashby failed: ${failedCount} of ${total} boards failed (${failedSlugs.join(', ')})`,
        );
      }
    }

    const slugStats = {
      total,
      failed: failedCount,
      failedSlugs,
    };
    Object.assign(allJobs, { slugStats });
    if (typeof config?.onSlugStats === 'function') {
      config.onSlugStats(slugStats);
    }

    return allJobs;
  },

  normalize(raw: RawJob): NormalizedJob {
    const title = String(raw['title'] || '').trim();
    const slug = String(raw['company_slug'] || 'company');
    const company = slug.charAt(0).toUpperCase() + slug.slice(1);
    const location = String(raw['location'] || 'Remote').trim();
    const isRemote =
      typeof raw['isRemote'] === 'boolean'
        ? raw['isRemote']
        : /remote|anywhere|wfh/i.test(location);

    const description = stripHtml(String(raw['descriptionHtml'] || raw['description'] || ''));

    const comp = raw['compensation'] as
      | {
          min?: number;
          max?: number;
          currencyCode?: string;
          compensationTierSummary?: string;
        }
      | undefined;

    let salaryMin: number | null = typeof comp?.min === 'number' ? comp.min : null;
    let salaryMax: number | null = typeof comp?.max === 'number' ? comp.max : salaryMin;
    let currency: string | null = comp?.currencyCode || null;
    let salaryRaw: string | null = comp?.compensationTierSummary || null;

    if (salaryMin === null && description) {
      const parsed = parseSalary(description);
      salaryMin = parsed.salary_min;
      salaryMax = parsed.salary_max;
      currency = parsed.currency;
      salaryRaw = parsed.salary_raw;
    }

    const email = extractContactEmail(description);

    return {
      source: 'ashby',
      source_kind: 'ats',
      source_job_id: raw['id'] ? String(raw['id']) : null,
      title,
      company,
      company_normalized: normalizeCompanyName(company),
      location,
      remote: isRemote,
      salary_min: salaryMin,
      salary_max: salaryMax,
      currency: currency || (salaryMin !== null ? 'USD' : null),
      salary_raw: salaryRaw,
      description,
      apply_url: (raw['jobUrl'] as string) || (raw['url'] as string) || null,
      contact_email: email,
      contact_source: email ? 'posting' : 'none',
      posted_at: (raw['publishedAt'] as string) || null,
      untrusted: true,
    };
  },
};
