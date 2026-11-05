const COMPANY_SUFFIX_REGEX =
  /\b(inc|incorporated|corp|corporation|llc|ltd|limited|pvt|private limited|technologies|technology|tech|co|gmbh|solutions|group)\b/gi;

const TITLE_NOISE_REGEX =
  /[([][^\])]*(?:remote|f\/m\/d|m\/f\/d|f\/m\/x|anywhere|full-?time|part-?time|contract|permanent)[^\])]*[)\]]/gi;

export function normalizeCompanyName(company: string): string {
  if (!company) return '';
  return company
    .toLowerCase()
    .replace(COMPANY_SUFFIX_REGEX, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeJobTitle(title: string): string {
  if (!title) return '';
  return title
    .replace(TITLE_NOISE_REGEX, ' ')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeLocationBucket(
  location: string | null | undefined,
  remote: boolean | null | undefined,
): string {
  if (remote === true) return 'remote';
  if (!location) return 'remote';

  const loc = location.toLowerCase().trim();
  if (
    loc.includes('remote') ||
    loc.includes('anywhere') ||
    loc.includes('worldwide') ||
    loc.includes('distributed') ||
    loc.includes('work from home') ||
    loc.includes('wfh')
  ) {
    return 'remote';
  }

  // Extract primary city or region (before first comma)
  const primary = loc.split(',')[0]?.trim() || loc;
  return (
    primary
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'remote'
  );
}

/**
 * Computes deterministic dedupe_key = SHA256(company_normalized + normalized title + location bucket).
 * Guarantees cross-source idempotency for identical job postings.
 */
export async function computeDedupeKey(
  company: string,
  title: string,
  location?: string | null,
  remote?: boolean | null,
): Promise<string> {
  const compNorm = normalizeCompanyName(company);
  const titleNorm = normalizeJobTitle(title);
  const locBucket = normalizeLocationBucket(location, remote);

  const rawKey = `${compNorm}|${titleNorm}|${locBucket}`;
  const encoded = new TextEncoder().encode(rawKey);

  // WebCrypto SHA-256
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
