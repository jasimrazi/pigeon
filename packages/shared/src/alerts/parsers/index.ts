import type { PortalParser, PortalType, ParsedAlertJob } from '../types.js';
import { linkedInParser } from './linkedin.js';
import { naukriParser } from './naukri.js';
import { indeedParser } from './indeed.js';
import { wellfoundParser } from './wellfound.js';
import { ottaParser } from './otta.js';
import { zipRecruiterParser } from './ziprecruiter.js';
import { diceParser } from './dice.js';
import { glassdoorParser } from './glassdoor.js';
import { instahyreParser } from './instahyre.js';
import { founditParser } from './foundit.js';
import { whatjobsParser } from './whatjobs.js';
import { bebeeParser } from './bebee.js';
import { ambitionboxParser } from './ambitionbox.js';
import { cutshortParser } from './cutshort.js';
import { fallbackParser } from './fallback.js';

export {
  linkedInParser,
  naukriParser,
  indeedParser,
  wellfoundParser,
  ottaParser,
  zipRecruiterParser,
  diceParser,
  glassdoorParser,
  instahyreParser,
  founditParser,
  whatjobsParser,
  bebeeParser,
  ambitionboxParser,
  cutshortParser,
  fallbackParser,
};

export const PORTAL_PARSERS: PortalParser[] = [
  linkedInParser,
  naukriParser,
  indeedParser,
  wellfoundParser,
  ottaParser,
  zipRecruiterParser,
  diceParser,
  glassdoorParser,
  instahyreParser,
  founditParser,
  whatjobsParser,
  bebeeParser,
  ambitionboxParser,
  cutshortParser,
];

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
    case 'wellfound':
      return wellfoundParser;
    case 'otta':
      return ottaParser;
    case 'ziprecruiter':
      return zipRecruiterParser;
    case 'dice':
      return diceParser;
    case 'glassdoor':
      return glassdoorParser;
    case 'instahyre':
      return instahyreParser;
    case 'foundit':
      return founditParser;
    case 'whatjobs':
      return whatjobsParser;
    case 'bebee':
      return bebeeParser;
    case 'ambitionbox':
      return ambitionboxParser;
    case 'cutshort':
      return cutshortParser;
    case 'fallback':
    default:
      return fallbackParser;
  }
}

export function parseAlertEmail(portal: PortalType, html: string, text?: string): ParsedAlertJob[] {
  const parser = getParser(portal);
  const jobs = parser.parse(html, text);
  // If a portal-specific parser found 0 jobs, we can check if fallback finds anything,
  // or return jobs as is to detect empty digests
  return jobs;
}
