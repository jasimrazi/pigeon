import type { PortalParser, PortalType, ParsedAlertJob } from '../types.js';
import { linkedInParser } from './linkedin.js';
import { naukriParser } from './naukri.js';
import { indeedParser } from './indeed.js';
import { fallbackParser } from './fallback.js';

export const PORTAL_PARSERS: PortalParser[] = [linkedInParser, naukriParser, indeedParser];

export function detectPortal(fromAddress: string): PortalType {
  const addr = (fromAddress || '').toLowerCase().trim();
  for (const parser of PORTAL_PARSERS) {
    if (parser.matchesSender(addr)) {
      return parser.portal;
    }
  }
  return 'fallback';
}

export function getParser(portal: PortalType): PortalParser {
  switch (portal) {
    case 'linkedin':
      return linkedInParser;
    case 'naukri':
      return naukriParser;
    case 'indeed':
      return indeedParser;
    case 'fallback':
    default:
      return fallbackParser;
  }
}

export function parseAlertEmail(portal: PortalType, html: string): ParsedAlertJob[] {
  const parser = getParser(portal);
  const jobs = parser.parse(html);
  // If a portal-specific parser found 0 jobs, we can check if fallback finds anything,
  // or return jobs as is to detect empty digests
  return jobs;
}
