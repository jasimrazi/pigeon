import type { PortalParser, ParsedAlertJob } from '../types.js';
import { cleanTrackingUrl } from '../tracking-cleaner.js';
import { stripHtml } from '../../sources/html-utils.js';
import { extractCompanyFromCardSnippet, isPlausibleCompanyCandidate } from './shared.js';

const INDEED_URL_PATTERN =
  /indeed\.com\/(?:viewjob|rc\/clk|job\/)|\/viewjob/i;

const INDEED_BADGE_OR_AGE_REGEX =
  /^(?:easily apply|easy apply|responsive employer|urgently hiring|actively hiring|hiring multiple candidates|multiple candidates|just posted|today|posted\s+.*|active\s+\d+.*|\d+\+?\s*(?:day|days|hour|hours|week|weeks|month|months)\s+ago|do not share.*|\d+(?:\.\d+)?(?:\s*★)?)$/i;

const INDEED_SALARY_REGEX =
  /((?:(?:From|Up\s+to)\s+)?[$€£₹]\s*[\d,]+(?:\.\d+)?(?:\s*(?:-|–|to|\/)\s*[$€£₹]?\s*[\d,]+(?:\.\d+)?)?\s*(?:\/\s*(?:yr|year|mo|month|hr|hour)|\b(?:a\s+year|an\s+hour|a\s+month|per\s+year|per\s+month)\b))/i;

const INDEED_LINE_SALARY_REGEX =
  /^(?:(?:From|Up\s+to)\s+)?[$€£₹]\s*[\d,]+(?:\.\d+)?(?:\s*(?:-|–|to|\/)\s*[$€£₹]?\s*[\d,]+(?:\.\d+)?)?(?:\s*(?:\/\s*(?:yr|year|mo|month|hr|hour)|\b(?:a\s+year|an\s+hour|a\s+month|per\s+year|per\s+month)\b))?$/i;

function extractLocationFromCardTags(
  contextSnippet: string,
  cleanTitle: string,
  company: string,
  salaryRaw: string | null,
): string | null {
  const tagRegex = /<(?:p|span|div|td)[^>]*>([^<]+)<\/(?:p|span|div|td)>/gi;
  let seenCompany = company === 'Unknown';
  let tagMatch: RegExpExecArray | null;

  while ((tagMatch = tagRegex.exec(contextSnippet)) !== null) {
    const candidate = stripHtml(tagMatch[1] ?? '').trim();
    if (!candidate || candidate === cleanTitle) continue;

    if (!seenCompany) {
      if (candidate === company) {
        seenCompany = true;
      }
      continue;
    }

    if (
      INDEED_BADGE_OR_AGE_REGEX.test(candidate) ||
      INDEED_LINE_SALARY_REGEX.test(candidate) ||
      (salaryRaw && candidate === salaryRaw)
    ) {
      // In Indeed cards, location always appears immediately after company and before salary/badges.
      break;
    }

    if (candidate.length <= 80) {
      return candidate;
    }
  }

  return null;
}

