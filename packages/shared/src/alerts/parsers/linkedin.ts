import type { PortalParser, ParsedAlertJob } from '../types.js';
import { cleanTrackingUrl } from '../tracking-cleaner.js';
import { stripHtml } from '../../sources/html-utils.js';
import { extractCompanyFromCardSnippet, isPlausibleCompanyCandidate } from './shared.js';

const LINKEDIN_BADGE_REGEX =
  /^(?:easy apply|promoted|actively recruiting|this company is actively hiring|apply with resume(?:\s*&\s*profile)?)$/i;

const LINKEDIN_HEADER_LINE_REGEX =
  /^(?:your job alert\b|\d+\+?\s*new jobs?\b|see all jobs\b|manage your job alerts?\b|job search smarter\b)/i;

function splitMiddotCompanyLocation(raw: string): {
  company: string | null;
  location: string | null;
} {
  const parts = raw
    .split(/\s*[·•]\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  const company = parts[0] && parts[0].length < 100 ? parts[0] : null;
  const location = parts[1] ? parts.slice(1).join(' · ') : null;
  return { company, location };
}

function extractFlavorHighlight(contextSnippet: string): string | null {
  const flavorMatch = contextSnippet.match(
    /class="[^"]*job-card-flavor__detail[^"]*"[^>]*>([\s\S]*?)<\/p>/i,
  );
  if (!flavorMatch?.[1]) return null;
  const clean = stripHtml(flavorMatch[1]).trim();
  return clean || null;
}

function parseLinkedInText(text: string): ParsedAlertJob[] {
  const jobs: ParsedAlertJob[] = [];
  const seenUrls = new Set<string>();

  for (const section of text.split(/\r?\n\s*-{10,}\s*\r?\n/)) {
    const rawLines = section
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    const urlIdx = rawLines.findIndex((l) =>
      /^(?:view job:\s*)?<?https?:\/\/[^\s<>"]*linkedin\.com\/(?:comm\/)?jobs\/view\/[^\s<>"]*>?$/i.test(
        l,
      ),
    );
    if (urlIdx <= 0) continue;

    const urlMatch = (rawLines[urlIdx] ?? '').match(
      /https?:\/\/[^\s<>"]*linkedin\.com\/(?:comm\/)?jobs\/view\/[^\s<>"]*/i,
    );
    if (!urlMatch?.[0]) continue;

    const applyUrl = cleanTrackingUrl(urlMatch[0], 'linkedin');
    if (seenUrls.has(applyUrl)) continue;
    seenUrls.add(applyUrl);

    const cardLines = rawLines.slice(0, urlIdx);
    while (cardLines.length > 0 && LINKEDIN_HEADER_LINE_REGEX.test(cardLines[0] ?? '')) {
      cardLines.shift();
    }

    const title = cardLines[0] ?? '';
    if (!title) continue;

    let company = 'Unknown';
    let location: string | null = null;
    let salaryRaw: string | null = null;
    const notes: string[] = [];

    if (cardLines[1]) {
      if (cardLines[1].includes('·') || cardLines[1].includes('•')) {
        const split = splitMiddotCompanyLocation(cardLines[1]);
        if (split.company) company = split.company;
        if (split.location) location = split.location;
      } else if (isPlausibleCompanyCandidate(cardLines[1], title)) {
        company = cardLines[1];
      }
    }

    for (const extra of cardLines.slice(2)) {
      if (LINKEDIN_BADGE_REGEX.test(extra)) {
        notes.push(extra);
        continue;
      }
      if (!salaryRaw && /[₹$€£]/.test(extra) && /\d/.test(extra)) {
        salaryRaw = extra;
        continue;
      }
      if (!location) {
        location = extra;
      }
    }

    const baseDesc = `${title} at ${company}${location ? ` - ${location}` : ''}`;
    jobs.push({
      title,
      company,
      location,
      apply_url: applyUrl,
      salary_raw: salaryRaw,
      description: notes.length > 0 ? `${baseDesc} (${notes.join(', ')})` : baseDesc,
    });
  }

  return jobs;
}

export const linkedInParser: PortalParser = {
  portal: 'linkedin',

  matchesSender(fromAddress: string): boolean {
    const addr = fromAddress.toLowerCase().trim();
    return addr.includes('linkedin.com') || addr.includes('@linkedin.');
  },

  parse(html: string, text?: string): ParsedAlertJob[] {
    const textJobs = text ? parseLinkedInText(text) : [];
    const textByUrl = new Map(textJobs.map((j) => [j.apply_url, j]));

    const jobs: ParsedAlertJob[] = [];
    if (html) {
      // LinkedIn job alert links typically match /jobs/view/ or /comm/jobs/view/
      const linkRegex =
        /<a\b[^>]*href="([^"]*(?:linkedin\.com\/(?:comm\/)?jobs\/view\/|\/jobs\/view\/)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;

      let match: RegExpExecArray | null;
      const seenUrls = new Set<string>();

      while ((match = linkRegex.exec(html)) !== null) {
        const rawHref = match[1] ?? '';
        const rawTitle = match[2] ?? '';
        const cleanAnchorText = stripHtml(rawTitle);

        // Skip logo/empty anchors and non-job CTAs like "View job", "Apply now", "See more"
        if (
          !cleanAnchorText ||
          /^(view|see|apply|read|click|more|follow|check|unsubscribe|settings)/i.test(cleanAnchorText)
        ) {
          continue;
        }

        const applyUrl = cleanTrackingUrl(rawHref, 'linkedin');
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
          // Newer single-anchor cards wrap [Title, "Company · Location", Salary/Badge] inside <a>
          cleanTitle = lines[0];
          const split = splitMiddotCompanyLocation(lines[1]);
          if (split.company) company = split.company;
          if (split.location) location = split.location;
          for (const extra of lines.slice(2)) {
            if (LINKEDIN_BADGE_REGEX.test(extra)) continue;
            if (!salaryRaw && /[₹$€£]/.test(extra) && /\d/.test(extra)) {
              salaryRaw = extra;
            }
          }
        }

        // Outer digest anchors wrap nested <table>/<a href="...jobcard_body...">Title</a>,
        // so measure the context window AFTER match[0] and stop only at real card boundaries.
        const contentStart = match.index + match[0].length;
        const afterLink = html.slice(contentStart, contentStart + 3500);
        const nextCardBoundary = afterLink.search(
          /<table class="job-card"|data-test-id="job-card"|<a\b[^>]*href="[^"]*linkedin\.com\/(?:comm\/)?(?:jobs\/(?:view\/|search-results|alerts)|premium)|See all jobs/i,
        );
        const contextSnippet =
          nextCardBoundary !== -1 ? afterLink.slice(0, nextCardBoundary) : afterLink;

        if (company === 'Unknown') {
          const extractedCompany = extractCompanyFromCardSnippet(
            contextSnippet,
            cleanTitle,
            /(?:class="[^"]*(?:company|jobsearch-Company|org)[^"]*"[^>]*>|<strong[^>]*>|<span[^>]*class="[^"]*sub-title[^"]*"[^>]*>)([\s\S]*?)<\/(?:div|span|strong|p)>/i,
          );
          if (extractedCompany) {
            const split = splitMiddotCompanyLocation(extractedCompany);
            company = split.company ?? extractedCompany;
            if (!location && split.location) {
              location = split.location;
            }
          }
        }

        if (!location) {
          const locationMatch =
            contextSnippet.match(
              /(?:class="[^"]*(?:location|city|job-location)[^"]*"[^>]*>)([\s\S]*?)<\/(?:div|span|p)>/i,
            ) ||
            contextSnippet.match(
              /(?:\b[A-Z][a-zA-Z\s.-]+,\s*[A-Z]{2}\b(?:\s+\(Hybrid\)|\s+\(Remote\)|\s+\(On-site\))?|\bRemote\b|\bHybrid\b)/,
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
            /([$€£₹]\s*[\d,]+(?:\.\d+)?(?:\s*k)?(?:\s*[-–to/]\s*[$€£₹]?\s*[\d,]+(?:\.\d+)?(?:\s*k)?)?\s*(?:\/\s*(?:yr|year|mo|month|hr|hour)|\bper\s+(?:year|annum|month|hour)\b|\bannually\b|\ba\s+year\b))/i,
          );
          if (salaryMatch?.[1]) {
            salaryRaw = stripHtml(salaryMatch[1]).trim();
          }
        }

        const textFallback = textByUrl.get(applyUrl);
        if (company === 'Unknown' && textFallback?.company && textFallback.company !== 'Unknown') {
          company = textFallback.company;
        }
        if (!location && textFallback?.location) {
          location = textFallback.location;
        }
        if (!salaryRaw && textFallback?.salary_raw) {
          salaryRaw = textFallback.salary_raw;
        }

        const flavor = extractFlavorHighlight(contextSnippet);
        const baseDesc = `${cleanTitle} at ${company}${location ? ` - ${location}` : ''}`;
        jobs.push({
          title: cleanTitle,
          company,
          location,
          apply_url: applyUrl,
          salary_raw: salaryRaw,
          description: flavor ? `${baseDesc} (${flavor})` : baseDesc,
        });
      }
    }

    if (jobs.length === 0 && textJobs.length > 0) {
      return textJobs;
    }

    return jobs;
  },
};
