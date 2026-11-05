import type { PortalParser, ParsedAlertJob } from '../types.js';
import { cleanTrackingUrl } from '../tracking-cleaner.js';
import { stripHtml } from '../../sources/html-utils.js';

export const fallbackParser: PortalParser = {
  portal: 'fallback',

  matchesSender(): boolean {
    return true; // Match anything if portal-specific matchers fail
  },

  parse(html: string): ParsedAlertJob[] {
    const jobs: ParsedAlertJob[] = [];
    if (!html) return jobs;

    const linkRegex = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

    let match: RegExpExecArray | null;
    const seenUrls = new Set<string>();

    while ((match = linkRegex.exec(html)) !== null) {
      const rawHref = match[1] ?? '';
      const rawTitle = match[2] ?? '';
      const cleanTitle = stripHtml(rawTitle);

      // Only consider links with plausible titles and URLs
      if (
        !cleanTitle ||
        cleanTitle.length < 3 ||
        /^(view|see|apply|read|click|more|unsubscribe|login|privacy|terms|help|preferences)/i.test(
          cleanTitle,
        )
      ) {
        continue;
      }

      if (!rawHref.startsWith('http://') && !rawHref.startsWith('https://')) {
        continue;
      }

      const applyUrl = cleanTrackingUrl(rawHref);
      if (seenUrls.has(applyUrl)) {
        continue;
      }
      seenUrls.add(applyUrl);

      jobs.push({
        title: cleanTitle,
        company: 'Unknown',
        location: null,
        apply_url: applyUrl,
        salary_raw: null,
        description: cleanTitle,
      });
    }

    return jobs;
  },
};
