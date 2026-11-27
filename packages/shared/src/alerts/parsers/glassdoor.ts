import type { PortalParser, ParsedAlertJob } from '../types.js';
import { cleanTrackingUrl } from '../tracking-cleaner.js';
import { stripHtml } from '../../sources/html-utils.js';
import { extractCompanyFromCardSnippet } from './shared.js';

const GLASSDOOR_BOILERPLATE_REGEX =
  /^(?:view|see|apply|read|click|more|unsubscribe|settings|manage|glassdoor|create|sign\s*in|log\s*in|register|help|download|privacy|terms)\b/i;

const GLASSDOOR_BADGE_OR_AGE_REGEX =
  /^(?:easy apply|best place to work|best-led company|\d+\s*[dhmw]\+?)$/i;

export const glassdoorParser: PortalParser = {
  portal: 'glassdoor',

  matchesSender(fromAddress: string): boolean {
    const addr = fromAddress.toLowerCase().trim();
    return addr.includes('glassdoor.com') || addr.includes('@glassdoor.');
  },

  parse(html: string): ParsedAlertJob[] {
    const jobs: ParsedAlertJob[] = [];
    if (!html) return jobs;

    const linkRegex =
      /<a\b[^>]*href="([^"]*(?:glassdoor\.com\/(?:job-listing|Job\/|partner\/jobListing\.htm)[^"]*|\/job-listing[^"]*))"[^>]*>([\s\S]*?)<\/a>/gi;

    let match: RegExpExecArray | null;
    const seenUrls = new Set<string>();

    while ((match = linkRegex.exec(html)) !== null) {
      const rawHref = match[1] ?? '';
      const rawTitle = match[2] ?? '';
      const cleanAnchorText = stripHtml(rawTitle);

      if (!cleanAnchorText || cleanAnchorText.length < 3 || GLASSDOOR_BOILERPLATE_REGEX.test(cleanAnchorText)) {
        continue;
      }

      const applyUrl = cleanTrackingUrl(rawHref, 'glassdoor');
      if (seenUrls.has(applyUrl)) {
        continue;
      }
      seenUrls.add(applyUrl);

      const lines = cleanAnchorText
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);

      let cleanTitle = cleanAnchorText;
      let company = 'Unknown';
      let location: string | null = null;
      let salaryRaw: string | null = null;

      if (lines.length >= 2 && lines[0] && lines[1]) {
        // Glassdoor digest cards often wrap [Company + rating, Title, Location, Salary, Badge, Age] inside <a>
        const cleanedCompany = lines[0].replace(/\s+\d+(?:\.\d+)?\s*★$/, '').trim();
        if (cleanedCompany && cleanedCompany.length < 100) {
          company = cleanedCompany;
        }
        cleanTitle = lines[1];

        for (const extra of lines.slice(2)) {
          if (GLASSDOOR_BADGE_OR_AGE_REGEX.test(extra)) {
            continue;
          }
          if (
            !salaryRaw &&
            (/[₹$€£]/.test(extra) || /\b(?:AED|SAR|QAR|SGD|AUD|CAD)\b/.test(extra) || /\best\.\)/i.test(extra)) &&
            /\d/.test(extra)
          ) {
            salaryRaw = extra;
          } else if (!location) {
            location = extra;
          }
        }
      }

      const afterLink = html.slice(match.index + match[0].length, match.index + 800);
      const nextCardBoundary = afterLink.search(
        /<div class="job"|<table|<tr|<a\b[^>]*href="[^"]*glassdoor/i,
      );
      const contextSnippet =
        nextCardBoundary !== -1 ? afterLink.slice(0, nextCardBoundary) : afterLink;

      if (company === 'Unknown') {
        const extractedCompany = extractCompanyFromCardSnippet(
          contextSnippet,
          cleanTitle,
          /(?:class="[^"]*(?:employer|company|employerName)[^"]*"[^>]*>|<strong[^>]*>|<span[^>]*class="[^"]*company[^"]*"[^>]*>)([\s\S]*?)<\/(?:div|span|strong|p|a)>/i,
        );
        if (extractedCompany) {
          company = extractedCompany;
        }
      }

      if (!location) {
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
      }

      if (!salaryRaw) {
        const salaryMatch = contextSnippet.match(
          /([$€£₹]\s*[\d,]+(?:\.\d+)?(?:\s*k)?(?:\s*[-–to/]\s*[$€£₹]?\s*[\d,]+(?:\.\d+)?(?:\s*k)?)?\s*(?:\/\s*(?:yr|year|hr|hour)|\bper\s+(?:year|hour)\b|\ba\s+year\b))/i,
        );
        if (salaryMatch?.[1]) {
          salaryRaw = stripHtml(salaryMatch[1]).trim();
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
