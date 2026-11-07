import type { JobSource, JobSourceConfig, RawJob, NormalizedJob } from '../types.js';
import { normalizeCompanyName } from '../dedupe.js';
import { extractContactEmail } from '../email-extractor.js';
import { parseSalary } from '../salary.js';
import { stripHtml } from '../html-utils.js';
import { fetchWithRetry } from '../circuit-breaker.js';
import { WeWorkRemotelyJobsSchema } from '../schemas.js';

export function parseRssXml(xml: string): RawJob[] {
  const items: RawJob[] = [];
  const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/gi);

  for (const match of itemMatches) {
    const itemXml = match[1] ?? '';
    const getTag = (tag: string) => {
      const tagMatch = itemXml.match(
        new RegExp(
          `<${tag}[^>]*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))<\\/${tag}>`,
          'i',
        ),
      );
      return (tagMatch?.[1] ?? tagMatch?.[2] ?? '').trim();
    };

    const title = getTag('title');
    const link = getTag('link');
    const description = getTag('description');
    const pubDate = getTag('pubDate');
    const guid = getTag('guid') || link;

    if (title) {
      items.push({
        source: 'weworkremotely',
        id: guid,
        title,
        link,
        description,
        pubDate,
      });
    }
  }

  return WeWorkRemotelyJobsSchema.parse(items);
}

export const weWorkRemotelyAdapter: JobSource = {
  name: 'weworkremotely',
  kind: 'api',

  async fetch(config?: JobSourceConfig): Promise<RawJob[]> {
    const userAgent =
      config?.userAgent || 'Pigeon/1.0 (Job Application Assistant; +https://github.com/pigeon)';

    const res = await fetchWithRetry(
      'https://weworkremotely.com/remote-jobs.rss',
      {
        headers: {
          'User-Agent': userAgent,
          Accept: 'application/rss+xml, application/xml, text/xml',
        },
      },
      { fetchFn: config?.fetchFn },
    );

    if (!res.ok) {
      throw new Error(`WeWorkRemotely RSS returned HTTP ${res.status}`);
    }

    const xml = await res.text();
    return parseRssXml(xml);
  },

  normalize(raw: RawJob): NormalizedJob {
    const rawTitle = String(raw['title'] || '').trim();
    let company = 'WeWorkRemotely';
    let title = rawTitle;

    // Typically "Company: Title" in WWR
    if (rawTitle.includes(':')) {
      const idx = rawTitle.indexOf(':');
      company = rawTitle.substring(0, idx).trim();
      title = rawTitle.substring(idx + 1).trim();
    } else if (rawTitle.includes(' - ')) {
      const idx = rawTitle.indexOf(' - ');
      company = rawTitle.substring(0, idx).trim();
      title = rawTitle.substring(idx + 3).trim();
    }

    const description = stripHtml(String(raw['description'] || ''));
    const parsedSalary = parseSalary(description);
    const email = extractContactEmail(description);

    let postedAt: string | null = null;
    if (raw['pubDate']) {
      try {
        postedAt = new Date(String(raw['pubDate'])).toISOString();
      } catch {
        postedAt = null;
      }
    }

    return {
      source: 'weworkremotely',
      source_kind: 'api',
      source_job_id: raw['id'] ? String(raw['id']) : null,
      title,
      company,
      company_normalized: normalizeCompanyName(company),
      location: 'Worldwide',
      remote: true,
      salary_min: parsedSalary.salary_min,
      salary_max: parsedSalary.salary_max,
      currency: parsedSalary.currency,
      salary_raw: parsedSalary.salary_raw,
      description,
      apply_url: (raw['link'] as string) || null,
      contact_email: email,
      contact_source: email ? 'posting' : 'none',
      posted_at: postedAt,
      untrusted: true,
    };
  },
};
