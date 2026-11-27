import type { PortalParser, ParsedAlertJob } from '../types.js';
import { cleanTrackingUrl } from '../tracking-cleaner.js';
import { stripHtml } from '../../sources/html-utils.js';
import { extractCompanyFromCardSnippet } from './shared.js';

const WELLFOUND_JOB_URL_REGEX = /(?:wellfound\.com\/(?:jobs|job_ads)\/|angel\.co\/jobs\/|\/jobs\/)/i;
const WELLFOUND_BOILERPLATE_REGEX =
  /^(?:promoted\s+)?(?:view|see|apply|read|click|more|unsubscribe|settings|manage|wellfound|angellist)\b/i;

function parseWellfoundPlainText(text: string): ParsedAlertJob[] {
  const jobs: ParsedAlertJob[] = [];
  if (!text) return jobs;

  // Wellfound plain-text multipart emails include unwrapped canonical URLs on lines like:
  //   Mobile App Development Intern
  //   <https://wellfound.com/jobs/5138133-...?email_uid=...&utm_campaign=...>
  const linkRegex = /(?:^|\n)([^\r\n]+)\r?\n\s*<(https?:\/\/(?:www\.)?(?:wellfound\.com|angel\.co)\/(?:jobs|job_ads)\/[^>\s]+)>/gi;

  const matches = Array.from(text.matchAll(linkRegex));
  const seenUrls = new Set<string>();

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    if (!m) continue;

    const rawTitle = (m[1] ?? '').trim();
    const rawUrl = (m[2] ?? '').trim();
    if (!rawTitle || WELLFOUND_BOILERPLATE_REGEX.test(rawTitle)) {
      continue;
    }

    const applyUrl = cleanTrackingUrl(rawUrl, 'wellfound');
    if (!applyUrl || seenUrls.has(applyUrl)) {
      continue;
    }
    seenUrls.add(applyUrl);

    const blockStart = (m.index ?? 0) + m[0].length;
    const nextMatchStart = matches[i + 1]?.index ?? text.length;
    const rawBlock = text.slice(blockStart, Math.min(nextMatchStart, blockStart + 1800));
    const endMarker = rawBlock.search(/\n\s*(?:Promoted\s+)?View job\s*\r?\n|\n\s*How often do you want to receive/i);
    const cardText = (endMarker !== -1 ? rawBlock.slice(0, endMarker) : rawBlock).trim();

    let company = 'Unknown';
    let location: string | null = null;
    let salaryRaw: string | null = null;
    let description: string | null = null;

    const takeIdx = cardText.search(/\bOur take\b/i);
    const metaSection = (takeIdx !== -1 ? cardText.slice(0, takeIdx) : cardText)
      .replace(/\s*\r?\n\s*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (takeIdx !== -1) {
      const takeBody = cardText
        .slice(takeIdx)
        .replace(/^\s*Our take\s+/i, '')
        .replace(/\s*\r?\n\s*/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (takeBody) {
        description = takeBody;
      }
    }

    const empMatch = metaSection.match(/^(.+?)\s+\/\s+\d[\d,-]*\+?\s+Employees\b\s*(.*)$/i);
    if (empMatch) {
      const candidateCompany = (empMatch[1] ?? '').trim();
      if (candidateCompany && candidateCompany !== rawTitle && candidateCompany.length < 100) {
        company = candidateCompany;
      }

      const trailing = (empMatch[2] ?? '').trim();
      // Trim trailing badge markers if present
      const beforeBadges = trailing.split(/\b(?:Actively Hiring|Growing fast|B2B|B2C)\b/i)[0] ?? trailing;
      const parts = beforeBadges
        .split('|')
        .map((p) => p.trim())
        .filter(Boolean);

      for (const part of parts) {
        if (/experience required|\byears?\s+of\s+exp\b|\bnew grad\b/i.test(part)) {
          continue;
        }
        if (
          !salaryRaw &&
          (/[$€£₹]\s*[\d,]/.test(part) || /\b(?:equity|salary|OTE)\b/i.test(part))
        ) {
          salaryRaw = part;
          continue;
        }
        if (!location && part.length < 100) {
          location = part;
        }
      }
    }

    jobs.push({
      title: rawTitle,
      company,
      location,
      apply_url: applyUrl,
      salary_raw: salaryRaw,
      description:
        description || `${rawTitle} at ${company}${location ? ` - ${location}` : ''}`,
    });
  }

  return jobs;
}

function parseWellfoundIterableHtmlCards(html: string): ParsedAlertJob[] {
  const jobs: ParsedAlertJob[] = [];
  if (!html.includes('links.wellfound.com/s/c/')) return jobs;

  const titleLinkRegex =
    /<a\b[^>]*style="[^"]*text-decoration:\s*underline[^"]*"[^>]*href="(https:\/\/links\.wellfound\.com\/s\/c\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

  let match: RegExpExecArray | null;
  const seenUrls = new Set<string>();

  while ((match = titleLinkRegex.exec(html)) !== null) {
    const rawHref = match[1] ?? '';
    const cleanTitle = stripHtml(match[2] ?? '').trim();
    if (!cleanTitle || WELLFOUND_BOILERPLATE_REGEX.test(cleanTitle)) {
      continue;
    }

    const applyUrl = cleanTrackingUrl(rawHref, 'wellfound');
    if (!applyUrl || seenUrls.has(applyUrl)) {
      continue;
    }
    seenUrls.add(applyUrl);

    const afterLink = html.slice(match.index + match[0].length, match.index + 3000);
    const nextCardIdx = afterLink.search(/>\s*View job\s*<\/a>/i);
    const cardSnippet = nextCardIdx !== -1 ? afterLink.slice(0, nextCardIdx) : afterLink;
    const cardPlain = stripHtml(cardSnippet)
      .replace(/\s*\r?\n\s*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    let company = 'Unknown';
    let location: string | null = null;
    let salaryRaw: string | null = null;
    let description: string | null = null;

    const takeIdx = cardPlain.search(/\bOur take\b/i);
    const metaText = takeIdx !== -1 ? cardPlain.slice(0, takeIdx) : cardPlain;
    if (takeIdx !== -1) {
      const desc = cardPlain
        .slice(takeIdx)
        .replace(/^\s*Our take\s+/i, '')
        .replace(/\bPromoted\s*$/i, '')
        .trim();
      if (desc) description = desc;
    }

    const empMatch = metaText.match(/^(.+?)\s+\/\s+\d[\d,-]*\+?\s+Employees\b\s*(.*)$/i);
    if (empMatch) {
      const candidate = (empMatch[1] ?? '').trim();
      if (candidate && candidate !== cleanTitle && candidate.length < 100) {
        company = candidate;
      }
      const trailing = (empMatch[2] ?? '').split(/\b(?:Actively Hiring|Growing fast|B2B|B2C)\b/i)[0] ?? '';
      const parts = trailing
        .split('|')
        .map((p) => p.trim())
        .filter(Boolean);
      for (const part of parts) {
        if (/experience required|\byears?\s+of\s+exp\b|\bnew grad\b/i.test(part)) continue;
        if (!salaryRaw && (/[$€£₹]\s*[\d,]/.test(part) || /\bequity\b/i.test(part))) {
          salaryRaw = part;
        } else if (!location && part.length < 100) {
          location = part;
        }
      }
    }

    jobs.push({
      title: cleanTitle,
      company,
      location,
      apply_url: applyUrl,
      salary_raw: salaryRaw,
      description:
        description || `${cleanTitle} at ${company}${location ? ` - ${location}` : ''}`,
    });
  }

  return jobs;
}

export const wellfoundParser: PortalParser = {
  portal: 'wellfound',

  matchesSender(fromAddress: string): boolean {
    const addr = fromAddress.toLowerCase().trim();
    return addr.includes('wellfound.com') || addr.includes('angel.co');
  },

  parse(html: string, text?: string): ParsedAlertJob[] {
    // 1. Prefer un-obfuscated canonical job URLs from multipart plain-text when available
    //    (Iterable HTML wraps all job links in opaque links.wellfound.com/s/c/ tokens).
    if (text) {
      const plainJobs = parseWellfoundPlainText(text);
      if (plainJobs.length > 0) {
        return plainJobs;
      }
    }

    const jobs: ParsedAlertJob[] = [];
    if (!html) return jobs;

    const linkRegex = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

    let match: RegExpExecArray | null;
    const seenUrls = new Set<string>();

    while ((match = linkRegex.exec(html)) !== null) {
      const rawHref = match[1] ?? '';
      const applyUrl = cleanTrackingUrl(rawHref, 'wellfound');
      if (!WELLFOUND_JOB_URL_REGEX.test(applyUrl)) {
        continue;
      }

      const rawTitle = match[2] ?? '';
      const cleanTitle = stripHtml(rawTitle);

      if (!cleanTitle || WELLFOUND_BOILERPLATE_REGEX.test(cleanTitle)) {
        continue;
      }

      if (seenUrls.has(applyUrl)) {
        continue;
      }
      seenUrls.add(applyUrl);

      const afterLink = html.slice(match.index + match[0].length, match.index + 800);
      const nextCardBoundary = afterLink.search(
        /<table class="job-card"|<table|<tr|<a\b[^>]*href="[^"]*(?:wellfound|angel)/i,
      );
      const contextSnippet =
        nextCardBoundary !== -1 ? afterLink.slice(0, nextCardBoundary) : afterLink;

      let company = 'Unknown';
      const extractedCompany = extractCompanyFromCardSnippet(
        contextSnippet,
        cleanTitle,
        /(?:class="[^"]*(?:company|startup-name|org)[^"]*"[^>]*>|<strong[^>]*>|<span[^>]*class="[^"]*company[^"]*"[^>]*>)([\s\S]*?)<\/(?:div|span|strong|p|a)>/i,
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
        /([$€£₹]\s*[\d,]+(?:\.\d+)?(?:\s*k)?(?:\s*[-–to/]\s*[$€£₹]?\s*[\d,]+(?:\.\d+)?(?:\s*k)?)?\s*(?:•|\/|\bper\b|\ba\s+year\b)?\s*(?:[\d.]+%?\s*equity)?)/i,
      );
      if (salaryMatch?.[1]) {
        const candidate = stripHtml(salaryMatch[1]).trim();
        if (candidate && /[$€£₹\d]/.test(candidate)) {
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

    if (jobs.length === 0) {
      const iterableHtmlJobs = parseWellfoundIterableHtmlCards(html);
      if (iterableHtmlJobs.length > 0) {
        return iterableHtmlJobs;
      }
    }

    if (jobs.length === 0 && !html.includes('<')) {
      return parseWellfoundPlainText(html);
    }

    return jobs;
  },
};
