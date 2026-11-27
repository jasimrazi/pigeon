import type { PortalParser, ParsedAlertJob } from '../types.js';
import { cleanTrackingUrl } from '../tracking-cleaner.js';
import { stripHtml } from '../../sources/html-utils.js';
import { extractCompanyFromCardSnippet } from './shared.js';

const DICE_BOILERPLATE_REGEX = /^(view|see|apply|read|click|more|unsubscribe|settings|manage|dice|log in)\b/i;

function parseDicePlainText(text: string): ParsedAlertJob[] {
  const jobs: ParsedAlertJob[] = [];
  if (!text) return jobs;

  const linkRegex =
    /(?:^|\n)([^\r\n]+)\r?\n\s*<(https?:\/\/(?:www\.)?dice\.com\/(?:job-detail|jobs\/detail)\/[^>\s]+)>/gi;

  const matches = Array.from(text.matchAll(linkRegex));
  const seenUrls = new Set<string>();

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    if (!m) continue;

    const rawTitle = (m[1] ?? '').trim();
    const rawUrl = (m[2] ?? '').trim();
    if (!rawTitle || DICE_BOILERPLATE_REGEX.test(rawTitle)) {
      continue;
    }

    const applyUrl = cleanTrackingUrl(rawUrl, 'dice');
    if (!applyUrl || seenUrls.has(applyUrl)) {
      continue;
    }
    seenUrls.add(applyUrl);

    const blockStart = (m.index ?? 0) + m[0].length;
    const nextMatchStart = matches[i + 1]?.index ?? text.length;
    const rawBlock = text.slice(blockStart, Math.min(nextMatchStart, blockStart + 1000));
    const endIdx = rawBlock.search(
      /\n\s*Posted:|\n\s*<https?:\/\/(?:www\.)?dice\.com\/company\/|\n\s*Manage your daily job alert/i,
    );
    const cardLines = (endIdx !== -1 ? rawBlock.slice(0, endIdx) : rawBlock)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => Boolean(l) && !/^<https?:\/\//i.test(l));

    let company = 'Unknown';
    let location: string | null = null;
    let salaryRaw: string | null = null;

    if (cardLines[0] && cardLines[0] !== rawTitle && cardLines[0].length < 100) {
      company = cardLines[0];
    }
    for (const extra of cardLines.slice(1)) {
      if (
        !salaryRaw &&
        /[$€£]\s*[\d,]+(?:\s*\/\s*(?:yr|year|hr|hour)|\bper\s+(?:year|hour)\b|\ba\s+year\b)/i.test(
          extra,
        )
      ) {
        salaryRaw = extra;
      } else if (!location && extra.length < 100 && !/^posted:/i.test(extra)) {
        location = extra;
      }
    }

    jobs.push({
      title: rawTitle,
      company,
      location,
      apply_url: applyUrl,
      salary_raw: salaryRaw,
      description: `${rawTitle} at ${company}${location ? ` - ${location}` : ''}`,
    });
  }

  return jobs;
}

