import type { PortalParser, ParsedAlertJob } from '../types.js';
import { cleanTrackingUrl } from '../tracking-cleaner.js';
import { stripHtml } from '../../sources/html-utils.js';
import { extractCompanyFromCardSnippet } from './shared.js';

export const founditParser: PortalParser = {
  portal: 'foundit',

  matchesSender(fromAddress: string): boolean {
    const addr = fromAddress.toLowerCase().trim();
    return addr.includes('foundit.') || addr.includes('monsterindia.com');
  },

  parse(html: string): ParsedAlertJob[] {
    const jobs: ParsedAlertJob[] = [];
    if (!html) return jobs;

    const linkRegex = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

    let match: RegExpExecArray | null;
    const seenUrls = new Set<string>();

    while ((match = linkRegex.exec(html)) !== null) {
      const rawHref = match[1] ?? '';
      const applyUrl = cleanTrackingUrl(rawHref, 'foundit');
      if (!/(?:foundit\.[a-z.]+\/job\/|monsterindia\.com\/[^"]*job-details\/)/i.test(applyUrl)) {
        continue;
      }

      const rawTitle = match[2] ?? '';
      const cleanTitle = stripHtml(rawTitle);

      if (
        !cleanTitle ||
        /^(view|see|apply|read|click|more|unsubscribe|settings|manage|foundit|monster)/i.test(
          cleanTitle,
        )
      ) {
        continue;
      }

      if (seenUrls.has(applyUrl)) {
        continue;
      }
      seenUrls.add(applyUrl);

      const afterLink = html.slice(match.index + match[0].length, match.index + match[0].length + 2000);
      const nextCardBoundary = afterLink.search(
        /<div class="job"|>Apply now<|How is the search relevance|<a\b[^>]*href="[^"]*(?:foundit\.[a-z.]+\/(?:job\/|rio\/autoLogin)|monsterindia\.com\/[^"]*job-details)/i,
      );
      const contextSnippet =
        nextCardBoundary !== -1 ? afterLink.slice(0, nextCardBoundary) : afterLink;

      let company = 'Unknown';
      const extractedCompany = extractCompanyFromCardSnippet(
        contextSnippet,
        cleanTitle,
        /(?:class="[^"]*(?:company|employer|comp-name)[^"]*"[^>]*>|<strong[^>]*>|<span[^>]*class="[^"]*company[^"]*"[^>]*>)([\s\S]*?)<\/(?:div|span|strong|p|a)>/i,
      );
      if (extractedCompany) {
        company = extractedCompany;
      }

      let location: string | null = null;
      const locationMatch =
        contextSnippet.match(
          /(?:class="[^"]*(?:location|city)[^"]*"[^>]*>)([\s\S]*?)<\/(?:div|span|p)>/i,
        ) ||
        contextSnippet.match(
          /(?:[A-Z][a-zA-Z\s.-]+,\s*[A-Z]{2}(?:\s+\(Hybrid\)|\s+\(Remote\))?|\bRemote\b|\bHybrid\b|Bangalore|Bengaluru|Mumbai|Delhi|Hyderabad|Pune|Noida|Gurgaon|Chennai|Kolkata)/i,
        );

      if (locationMatch) {
        const rawLoc = locationMatch[1] ?? locationMatch[0];
        const cleanLoc = stripHtml(rawLoc).trim();
        if (cleanLoc && cleanLoc !== cleanTitle && cleanLoc !== company) {
          location = cleanLoc;
        }
      }

      if (!location && company !== 'Unknown') {
        const paragraphTexts = Array.from(contextSnippet.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi))
          .map((m) => stripHtml(m[1] ?? '').trim())
          .filter((t) => Boolean(t) && t !== cleanTitle && t !== company && !/^apply now$/i.test(t));
        if (paragraphTexts[0] && paragraphTexts[0].length < 80) {
          location = paragraphTexts[0];
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
        description: `${cleanTitle} at ${company}${location ? ` - ${location}` : ''}`,
      });
    }

    return jobs;
  },
};
