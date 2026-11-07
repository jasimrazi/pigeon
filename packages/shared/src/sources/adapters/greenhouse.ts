import type { JobSource, JobSourceConfig, RawJob, NormalizedJob } from '../types.js';
import { normalizeCompanyName } from '../dedupe.js';
import { extractContactEmail } from '../email-extractor.js';
import { parseSalary } from '../salary.js';
import { stripHtml } from '../html-utils.js';
import { fetchWithRetry } from '../circuit-breaker.js';
import { GreenhouseResponseSchema } from '../schemas.js';

export async function getAtsSlugs(
  source: string,
  config?: JobSourceConfig | undefined,
  defaultSlugs: string[] = [],
): Promise<string[]> {
  if (config?.slugs && config.slugs.length > 0) {
    return config.slugs;
  }
  if (config?.kv) {
    const raw = await config.kv.get(`sources:${source}:slugs`);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map(String);
        }
      } catch {
        const list = raw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        if (list.length > 0) return list;
      }
    }
  }
  return defaultSlugs;
}

export async function disableAtsSlug(
  source: string,
  slug: string,
  config?: JobSourceConfig | undefined,
): Promise<void> {
  if (!config?.kv) return;
  const currentSlugs = await getAtsSlugs(source, config, []);
  const updated = currentSlugs.filter((s) => s.toLowerCase() !== slug.toLowerCase());
  await config.kv.put(`sources:${source}:slugs`, JSON.stringify(updated));
}

export const greenhouseAdapter: JobSource = {
  name: 'greenhouse',
  kind: 'ats',

  async fetch(config?: JobSourceConfig): Promise<RawJob[]> {
    const userAgent =
      config?.userAgent || 'Pigeon/1.0 (Job Application Assistant; +https://github.com/pigeon)';

    const slugs = await getAtsSlugs('greenhouse', config, ['github']);
    const allJobs: RawJob[] = [];

    for (const slug of slugs) {
      try {
        const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(
          slug,
        )}/jobs?content=true`;

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
          // Slug returns 404 -> disable in KV and log
          await disableAtsSlug('greenhouse', slug, config);
          continue;
        }

        if (!res.ok) {
          throw new Error(`Greenhouse API for ${slug} returned HTTP ${res.status}`);
        }

        const data = GreenhouseResponseSchema.parse(await res.json());
        for (const job of data.jobs || []) {
          allJobs.push({
            ...job,
            source: 'greenhouse',
            company_slug: slug,
          });
        }
      } catch (err) {
        console.warn(`[greenhouse] Failed to fetch or parse jobs for company slug '${slug}':`, err);
      }
    }

    return allJobs;
  },

  normalize(raw: RawJob): NormalizedJob {
    const title = String(raw['title'] || '').trim();
    const slug = String(raw['company_slug'] || 'company');
    const company = slug.charAt(0).toUpperCase() + slug.slice(1);

    const locationObj = raw['location'] as { name?: string } | undefined;
    const location = String(locationObj?.name || raw['location'] || 'Remote').trim();
    const description = stripHtml(String(raw['content'] || ''));

    const isRemote =
      /remote|anywhere|wfh/i.test(location) || /remote/i.test(title) || /remote/i.test(description);

    const parsedSalary = parseSalary(description);
    const email = extractContactEmail(description);

    return {
      source: 'greenhouse',
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
      apply_url: (raw['absolute_url'] as string) || null,
      contact_email: email,
      contact_source: email ? 'posting' : 'none',
      posted_at: (raw['updated_at'] as string) || null,
      untrusted: true,
    };
  },
};
