import type { PortalParser, ParsedAlertJob } from '../types.js';
import { cleanTrackingUrl } from '../tracking-cleaner.js';
import { stripHtml } from '../../sources/html-utils.js';

export const linkedInParser: PortalParser = {
  portal: 'linkedin',

  matchesSender(fromAddress: string): boolean {
    const addr = fromAddress.toLowerCase().trim();
    return addr.includes('linkedin.com') || addr.includes('@linkedin.');
  },

  parse(html: string): ParsedAlertJob[] {
    const jobs: ParsedAlertJob[] = [];
    if (!html) return jobs;

    // LinkedIn job alert links typically match /jobs/view/ or /comm/jobs/view/
    // We match table rows, divs, or table cards containing a LinkedIn job link
    const linkRegex =
      /<a\b[^>]*href="([^"]*(?:linkedin\.com\/(?:comm\/)?jobs\/view\/|\/jobs\/view\/)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;

    // Find all job links
    let match: RegExpExecArray | null;
    const seenUrls = new Set<string>();

    while ((match = linkRegex.exec(html)) !== null) {
      const rawHref = match[1] ?? '';
      const rawTitle = match[2] ?? '';
      const cleanTitle = stripHtml(rawTitle);

      // Skip non-job anchors like "View job", "Apply now", "See more", or empty titles
      if (
        !cleanTitle ||
        /^(view|see|apply|read|click|more|follow|check|unsubscribe|settings)/i.test(cleanTitle)
      ) {
        continue;
      }

      const applyUrl = cleanTrackingUrl(rawHref, 'linkedin');
      if (seenUrls.has(applyUrl)) {
        continue;
      }
      seenUrls.add(applyUrl);

      // Extract the surrounding context (up to 800 characters around or after the link)
      const afterLink = html.slice(match.index + match[0].length, match.index + 800);
      const nextCardBoundary = afterLink.search(
        /<table class="job-card"|<table|<tr|<a\b[^>]*href="[^"]*linkedin\.com/i,
      );
      const contextSnippet =
        nextCardBoundary !== -1 ? afterLink.slice(0, nextCardBoundary) : afterLink;

      // Extract company
      // Common LinkedIn email markup:
      // <div ...>Company Name</div> or <span>Company</span> or class="company" or after the title
      let company = 'Unknown';
      const companyMatch =
        contextSnippet.match(
          /(?:class="[^"]*(?:company|jobsearch-Company|org)[^"]*"[^>]*>|<strong[^>]*>|<span[^>]*class="[^"]*sub-title[^"]*"[^>]*>)([\s\S]*?)<\/(?:div|span|strong|p)>/i,
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
          /(?:class="[^"]*(?:location|city|job-location)[^"]*"[^>]*>)([\s\S]*?)<\/(?:div|span|p)>/i,
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

      // Extract salary if mentioned (e.g. $140,000 - $180,000 / yr)
      let salaryRaw: string | null = null;
      const salaryMatch = contextSnippet.match(
        /([$€£₹]\s*[\d,]+(?:\.\d+)?(?:\s*k)?(?:\s*[-–to/]\s*[$€£₹]?\s*[\d,]+(?:\.\d+)?(?:\s*k)?)?\s*(?:\/\s*(?:yr|year|mo|month|hr|hour)|\bper\s+(?:year|annum|month|hour)\b|\bannually\b|\ba\s+year\b))/i,
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