function extractIndeedCardFields(
  contextSnippet: string,
  cleanTitle: string,
  initialCompany: string,
): { company: string; location: string | null; salaryRaw: string | null } {
  let company = initialCompany;
  if (company === 'Unknown') {
    const extractedCompany = extractCompanyFromCardSnippet(
      contextSnippet,
      cleanTitle,
      /(?:class="[^"]*(?:company|companyName|jobsearch-Company)[^"]*"[^>]*>|<span[^>]*class="[^"]*company_location[^"]*"[^>]*>)([\s\S]*?)<\/(?:div|span|p|a)>/i,
    );
    if (extractedCompany) {
      company = extractedCompany;
    }
  }

  let salaryRaw: string | null = null;
  const salaryMatch =
    contextSnippet.match(
      /(?:class="[^"]*(?:salary|salary-snippet)[^"]*"[^>]*>)([\s\S]*?)<\/(?:div|span|p)>/i,
    ) || contextSnippet.match(INDEED_SALARY_REGEX);

  if (salaryMatch?.[1]) {
    salaryRaw = stripHtml(salaryMatch[1]).trim();
  }

  let location: string | null = null;
  const explicitLocMatch = contextSnippet.match(
    /(?:class="[^"]*(?:location|companyLocation|job-location)[^"]*"[^>]*>)([\s\S]*?)<\/(?:div|span|p)>/i,
  );
  if (explicitLocMatch?.[1]) {
    const cleanLoc = stripHtml(explicitLocMatch[1]).trim();
    if (cleanLoc && cleanLoc !== cleanTitle && cleanLoc !== company) {
      location = cleanLoc;
    }
  }

  if (!location) {
    location = extractLocationFromCardTags(contextSnippet, cleanTitle, company, salaryRaw);
  }

  if (!location) {
    const fallbackLocMatch = contextSnippet.match(
      /(?:\b[A-Z][a-zA-Z\s.-]+,\s*[A-Z]{2}\b(?:\s+\d{5})?|\bRemote\b|\bHybrid\b)/,
    );
    if (fallbackLocMatch?.[0]) {
      const cleanLoc = stripHtml(fallbackLocMatch[0]).trim();
      if (cleanLoc && cleanLoc !== cleanTitle && cleanLoc !== company) {
        location = cleanLoc;
      }
    }
  }

  return { company, location, salaryRaw };
}

function parseIndeedText(text: string): {
  jobs: ParsedAlertJob[];
  enrichedDescriptions: Set<string>;
} {
  const jobs: ParsedAlertJob[] = [];
  const enrichedDescriptions = new Set<string>();
  const seenUrls = new Set<string>();

  for (const block of text.split(/\r?\n\s*\r?\n/)) {
    const lines = block
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length < 2) continue;

    const urlIdx = lines.findIndex((l) =>
      /^<?https?:\/\/[^\s<>"]*indeed\.com\/(?:viewjob|rc\/clk|job\/)[^\s<>"]*>?$/i.test(l),
    );
    if (urlIdx <= 0) continue;

    const rawUrl = (lines[urlIdx] ?? '').replace(/^<|>$/g, '');
    const applyUrl = cleanTrackingUrl(rawUrl, 'indeed');
    if (seenUrls.has(applyUrl)) continue;
    seenUrls.add(applyUrl);

    const title = lines[0] ?? '';
    if (
      !title ||
      /^(?:indeed job alert|jobs?\s+\d+|see matching|view all|do not share)/i.test(title)
    ) {
      continue;
    }

    let company = 'Unknown';
    let location: string | null = null;
    let bodyStartIdx = 1;

    const secondLine = lines[1];
    if (
      urlIdx > 1 &&
      secondLine &&
      !INDEED_BADGE_OR_AGE_REGEX.test(secondLine) &&
      !INDEED_LINE_SALARY_REGEX.test(secondLine)
    ) {
      const sepIdx = secondLine.lastIndexOf(' - ');
      if (sepIdx > 0) {
        const candCompany = secondLine.slice(0, sepIdx).trim();
        const candLoc = secondLine.slice(sepIdx + 3).trim();
        if (candCompany) company = candCompany;
        if (candLoc) location = candLoc;
        bodyStartIdx = 2;
      } else if (isPlausibleCompanyCandidate(secondLine, title) && !secondLine.endsWith('.')) {
        company = secondLine;
        bodyStartIdx = 2;
      }
    }

    let salaryRaw: string | null = null;
    const descLines: string[] = [];

    for (let i = bodyStartIdx; i < urlIdx; i++) {
      const line = lines[i] ?? '';
      if (!line) continue;
      if (!salaryRaw && INDEED_LINE_SALARY_REGEX.test(line)) {
        salaryRaw = line;
        continue;
      }
      if (INDEED_BADGE_OR_AGE_REGEX.test(line)) {
        continue;
      }
      descLines.push(line);
    }

    const fallbackDesc = `${title} at ${company}${location ? ` - ${location}` : ''}`;
    const hasSnippet = descLines.length > 0;
    if (hasSnippet) {
      enrichedDescriptions.add(applyUrl);
    }

    jobs.push({
      title,
      company,
      location,
      apply_url: applyUrl,
      salary_raw: salaryRaw,
      description: hasSnippet ? descLines.join(' ') : fallbackDesc,
    });
  }

  return { jobs, enrichedDescriptions };
}

