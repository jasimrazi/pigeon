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
  | 'whatjobs'
  | 'bebee'
  | 'ambitionbox'
  | 'cutshort'
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
  whatjobs: new Set(['jobid', 'id']),
  bebee: new Set(['id']),
  ambitionbox: new Set(['jobid', 'id']),
  cutshort: new Set(['jobid', 'id']),
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
  if (host.includes('whatjobs.')) return 'whatjobs';
  if (host.includes('bebee.')) return 'bebee';
  if (host.includes('ambitionbox.com')) return 'ambitionbox';
  if (host.includes('cutshort.io')) return 'cutshort';
  return 'unknown';
}

function unwrapTrackingUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    // Unwrap Amazon SES click-tracking wrappers (e.g. https://click4.domain/CL0/<encoded-url>/1/<sig>)
    // Runs strictly offline without issuing any network requests.
    const sesMatch = parsed.pathname.match(/^\/(?:C?L0)\/(https?(?::|%3A)%2F%2F[^/]+)/i);
    if (sesMatch?.[1]) {
      const decoded = decodeURIComponent(sesMatch[1]);
      if (decoded.startsWith('http://') || decoded.startsWith('https://')) {
        return decoded;
      }
    }

    // Unwrap Foundit / Monster autoLogin redirect wrappers (?return_url=<encoded-target-url>)
    const host = parsed.hostname.toLowerCase();
    if (
      (host.includes('foundit.') || host.includes('monsterindia.')) &&
      parsed.pathname.toLowerCase().includes('/autologin')
    ) {
      const returnUrl = parsed.searchParams.get('return_url');
      if (returnUrl && (returnUrl.startsWith('http://') || returnUrl.startsWith('https://'))) {
        return returnUrl;
      }
    }
  } catch {
    // Ignore unparseable URLs and fall back to the raw string
  }
  return rawUrl;
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

  const unwrapped = unwrapTrackingUrl(trimmed);

  try {
    const url = new URL(unwrapped);

    // Determine portal type from URL hostname first when unwrapped URL identifies a known portal,
    // falling back to the explicit hint.
    const detectedFromUrl = detectPortalFromUrl(url);
    let portal: PortalUrlType = 'unknown';
    if (detectedFromUrl !== 'unknown') {
      portal = detectedFromUrl;
    } else if (portalHint && portalHint in PORTAL_PARAM_ALLOWLIST) {
      portal = portalHint as Exclude<PortalUrlType, 'unknown'>;
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
