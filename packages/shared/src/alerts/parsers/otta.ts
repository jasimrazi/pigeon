import type { PortalParser, ParsedAlertJob } from '../types.js';
import { cleanTrackingUrl } from '../tracking-cleaner.js';
import { stripHtml } from '../../sources/html-utils.js';

export const ottaParser: PortalParser = {
  portal: 'otta',

  matchesSender(fromAddress: string): boolean {
    const addr = fromAddress.toLowerCase().trim();
    return addr.includes('otta.com') || addr.includes('welcometothejungle.');
  },

  parse(html: string): ParsedAlertJob[] {
    const jobs: ParsedAlertJob[] = [];
    if (!html) return jobs;

    const linkRegex =
      /<a\b[^>]*href="([^"]*(?:otta\.com\/(?:jobs|company\/[^/]+\/jobs)\/|welcometothejungle\.com\/[^"]*jobs\/)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;

    let match: RegExpExecArray | null;
    const seenUrls = new Set<string>();

    while ((match = linkRegex.exec(html)) !== null) {
      const rawHref = match[1] ?? '';
      const rawTitle = match[2] ?? '';
      const cleanTitle = stripHtml(rawTitle);

      if (
        !cleanTitle ||
        /^(view|see|apply|read|click|more|unsubscribe|settings|manage|otta|welcome)/i.test(
          cleanTitle,
        )
      ) {
        continue;
      }

      const applyUrl = cleanTrackingUrl(rawHref, 'otta');
      if (seenUrls.has(applyUrl)) {
        continue;
      }
      seenUrls.add(applyUrl);

      const afterLink = html.slice(match.index + match[0].length, match.index + 800);
      const nextCardBoundary = afterLink.search(
        /<div class="job-card"|<table|<tr|<a\b[^>]*href="[^"]*(?:otta|welcometothejungle)/i,
      );
      const contextSnippet =
        nextCardBoundary !== -1 ? afterLink.slice(0, nextCardBoundary) : afterLink;

      let company = 'Unknown';
      const companyMatch =
        contextSnippet.match(
          /(?:class="[^"]*(?:company|company-name|employer)[^"]*"[^>]*>|<strong[^>]*>|<span[^>]*class="[^"]*company[^"]*"[^>]*>)([\s\S]*?)<\/(?:div|span|strong|p|a)>/i,
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

      let location: string | null = null;
      const locationMatch =
        contextSnippet.match(
          /(?:class="[^"]*(?:location|city)[^"]*"[^>]*>)([\s\S]*?)<\/(?:div|span|p)>/i,
        ) ||
        contextSnippet.match(
          /(?:[A-Z][a-zA-Z\s.-]+,\s*[A-Z]{2}(?:\s+\(Hybrid\)|\s+\(Remote\))?|\bRemote\b|\bHybrid\b)/,
        );

      if (locationMatch) {
        const rawLoc = locationMatch[1] ?? locationMatch[0];
        const cleanLoc = stripHtml(rawLoc).trim();
        if (cleanLoc && cleanLoc !== cleanTitle && cleanLoc !== company) {
          location = cleanLoc;
        }
      }

      let salaryRaw: string | null = null;
      const salaryMatch = contextSnippet.match(
        /([$€£]\s*[\d,]+(?:\.\d+)?(?:\s*k)?(?:\s*[-–to/]\s*[$€£]?\s*[\d,]+(?:\.\d+)?(?:\s*k)?)?\s*(?:\/\s*(?:yr|year|annum)|\bper\s+(?:year|annum)\b|\ba\s+year\b))/i,
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
        description: null,
      });
    }

    return jobs;
  },
};