export const indeedParser: PortalParser = {
  portal: 'indeed',

  matchesSender(fromAddress: string): boolean {
    const addr = fromAddress.toLowerCase().trim();
    return addr.includes('indeed.com') || addr.includes('@indeed.');
  },

  parse(html: string, text?: string): ParsedAlertJob[] {
    const textParsed = text ? parseIndeedText(text) : null;
    const textByUrl = new Map(textParsed?.jobs.map((j) => [j.apply_url, j]) ?? []);

    const jobs: ParsedAlertJob[] = [];
    if (html) {
      const linkRegex =
        /<a\b[^>]*href="([^"]*(?:indeed\.com\/(?:viewjob|rc\/clk|job\/)[^"]*|\/viewjob[^"]*))"[^>]*>([\s\S]*?)<\/a>/gi;

      let match: RegExpExecArray | null;
      const seenUrls = new Set<string>();

      while ((match = linkRegex.exec(html)) !== null) {
        const rawHref = match[1] ?? '';
        const rawTitle = match[2] ?? '';
        const cleanAnchorText = stripHtml(rawTitle);

        if (
          !cleanAnchorText ||
          /^(view|see|apply|read|click|more|unsubscribe|indeed|manage|privacy)/i.test(
            cleanAnchorText,
          )
        ) {
          continue;
        }

        const applyUrl = cleanTrackingUrl(rawHref, 'indeed');
        if (seenUrls.has(applyUrl)) {
          continue;
        }
        seenUrls.add(applyUrl);

        const lines = cleanAnchorText
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);

        let cleanTitle = cleanAnchorText;
        let initialCompany = 'Unknown';
        if (lines.length >= 2 && lines[0] && lines[1]) {
          cleanTitle = lines[0];
          if (isPlausibleCompanyCandidate(lines[1], cleanTitle)) {
            initialCompany = lines[1];
          }
        }

        // Indeed tracking URLs inside href can consume 500+ chars, so measure window after match[0].
        const contentStart = match.index + match[0].length;
        const afterLink = html.slice(contentStart, contentStart + 2500);
        const nextCardBoundary = afterLink.search(
          new RegExp(
            `<div class="job-result"|<div class="job"|<a\\b[^>]*href="[^"]*(?:${INDEED_URL_PATTERN.source})|>View all jobs<|Do not share this email`,
            'i',
          ),
        );
        const contextSnippet =
          nextCardBoundary !== -1 ? afterLink.slice(0, nextCardBoundary) : afterLink;

        const extracted = extractIndeedCardFields(contextSnippet, cleanTitle, initialCompany);
        const textJob = textByUrl.get(applyUrl);

        const company =
          extracted.company !== 'Unknown' ? extracted.company : (textJob?.company ?? 'Unknown');
        const location = extracted.location ?? textJob?.location ?? null;
        const salaryRaw = extracted.salaryRaw ?? textJob?.salary_raw ?? null;
        const description =
          textJob && textParsed?.enrichedDescriptions.has(applyUrl)
            ? textJob.description
            : `${cleanTitle} at ${company}${location ? ` - ${location}` : ''}`;

        jobs.push({
          title: cleanTitle,
          company,
          location,
          apply_url: applyUrl,
          salary_raw: salaryRaw,
          description,
        });
      }
    }

    if (jobs.length === 0 && textParsed && textParsed.jobs.length > 0) {
      return textParsed.jobs;
    }

    return jobs;
  },
};
