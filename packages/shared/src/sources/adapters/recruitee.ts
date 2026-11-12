import { z } from 'zod';
import type { JobSource, JobSourceConfig, RawJob, NormalizedJob } from '../types.js';
import { normalizeCompanyName } from '../dedupe.js';
import { extractContactEmail } from '../email-extractor.js';
import { parseSalary } from '../salary.js';
import { fetchWithRetry } from '../circuit-breaker.js';
import { RecruiteeResponseSchema } from '../schemas.js';
import { getAtsSlugs, disableAtsSlug } from './greenhouse.js';

export const recruiteeAdapter: JobSource = {
  name: 'recruitee',
  kind: 'ats',

  async fetch(config?: JobSourceConfig): Promise<RawJob[]> {
    const userAgent =
      config?.userAgent || 'Pigeon/1.0 (Job Application Assistant; +https://github.com/pigeon)';

    const slugs = await getAtsSlugs('recruitee', config, ['acme']);
    const allJobs: RawJob[] = [];
    const failedSlugs: string[] = [];

    for (const slug of slugs) {
      const url = `https://${encodeURIComponent(slug)}.recruitee.com/api/offers`;

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
          await disableAtsSlug('recruitee', slug, config);
          console.warn(
            `[recruitee] Company slug '${slug}' returned 404 and has been disabled in KV.`,
          );
          failedSlugs.push(slug);
          continue;
        }

        if (!res.ok) {
          throw new Error(`HTTP ${res.status} from ${url}`);
        }

        const data: unknown = await res.json();
        const parsed = RecruiteeResponseSchema.parse(data);

        for (const item of parsed.offers || []) {
          allJobs.push({
            ...item,
            company_slug: slug,
          });
        }
      } catch (err) {
        if (err instanceof z.ZodError) {
          console.warn(`[recruitee] Validation failed for company slug '${slug}':`, err);
        } else {
          console.warn(
            `[recruitee] Failed to fetch or parse jobs for company slug '${slug}':`,
            err,
          );
        }
        failedSlugs.push(slug);
      }
    }

    const total = slugs.length;
    const failedCount = failedSlugs.length;

    if (total > 0) {
      const allFailed = failedCount === total;
      const halfOrMoreFailed = total >= 4 && failedCount >= Math.ceil(total / 2);

      if (allFailed || halfOrMoreFailed) {
        throw new Error(
          `ATS source recruitee failed: ${failedCount} of ${total} boards failed (${failedSlugs.join(', ')})`,
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
    const company =
      String(raw['company_name'] || '').trim() || slug.charAt(0).toUpperCase() + slug.slice(1);

    const location = String(raw['location'] || 'Remote').trim() || 'Remote';
    const isRemote =
      Boolean(raw['remote']) || /remote|anywhere|wfh/i.test(location) || /remote/i.test(title);

    const description = title;
    const parsedSalary = parseSalary(description);
    const email = extractContactEmail(description);
    const applyUrl =
      (raw['careers_url'] as string) ||
      (raw['id'] ? `https://${slug}.recruitee.com/o/${raw['id']}` : null);

    return {
      source: 'recruitee',
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
      apply_url: applyUrl,
      contact_email: email,
      contact_source: email ? 'posting' : 'none',
      posted_at: (raw['published_at'] as string) || null,
      untrusted: true,
    };
  },
};
