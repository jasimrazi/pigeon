import type { PortalParser, ParsedAlertJob } from '../types.js';
import { cleanTrackingUrl } from '../tracking-cleaner.js';
import { stripHtml } from '../../sources/html-utils.js';

export const indeedParser: PortalParser = {
  portal: 'indeed',

  matchesSender(fromAddress: string): boolean {
    const addr = fromAddress.toLowerCase().trim();
    return addr.includes('indeed.com') || addr.includes('@indeed.');
  },

  parse(html: string): ParsedAlertJob[] {
    const jobs: ParsedAlertJob[] = [];
    if (!html) return jobs;

    const linkRegex =
      /<a\b[^>]*href="([^"]*(?:indeed\.com\/(?:viewjob|rc\/clk|job\/)[^"]*|\/viewjob[^"]*))"[^>]*>([\s\S]*?)<\/a>/gi;

    let match: RegExpExecArray | null;
    const seenUrls = new Set<string>();

    while ((match = linkRegex.exec(html)) !== null) {
      const rawHref = match[1] ?? '';
      const rawTitle = match[2] ?? '';
      const cleanTitle = stripHtml(rawTitle);

      if (
        !cleanTitle ||
        /^(view|see|apply|read|click|more|unsubscribe|indeed|manage|privacy)/i.test(cleanTitle)
      ) {
        continue;
      }

      const applyUrl = cleanTrackingUrl(rawHref, 'indeed');
      if (seenUrls.has(applyUrl)) {
        continue;
      }
      seenUrls.add(applyUrl);

      const afterLink = html.slice(match.index + match[0].length, match.index + 800);
      const nextCardBoundary = afterLink.search(
        /<div class="job-result"|<div class="job"|<table|<tr|<a\b[^>]*href="[^"]*indeed\.com/i,
      );
      const contextSnippet =
        nextCardBoundary !== -1 ? afterLink.slice(0, nextCardBoundary) : afterLink;

      // Extract company
      let company = 'Unknown';
      const companyMatch =
        contextSnippet.match(
          /(?:class="[^"]*(?:company|companyName|jobsearch-Company)[^"]*"[^>]*>|<span[^>]*class="[^"]*company_location[^"]*"[^>]*>)([\s\S]*?)<\/(?:div|span|p|a)>/i,
        ) ||
        contextSnippet.match(
          /<\/a>[\s\S]*?<(?:span|div|p|td)[^>]*>([\s\S]*?)<\/(?:span|div|p|td)>/i,
        );

      if (companyMatch?.[1]) {
        const candidate = stripHtml(companyMatch[1]).trim();
        if (candidate && candidate !== cleanTitle && candidate.length < 100) {
          company = candidate;
        }
      }

      // Extract location
      let location: string | null = null;
      const locationMatch =
        contextSnippet.match(
          /(?:class="[^"]*(?:location|companyLocation|job-location)[^"]*"[^>]*>)([\s\S]*?)<\/(?:div|span|p)>/i,
        ) ||
        contextSnippet.match(
          /(?:[A-Z][a-zA-Z\s.-]+,\s*[A-Z]{2}(?:\s+\d{5})?|\bRemote\b|\bHybrid\b)/,
        );

      if (locationMatch) {
        const rawLoc = locationMatch[1] ?? locationMatch[0];
        const cleanLoc = stripHtml(rawLoc).trim();
        if (cleanLoc && cleanLoc !== cleanTitle && cleanLoc !== company) {
          location = cleanLoc;
        }
      }

      // Extract salary
      let salaryRaw: string | null = null;
      const salaryMatch = contextSnippet.match(
        /([$€£₹]\s*[\d,]+(?:\.\d+)?(?:\s*[-–to/]\s*[$€£₹]?\s*[\d,]+(?:\.\d+)?)?\s*(?:\/\s*(?:yr|year|mo|month|hr|hour)|\b(?:a\s+year|an\s+hour|a\s+month|per\s+year)\b))/i,
      );

      if (salaryMatch?.[1]) {
        salaryRaw = stripHtml(salaryMatch[1]).trim();
      }

      jobs.push({
        title: cleanTitle,
        company,
        location,
        apply_url: applyUrl,
        salary_raw: salaryRaw,
        description: `${cleanTitle} at ${company}${location ? ` - ${location}` : ''}`,
      });
    }

    return jobs;
  },
};
