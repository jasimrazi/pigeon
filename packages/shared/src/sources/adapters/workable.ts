import { z } from 'zod';
import type { JobSource, JobSourceConfig, RawJob, NormalizedJob } from '../types.js';
import { normalizeCompanyName } from '../dedupe.js';
import { extractContactEmail } from '../email-extractor.js';
import { parseSalary } from '../salary.js';
import { fetchWithRetry } from '../circuit-breaker.js';
import { WorkableResponseSchema } from '../schemas.js';
import { getAtsSlugs, disableAtsSlug } from './greenhouse.js';

export const workableAdapter: JobSource = {
  name: 'workable',
  kind: 'ats',

  async fetch(config?: JobSourceConfig): Promise<RawJob[]> {
    const userAgent =
      config?.userAgent || 'Pigeon/1.0 (Job Application Assistant; +https://github.com/pigeon)';

    const slugs = await getAtsSlugs('workable', config, ['superops']);
    const allJobs: RawJob[] = [];
    const failedSlugs: string[] = [];

    for (const slug of slugs) {
      const url = `https://careers-page.workable.com/api/v1/accounts/${encodeURIComponent(
        slug,
      )}/jobs`;

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
          await disableAtsSlug('workable', slug, config);
          console.warn(
            `[workable] Company slug '${slug}' returned 404 and has been disabled in KV.`,
          );
          failedSlugs.push(slug);
          continue;
        }

        if (!res.ok) {
          throw new Error(`HTTP ${res.status} from ${url}`);
        }

        const data: unknown = await res.json();
        const parsed = WorkableResponseSchema.parse(data);

        for (const item of parsed.results || []) {
          allJobs.push({
            ...item,
            company_slug: slug,
          });
        }
      } catch (err) {
        if (err instanceof z.ZodError) {
          console.warn(`[workable] Validation failed for company slug '${slug}':`, err);
        } else {
          console.warn(`[workable] Failed to fetch or parse jobs for company slug '${slug}':`, err);
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
          `ATS source workable failed: ${failedCount} of ${total} boards failed (${failedSlugs.join(', ')})`,
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

    const locObj = raw['location'] as
      { city?: string; region?: string; country?: string; telecommuting?: boolean } | undefined;
    const locParts = [locObj?.city, locObj?.region, locObj?.country].filter(Boolean);
    const location = locParts.length > 0 ? locParts.join(', ') : 'Remote';
    const isRemote =
      Boolean(locObj?.telecommuting) ||
      /remote|anywhere|wfh/i.test(location) ||
      /remote/i.test(title);

    const description = title;
    const parsedSalary = parseSalary(description);
    const email = extractContactEmail(description);

    return {
      source: 'workable',
      source_kind: 'ats',
      source_job_id: raw['shortcode']
        ? String(raw['shortcode'])
        : raw['id']
          ? String(raw['id'])
          : null,
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
      apply_url: (raw['url'] as string) || null,
      contact_email: email,
      contact_source: email ? 'posting' : 'none',
      posted_at: (raw['published'] as string) || null,
      untrusted: true,
    };
  },
};
