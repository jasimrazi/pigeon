import type { PortalParser, ParsedAlertJob } from '../types.js';
import { cleanTrackingUrl } from '../tracking-cleaner.js';
import { stripHtml } from '../../sources/html-utils.js';
import { extractCompanyFromCardSnippet } from './shared.js';

const INSTAHYRE_JOB_URL_REGEX = /(?:instahyre\.com\/job-[^/\s?]+|\/job-[^/\s?]+)/i;
const INSTAHYRE_BOILERPLATE_REGEX =
  /^(view|see|apply|read|click|more|unsubscribe|settings|manage|instahyre)/i;

function extractMjmlCardFields(cardHtml: string): {
  title: string;
  company: string;
  location: string | null;
  salaryRaw: string | null;
  description: string | null;
} | null {
  const nameStart = cardHtml.search(/class="[^"]*name-container[^"]*"/i);
  if (nameStart === -1) return null;

  const afterName = cardHtml.slice(nameStart);
  const nameEnd = afterName.search(/class="[^"]*(?:hide-on-mobile|apply-btn|note-long)[^"]*"/i);
  const nameBlock = nameEnd !== -1 ? afterName.slice(0, nameEnd) : afterName.slice(0, 1500);

  const firstTrMatch = nameBlock.match(/<tr\b[^>]*>([\s\S]*?)<\/tr>/i);
  const titleRow = firstTrMatch?.[1] ?? '';
  const afterTitle =
    firstTrMatch && firstTrMatch.index !== undefined
      ? nameBlock.slice(firstTrMatch.index + firstTrMatch[0].length)
      : nameBlock;

  const title = stripHtml(titleRow).trim();
  if (!title || INSTAHYRE_BOILERPLATE_REGEX.test(title)) {
    return null;
  }

  let company = 'Unknown';
  const companySpan = afterTitle.match(/<span\b[^>]*>([\s\S]*?)<\/span>/i);
  if (companySpan?.[1]) {
    const candidate = stripHtml(companySpan[1]).trim();
    if (candidate && candidate !== title && candidate.length < 100) {
      company = candidate;
    }
  }

  let location: string | null = null;
  const chipMatch = afterTitle.match(/<table\b[^>]*chip[^>]*>([\s\S]*?)<\/table>/i);
  if (chipMatch?.[1]) {
    const loc = stripHtml(chipMatch[1]).trim();
    if (loc && loc !== title && loc !== company) {
      location = loc;
    }
  }

  const noteMatch = cardHtml.match(/<div\b[^>]*class="[^"]*note-long[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  const noteText = noteMatch?.[1] ? stripHtml(noteMatch[1]).trim() : '';

  const skillsMatch = cardHtml.match(
    /<div\b[^>]*class="[^"]*skills-box[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
  );
  const skillsText = skillsMatch?.[1]
    ? Array.from(skillsMatch[1].matchAll(/<span\b[^>]*>([\s\S]*?)<\/span>/gi))
        .map((m) => stripHtml(m[1] ?? '').trim())
        .filter(Boolean)
        .join(', ')
    : '';

  let description: string | null = null;
  if (noteText && skillsText) {
    description = `${noteText} (Skills: ${skillsText})`;
  } else if (noteText) {
    description = noteText;
  } else if (skillsText) {
    description = `Skills: ${skillsText}`;
  }

  let salaryRaw: string | null = null;
  const salaryMatch = cardHtml.match(
    /([₹$€£]\s*[\d,]+(?:\.\d+)?(?:\s*[-–to/]\s*[₹$€£]?\s*[\d,]+(?:\.\d+)?)?\s*(?:LPA|Lacs|Lakhs?|k|\/\s*(?:yr|year)|\bper\s+annum\b|\ba\s+year\b))/i,
  );
  if (salaryMatch?.[1]) {
    salaryRaw = stripHtml(salaryMatch[1]).trim();
  }

  return { title, company, location, salaryRaw, description };
}

export const instahyreParser: PortalParser = {
  portal: 'instahyre',

  matchesSender(fromAddress: string): boolean {
    const addr = fromAddress.toLowerCase().trim();
    return addr.includes('instahyre.com') || addr.includes('@instahyre.');
  },

  parse(html: string): ParsedAlertJob[] {
    const jobs: ParsedAlertJob[] = [];
    if (!html) return jobs;

    // Match opening <a> tags so we can unwrap SES click-tracking URLs and inspect MJML cards
    // even when an outer card anchor wraps an inner "Apply here" anchor.
    const anchorOpenRegex = /<a\b([^>]*\bhref=(?:"([^"]*)"|'([^']*)')[^>]*)>/gi;

    let match: RegExpExecArray | null;
    const seenUrls = new Set<string>();

    while ((match = anchorOpenRegex.exec(html)) !== null) {
      const attrs = match[1] ?? '';
      const rawHref = match[2] ?? match[3] ?? '';
      const applyUrl = cleanTrackingUrl(rawHref, 'instahyre');

      if (!applyUrl || !INSTAHYRE_JOB_URL_REGEX.test(applyUrl) || seenUrls.has(applyUrl)) {
        continue;
      }

      const contentStart = match.index + match[0].length;
      const isCardWrapper = /class\s*=\s*["'][^"']*mobile-card-link/i.test(attrs);
      const restHtml = html.slice(contentStart, contentStart + 10000);

      if (isCardWrapper || restHtml.slice(0, 2500).includes('name-container')) {
        const nextCardRel = restHtml.search(
          /<a\b[^>]*class\s*=\s*["'][^"']*mobile-card-link|The Instahyre Team/i,
        );
        const cardHtml = nextCardRel !== -1 ? restHtml.slice(0, nextCardRel) : restHtml;
        const cardFields = extractMjmlCardFields(cardHtml);
        if (cardFields) {
          seenUrls.add(applyUrl);
          jobs.push({
            title: cardFields.title,
            company: cardFields.company,
            location: cardFields.location,
            apply_url: applyUrl,
            salary_raw: cardFields.salaryRaw,
            description:
              cardFields.description ||
              `${cardFields.title} at ${cardFields.company}${cardFields.location ? ` - ${cardFields.location}` : ''}`,
          });
          continue;
        }
      }

      const closeIdx = restHtml.search(/<\/a>/i);
      const rawTitle = closeIdx !== -1 ? restHtml.slice(0, closeIdx) : '';
      const cleanTitle = stripHtml(rawTitle);

      if (!cleanTitle || INSTAHYRE_BOILERPLATE_REGEX.test(cleanTitle)) {
        continue;
      }

      seenUrls.add(applyUrl);

      const snippetStart = closeIdx !== -1 ? contentStart + closeIdx + 4 : contentStart;
      const afterLink = html.slice(snippetStart, snippetStart + 800);
      const nextCardBoundary = afterLink.search(
        /<div class="job"|<table|<tr|<a\b[^>]*href="[^"]*(?:instahyre\.com|click\d*\.instahyre\.com)/i,
      );
      const contextSnippet =
        nextCardBoundary !== -1 ? afterLink.slice(0, nextCardBoundary) : afterLink;

      let company = 'Unknown';
      const extractedCompany = extractCompanyFromCardSnippet(
        contextSnippet,
        cleanTitle,
        /(?:class="[^"]*(?:company|employer|employer-name)[^"]*"[^>]*>|<strong[^>]*>|<span[^>]*class="[^"]*company[^"]*"[^>]*>)([\s\S]*?)<\/(?:div|span|strong|p|a)>/i,
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
          /(?:[A-Z][a-zA-Z\s.-]+,\s*[A-Z]{2}(?:\s+\(Hybrid\)|\s+\(Remote\))?|\bRemote\b|\bHybrid\b|Bangalore|Bengaluru|Mumbai|Delhi|Hyderabad|Pune|Noida|Gurgaon|Chennai|Faridabad|Work From Home)/i,
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
        description: `${cleanTitle} at ${company}${location ? ` - ${location}` : ''}`,
      });
    }

    return jobs;
  },
};
