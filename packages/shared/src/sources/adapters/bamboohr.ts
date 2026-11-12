import { z } from 'zod';
import type { JobSource, JobSourceConfig, RawJob, NormalizedJob } from '../types.js';
import { normalizeCompanyName } from '../dedupe.js';
import { extractContactEmail } from '../email-extractor.js';
import { parseSalary } from '../salary.js';
import { fetchWithRetry } from '../circuit-breaker.js';
import { BambooHrResponseSchema } from '../schemas.js';
import { getAtsSlugs, disableAtsSlug } from './greenhouse.js';

export const bambooHrAdapter: JobSource = {
  name: 'bamboohr',
  kind: 'ats',

  async fetch(config?: JobSourceConfig): Promise<RawJob[]> {
    const userAgent =
      config?.userAgent || 'Pigeon/1.0 (Job Application Assistant; +https://github.com/pigeon)';

    const slugs = await getAtsSlugs('bamboohr', config, ['acme']);
    const allJobs: RawJob[] = [];
    const failedSlugs: string[] = [];

    for (const slug of slugs) {
      const url = `https://${encodeURIComponent(slug)}.bamboohr.com/careers/list`;

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
          await disableAtsSlug('bamboohr', slug, config);
          console.warn(
            `[bamboohr] Company slug '${slug}' returned 404 and has been disabled in KV.`,
          );
          failedSlugs.push(slug);
          continue;
        }

        if (!res.ok) {
          throw new Error(`HTTP ${res.status} from ${url}`);
        }

        const data: unknown = await res.json();
        const parsed = BambooHrResponseSchema.parse(data);

        for (const item of parsed.result || []) {
          allJobs.push({
            ...item,
            company_slug: slug,
          });
        }
      } catch (err) {
        if (err instanceof z.ZodError) {
          console.warn(`[bamboohr] Validation failed for company slug '${slug}':`, err);
        } else {
          console.warn(`[bamboohr] Failed to fetch or parse jobs for company slug '${slug}':`, err);
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
          `ATS source bamboohr failed: ${failedCount} of ${total} boards failed (${failedSlugs.join(', ')})`,
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
    const title = String(raw['jobOpeningName'] || '').trim();
    const slug = String(raw['company_slug'] || 'company');
    const company = slug.charAt(0).toUpperCase() + slug.slice(1);

    const locObj = raw['location'] as { city?: string; state?: string } | undefined;
    const locParts = [locObj?.city, locObj?.state].filter(Boolean);
    const location = locParts.length > 0 ? locParts.join(', ') : 'Remote';
    const isRemoteVal = raw['isRemote'];
    const isRemote =
      isRemoteVal === true ||
      isRemoteVal === 1 ||
      String(isRemoteVal).toLowerCase() === 'true' ||
      /remote|anywhere|wfh/i.test(location) ||
      /remote/i.test(title);

    const description = title;
    const parsedSalary = parseSalary(description);
    const email = extractContactEmail(description);
    const applyUrl = raw['id'] ? `https://${slug}.bamboohr.com/careers/${raw['id']}` : null;

    return {
      source: 'bamboohr',
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
      posted_at: null,
      untrusted: true,
    };
  },
};
