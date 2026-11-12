export type PortalUrlType =
  | 'linkedin'
  | 'naukri'
  | 'indeed'
  | 'wellfound'
  | 'otta'
  | 'ziprecruiter'
  | 'dice'
  | 'glassdoor'
  | 'instahyre'
  | 'foundit'
  | 'unknown';

const PORTAL_PARAM_ALLOWLIST: Record<Exclude<PortalUrlType, 'unknown'>, Set<string>> = {
  indeed: new Set(['jk']),
  linkedin: new Set(['currentjobid']),
  naukri: new Set(),
  wellfound: new Set(),
  otta: new Set(),
  ziprecruiter: new Set(['jid']),
  dice: new Set(['jobid']),
  glassdoor: new Set(['joblistingid', 'jl']),
  instahyre: new Set(),
  foundit: new Set(),
};

export function detectPortalFromUrl(url: URL): PortalUrlType {
  const host = url.hostname.toLowerCase();
  if (host.includes('indeed.')) return 'indeed';
  if (host.includes('linkedin.')) return 'linkedin';
  if (host.includes('naukri.')) return 'naukri';
  if (host.includes('wellfound.com') || host.includes('angel.co')) return 'wellfound';
  if (host.includes('otta.com') || host.includes('welcometothejungle.com')) return 'otta';
  if (host.includes('ziprecruiter.')) return 'ziprecruiter';
  if (host.includes('dice.com')) return 'dice';
  if (host.includes('glassdoor.')) return 'glassdoor';
  if (host.includes('instahyre.com')) return 'instahyre';
  if (host.includes('foundit.') || host.includes('monsterindia.com')) return 'foundit';
  return 'unknown';
}

/**
 * Strips tracking parameters based on a per-portal allowlist of query parameters:
 * - Indeed: keeps only `jk`
 * - LinkedIn: keeps only `currentJobId`
 * - Naukri: keeps no query parameters beyond the path
 * - Unknown portals: only drops `utm_*` parameters
 *
 * Runs purely offline; never makes a network request.
 */
export function cleanTrackingUrl(rawUrl: string, portalHint?: string): string {
  if (!rawUrl || typeof rawUrl !== 'string') return '';

  // Decode common HTML entities (e.g. &amp; in href attributes) before parsing URL
  const trimmed = rawUrl.trim().replace(/&amp;/g, '&').replace(/&#38;/g, '&');

  if (!trimmed) return '';

  try {
    const url = new URL(trimmed);

    // Determine portal type from hint or URL hostname
    let portal: PortalUrlType = 'unknown';
    if (portalHint && portalHint in PORTAL_PARAM_ALLOWLIST) {
      portal = portalHint as Exclude<PortalUrlType, 'unknown'>;
    } else {
      portal = detectPortalFromUrl(url);
    }

    if (portal === 'unknown') {
      // Unknown portals only lose utm_* parameters
      const paramsToDelete: string[] = [];
      url.searchParams.forEach((_, key) => {
        if (/^utm_/i.test(key)) {
          paramsToDelete.push(key);
        }
      });
      for (const key of paramsToDelete) {
        url.searchParams.delete(key);
      }
    } else {
      // Known portal: use strict allowlist of parameters to keep
      const allowed = PORTAL_PARAM_ALLOWLIST[portal];
      const paramsToDelete: string[] = [];
      url.searchParams.forEach((_, key) => {
        if (!allowed.has(key.toLowerCase())) {
          paramsToDelete.push(key);
        }
      });
      for (const key of paramsToDelete) {
        url.searchParams.delete(key);
      }
    }

    // Clean tracking fragments if any
    if (url.hash && /#(utm_|xtor)/i.test(url.hash)) {
      url.hash = '';
    }

    // Return the cleaned URL string (remove trailing '?' if query string is now empty)
    let cleaned = url.toString();
    if (cleaned.endsWith('?')) {
      cleaned = cleaned.slice(0, -1);
    }
    return cleaned;
  } catch {
    // If not a valid parseable URL, return trimmed string without network intervention
    return trimmed;
  }
}
