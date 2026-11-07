import { z } from 'zod';
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
    const failedSlugs: string[] = [];

    for (const slug of slugs) {
      const url = `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`;

      // 429s (honouring Retry-After), 5xx responses and network errors follow the source-level retry
      // and failure path and are not swallowed.
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
        await disableAtsSlug('lever', slug, config);
        failedSlugs.push(slug);
        continue;
      }

      if (!res.ok) {
        throw new Error(`Lever API for ${slug} returned HTTP ${res.status}`);
      }

      // Isolate per slug ONLY validation failures (ZodError)
      try {
        const data = LeverResponseSchema.parse(await res.json());
        for (const job of data) {
          allJobs.push({
            ...job,
            source: 'lever',
            company_slug: slug,
          });
        }
      } catch (err) {
        if (err instanceof z.ZodError) {
          console.warn(`[lever] Validation failed for company slug '${slug}':`, err);
          failedSlugs.push(slug);
        } else {
          throw err;
        }
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
          `ATS source lever failed: ${failedCount} of ${total} boards failed (${failedSlugs.join(', ')})`,
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
