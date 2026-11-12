import type { PortalParser, ParsedAlertJob } from '../types.js';
import { cleanTrackingUrl } from '../tracking-cleaner.js';
import { stripHtml } from '../../sources/html-utils.js';

export const instahyreParser: PortalParser = {
  portal: 'instahyre',

  matchesSender(fromAddress: string): boolean {
    const addr = fromAddress.toLowerCase().trim();
    return addr.includes('instahyre.com') || addr.includes('@instahyre.');
  },

  parse(html: string): ParsedAlertJob[] {
    const jobs: ParsedAlertJob[] = [];
    if (!html) return jobs;

    const linkRegex =
      /<a\b[^>]*href="([^"]*(?:instahyre\.com\/job-[^"]*|\/job-[^"]*))"[^>]*>([\s\S]*?)<\/a>/gi;

    let match: RegExpExecArray | null;
    const seenUrls = new Set<string>();

    while ((match = linkRegex.exec(html)) !== null) {
      const rawHref = match[1] ?? '';
      const rawTitle = match[2] ?? '';
      const cleanTitle = stripHtml(rawTitle);

      if (
        !cleanTitle ||
        /^(view|see|apply|read|click|more|unsubscribe|settings|manage|instahyre)/i.test(cleanTitle)
      ) {
        continue;
      }

      const applyUrl = cleanTrackingUrl(rawHref, 'instahyre');
      if (seenUrls.has(applyUrl)) {
        continue;
      }
      seenUrls.add(applyUrl);

      const afterLink = html.slice(match.index + match[0].length, match.index + 800);
      const nextCardBoundary = afterLink.search(
        /<div class="job"|<table|<tr|<a\b[^>]*href="[^"]*instahyre/i,
      );
      const contextSnippet =
        nextCardBoundary !== -1 ? afterLink.slice(0, nextCardBoundary) : afterLink;

      let company = 'Unknown';
      const companyMatch =
        contextSnippet.match(
          /(?:class="[^"]*(?:company|employer|employer-name)[^"]*"[^>]*>|<strong[^>]*>|<span[^>]*class="[^"]*company[^"]*"[^>]*>)([\s\S]*?)<\/(?:div|span|strong|p|a)>/i,
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
          /(?:[A-Z][a-zA-Z\s.-]+,\s*[A-Z]{2}(?:\s+\(Hybrid\)|\s+\(Remote\))?|\bRemote\b|\bHybrid\b|Bangalore|Bengaluru|Mumbai|Delhi|Hyderabad|Pune|Noida|Gurgaon)/i,
        );

      if (locationMatch) {
        const rawLoc = locationMatch[1] ?? locationMatch[0];
        const cleanLoc = stripHtml(rawLoc).trim();
        if (cleanLoc && cleanLoc !== cleanTitle && cleanLoc !== company) {
          location = cleanLoc;
        }
      }

      let salaryRaw: string | null = null;
      const salaryMatch =
        contextSnippet.match(/(?:class="[^"]*salary[^"]*"[^>]*>)([\s\S]*?)<\/(?:div|span|p)>/i) ||
        contextSnippet.match(
          /([₹$€£]?\s*[\d,]+(?:\.\d+)?\s*(?:[-–to/]\s*[₹$€£]?\s*[\d,]+(?:\.\d+)?)?\s*(?:LPA|Lacs|Lakhs?|k|\/\s*(?:yr|year)|\bper\s+annum\b|\ba\s+year\b))/i,
        );
      if (salaryMatch) {
        const rawSal = salaryMatch[1] ?? salaryMatch[0];
        const candidate = stripHtml(rawSal).trim();
        if (candidate && /[\d]/.test(candidate)) {
          salaryRaw = candidate;
        }
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