function parseDiceIterableHtmlCards(html: string): ParsedAlertJob[] {
  const jobs: ParsedAlertJob[] = [];
  if (!html.includes('elinks.dice.com/a/sc/')) return jobs;

  const titleLinkRegex =
    /<span\b[^>]*color:\s*#236fa1[^>]*>\s*<a\b[^>]*href="(https:\/\/elinks\.dice\.com\/a\/sc\/[^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/span>/gi;

  let match: RegExpExecArray | null;
  const seenUrls = new Set<string>();

  while ((match = titleLinkRegex.exec(html)) !== null) {
    const rawHref = match[1] ?? '';
    const cleanTitle = stripHtml(match[2] ?? '').trim();
    if (!cleanTitle || DICE_BOILERPLATE_REGEX.test(cleanTitle)) {
      continue;
    }

    const applyUrl = cleanTrackingUrl(rawHref, 'dice');
    if (!applyUrl || seenUrls.has(applyUrl)) {
      continue;
    }
    seenUrls.add(applyUrl);

    const afterLink = html.slice(match.index + match[0].length, match.index + match[0].length + 2000);
    const nextCardIdx = afterLink.search(/\bPosted:\s*\d|Manage your daily job alert/i);
    const cardSnippet = nextCardIdx !== -1 ? afterLink.slice(0, nextCardIdx) : afterLink;

    let company = 'Unknown';
    const companyMatch = cardSnippet.match(/<strong\b[^>]*>([\s\S]*?)<\/strong>/i);
    if (companyMatch?.[1]) {
      const candidate = stripHtml(companyMatch[1]).trim();
      if (candidate && candidate !== cleanTitle && candidate.length < 100) {
        company = candidate;
      }
    }

    let location: string | null = null;
    if (companyMatch?.index !== undefined) {
      const afterCompany = cardSnippet.slice(companyMatch.index + companyMatch[0].length);
      const locMatch = afterCompany.match(/<span\b[^>]*>([^<]+)<\/span>/i);
      if (locMatch?.[1]) {
        const candidateLoc = stripHtml(locMatch[1]).trim();
        if (candidateLoc && candidateLoc !== cleanTitle && candidateLoc !== company) {
          location = candidateLoc;
        }
      }
    }

    jobs.push({
      title: cleanTitle,
      company,
      location,
      apply_url: applyUrl,
      salary_raw: null,
      description: `${cleanTitle} at ${company}${location ? ` - ${location}` : ''}`,
    });
  }

  return jobs;
}

export const diceParser: PortalParser = {
  portal: 'dice',

  matchesSender(fromAddress: string): boolean {
    const addr = fromAddress.toLowerCase().trim();
    return addr.includes('dice.com') || addr.includes('@dice.');
  },

  parse(html: string, text?: string): ParsedAlertJob[] {
    // 1. Prefer unwrapped canonical dice.com/job-detail/ URLs from multipart plain-text when present
    //    (Iterable HTML wraps links in opaque elinks.dice.com/a/sc/... tokens).
    if (text) {
      const plainJobs = parseDicePlainText(text);
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
      const applyUrl = cleanTrackingUrl(rawHref, 'dice');
      if (!/dice\.com\/(?:job-detail|jobs\/detail)\//i.test(applyUrl)) {
        continue;
      }

      const rawTitle = match[2] ?? '';
      const cleanTitle = stripHtml(rawTitle);

      if (!cleanTitle || DICE_BOILERPLATE_REGEX.test(cleanTitle)) {
        continue;
      }

      if (seenUrls.has(applyUrl)) {
        continue;
      }
      seenUrls.add(applyUrl);

      const afterLink = html.slice(match.index + match[0].length, match.index + 800);
      const nextCardBoundary = afterLink.search(
        /<div class="job"|<table|<tr|<a\b[^>]*href="[^"]*dice\.com/i,
      );
      const contextSnippet =
        nextCardBoundary !== -1 ? afterLink.slice(0, nextCardBoundary) : afterLink;

      let company = 'Unknown';
      const extractedCompany = extractCompanyFromCardSnippet(
        contextSnippet,
        cleanTitle,
        /(?:class="[^"]*(?:company|employer|compName)[^"]*"[^>]*>|<strong[^>]*>|<span[^>]*class="[^"]*company[^"]*"[^>]*>)([\s\S]*?)<\/(?:div|span|strong|p|a)>/i,
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
        /([$€£]\s*[\d,]+(?:\.\d+)?(?:\s*k)?(?:\s*[-–to/]\s*[$€£]?\s*[\d,]+(?:\.\d+)?(?:\s*k)?)?\s*(?:\/\s*(?:yr|year|hr|hour)|\bper\s+(?:year|hour)\b|\ba\s+year\b))/i,
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

    if (jobs.length === 0) {
      const iterableHtmlJobs = parseDiceIterableHtmlCards(html);
      if (iterableHtmlJobs.length > 0) {
        return iterableHtmlJobs;
      }
    }

    if (jobs.length === 0 && !html.includes('<')) {
      return parseDicePlainText(html);
    }

    return jobs;
  },
};
