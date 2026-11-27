import type { PortalParser, ParsedAlertJob } from '../types.js';
import { cleanTrackingUrl } from '../tracking-cleaner.js';
import { stripHtml } from '../../sources/html-utils.js';
import { extractCompanyFromCardSnippet } from './shared.js';

export const naukriParser: PortalParser = {
  portal: 'naukri',

  matchesSender(fromAddress: string): boolean {
    const addr = fromAddress.toLowerCase().trim();
    return addr.includes('naukri.com') || addr.includes('@naukri.');
  },

  parse(html: string): ParsedAlertJob[] {
    const jobs: ParsedAlertJob[] = [];
    if (!html) return jobs;

    const linkRegex = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

    let match: RegExpExecArray | null;
    const seenUrls = new Set<string>();

    while ((match = linkRegex.exec(html)) !== null) {
      const rawHref = match[1] ?? '';
      const applyUrl = cleanTrackingUrl(rawHref, 'naukri');
      if (!/naukri\.com\/(?:[^/?#]+\/)*(?:job-listings|job-alert|job-details)/i.test(applyUrl)) {
        continue;
      }

      const rawTitle = match[2] ?? '';
      const cleanTitle = stripHtml(rawTitle);

      if (
        !cleanTitle ||
        /^(view|see|apply|read|click|more|unsubscribe|naukri|login)/i.test(cleanTitle)
      ) {
        continue;
      }

      if (seenUrls.has(applyUrl)) {
        continue;
      }
      seenUrls.add(applyUrl);

      const afterLink = html.slice(match.index + match[0].length, match.index + match[0].length + 2500);
      const nextCardBoundary = afterLink.search(
        /<div class="job-tuple"|View All Recommendations|Applies are a click away|<a\b[^>]*href="[^"]*naukri\.com\/(?:[^"?#]+\/)*(?:job-listings|job-alert|job-details)/i,
      );
      const contextSnippet =
        nextCardBoundary !== -1 ? afterLink.slice(0, nextCardBoundary) : afterLink;

      // Extract company
      let company = 'Unknown';
      const extractedCompany = extractCompanyFromCardSnippet(
        contextSnippet,
        cleanTitle,
        /(?:class="[^"]*(?:company|org|comp-name|company-name)[^"]*"[^>]*>|<span[^>]*class="[^"]*c-name[^"]*"[^>]*>)([\s\S]*?)<\/(?:div|span|p|a)>/i,
      );
      if (extractedCompany) {
        company = extractedCompany;
      }

      // Extract location
      let location: string | null = null;
      const locationMatch =
        contextSnippet.match(
          /(?:class="[^"]*(?:location|loc|city)[^"]*"[^>]*>)([\s\S]*?)<\/(?:div|span|p|td)>/i,
        ) ||
        contextSnippet.match(
          /location-icon\.[a-z]+[\s\S]{0,300}class="[^"]*cart_subheading[^"]*"[^>]*>([\s\S]*?)<\/(?:div|span|p|td)>/i,
        ) ||
        contextSnippet.match(
          /(?:Bengaluru|Bangalore|Mumbai|Delhi|Hyderabad|Pune|Chennai|Gurgaon|Gurugram|Noida|Kolkata|Ahmedabad|Remote)/i,
        );

      if (locationMatch) {
        const rawLoc = locationMatch[1] ?? locationMatch[0];
        const cleanLoc = stripHtml(rawLoc).trim();
        if (cleanLoc && cleanLoc !== cleanTitle && cleanLoc !== company) {
          location = cleanLoc;
        }
      }

      // Extract salary (e.g. 15-25 Lacs PA or ₹15,00,000 - ₹25,00,000)
      let salaryRaw: string | null = null;
      const salaryMatch = contextSnippet.match(
        /((?:₹\s*[\d,]+(?:\s*-\s*₹?\s*[\d,]+)?|\b\d+(?:\.\d+)?\s*[-–to]\s*\d+(?:\.\d+)?\s*(?:Lacs?|Lakhs?|Cr)\s*(?:PA|P\.A\.|per\s+annum)?|\b(?:Not\s+Disclosed|Best\s+in\s+Industry)\b))/i,
      );

      if (salaryMatch?.[1] && !/Not Disclosed|Best in Industry/i.test(salaryMatch[1])) {
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
