import type { JobSource, JobSourceConfig, RawJob, NormalizedJob } from '../types.js';
import { normalizeCompanyName } from '../dedupe.js';
import { extractContactEmail } from '../email-extractor.js';
import { parseSalary } from '../salary.js';
import { stripHtml } from '../html-utils.js';
import { fetchWithRetry } from '../circuit-breaker.js';

export const hiringHnAdapter: JobSource = {
  name: 'hiring_hn',
  kind: 'api',

  async fetch(config?: JobSourceConfig): Promise<RawJob[]> {
    const userAgent =
      config?.userAgent || 'Pigeon/1.0 (Job Application Assistant; +https://github.com/pigeon)';

    // Step 1: Find latest "Ask HN: Who is hiring?" thread
    const searchUrl =
      'https://hn.algolia.com/api/v1/search?tags=story,author__whoishiring&query=Ask%20HN%3A%20Who%20is%20hiring&hitsPerPage=1';

    const searchRes = await fetchWithRetry(
      searchUrl,
      {
        headers: {
          'User-Agent': userAgent,
          Accept: 'application/json',
        },
      },
      { fetchFn: config?.fetchFn },
    );

    if (!searchRes.ok) {
      throw new Error(`Algolia HN story search returned HTTP ${searchRes.status}`);
    }

    const searchData = (await searchRes.json()) as {
      hits?: Array<{ objectID?: string }>;
    };

    const storyId = searchData.hits?.[0]?.objectID;
    if (!storyId) {
      return [];
    }

    // Step 2: Fetch comments from the hiring thread
    const commentsUrl = `https://hn.algolia.com/api/v1/search?tags=comment,story_${storyId}&hitsPerPage=100`;
    const commentsRes = await fetchWithRetry(
      commentsUrl,
      {
        headers: {
          'User-Agent': userAgent,
          Accept: 'application/json',
        },
      },
      { fetchFn: config?.fetchFn },
    );

    if (!commentsRes.ok) {
      throw new Error(`Algolia HN comments search returned HTTP ${commentsRes.status}`);
    }

    const commentsData = (await commentsRes.json()) as {
      hits?: Array<Record<string, unknown>>;
    };

    return (commentsData.hits || [])
      .filter((hit) => hit['comment_text'] && hit['objectID'])
      .map((hit) => ({ ...hit, source: 'hiring_hn', story_id: storyId }));
  },

  normalize(raw: RawJob): NormalizedJob {
    const rawText = String(raw['comment_text'] || '');
    const cleanText = stripHtml(rawText);
    const lines = cleanText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const firstLine = lines[0] || '';

    let company = 'Hacker News Startup';
    let title = 'Software Engineer';
    let location = 'Remote';
    let isRemote = true;

    // HN standard format: Company | Title | Location | REMOTE | Salary
    if (firstLine.includes('|')) {
      const parts = firstLine.split('|').map((p) => p.trim());
      if (parts[0]) company = parts[0];
      if (parts[1]) title = parts[1];
      if (parts[2]) location = parts[2];
      isRemote = parts.some((p) => /remote/i.test(p));
    } else {
      isRemote = /remote|anywhere|wfh/i.test(cleanText);
    }

    const parsedSalary = parseSalary(cleanText);
    const email = extractContactEmail(cleanText);
    const id = raw['objectID'] ? String(raw['objectID']) : String(raw['id'] || '');

    return {
      source: 'hiring_hn',
      source_kind: 'api',
      source_job_id: id || null,
      title,
      company,
      company_normalized: normalizeCompanyName(company),
      location,
      remote: isRemote,
      salary_min: parsedSalary.salary_min,
      salary_max: parsedSalary.salary_max,
      currency: parsedSalary.currency,
      salary_raw: parsedSalary.salary_raw,
      description: cleanText,
      apply_url: id ? `https://news.ycombinator.com/item?id=${id}` : null,
      contact_email: email,
      contact_source: email ? 'posting' : 'none',
      posted_at: (raw['created_at'] as string) || null,
      untrusted: true,
    };
  },
};
