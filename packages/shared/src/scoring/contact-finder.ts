import type { ContactFinder } from '../types.js';
import type { JobContactSource } from '../schema.js';
import type { D1LikeDatabase } from '../state-machine.js';
import { extractContactEmail } from '../sources/email-extractor.js';

export interface DiscoverableJob {
  company: string;
  description?: string | null | undefined;
  apply_url?: string | null | undefined;
  contact_email?: string | null | undefined;
  contact_source?: JobContactSource | null | undefined;
}

export interface ContactDiscoveryConfig {
  finderEnabled?: boolean | undefined;
  guessEnabled?: boolean | undefined;
}

export interface DiscoveredContact {
  contact_email: string | null;
  contact_source: JobContactSource;
}

/**
 * Checks whether an email address or its domain is present in the do_not_contact table.
 */
export async function isAddressOnDnc(email: string, db?: D1LikeDatabase): Promise<boolean> {
  if (!db || !email) return false;
  const cleanEmail = email.toLowerCase().trim();
  const atIndex = cleanEmail.lastIndexOf('@');
  if (atIndex === -1) return false;
  const domain = cleanEmail.slice(atIndex + 1);

  const row = await db
    .prepare(`SELECT value FROM do_not_contact WHERE LOWER(value) = ? OR LOWER(value) = ? LIMIT 1`)
    .bind(cleanEmail, domain)
    .first<{ value: string }>();

  return row != null;
}

/**
 * Extracts a candidate company domain from apply_url or returns null.
 * Filters out public ATS domains (greenhouse.io, lever.co, ashbyhq.com) to find company domain.
 */
export function extractCompanyDomain(applyUrl?: string | null): string | null {
  if (!applyUrl) return null;
  try {
    const url = new URL(applyUrl);
    const host = url.hostname.toLowerCase();

    // If host is an ATS subdomain, e.g. acme.greenhouse.io -> cannot infer company apex domain safely
    if (
      host.endsWith('greenhouse.io') ||
      host.endsWith('lever.co') ||
      host.endsWith('ashbyhq.com') ||
      host.endsWith('workable.com') ||
      host.endsWith('linkedin.com') ||
      host.endsWith('indeed.com') ||
      host.endsWith('naukri.com')
    ) {
      return null;
    }

    // Return primary domain (e.g. careers.acme.com -> acme.com or host)
    const parts = host.split('.');
    if (parts.length >= 2) {
      return parts.slice(-2).join('.');
    }
    return host;
  } catch {
    return null;
  }
}

/**
 * Step 4: Contact discovery chain.
 * Stops at first hit:
 * (a) email extracted from posting -> contact_source=posting
 * (b) Hunter-style API (off by default) -> contact_source=finder
 * (c) pattern guess careers@, jobs@, hr@ (off by default) -> contact_source=guessed
 * (d) nothing -> contact_source=none
 *
 * Never selects an address on do_not_contact.
 */
export async function discoverContact(params: {
  job: DiscoverableJob;
  finder?: ContactFinder | undefined;
  config?: ContactDiscoveryConfig | undefined;
  db?: D1LikeDatabase | undefined;
}): Promise<DiscoveredContact> {
  const { job, finder, config, db } = params;
  const finderEnabled = config?.finderEnabled === true;
  const guessEnabled = config?.guessEnabled === true;

  // (a) Email from posting
  let candidatePostingEmail = job.contact_email;
  if (!candidatePostingEmail && job.description) {
    candidatePostingEmail = extractContactEmail(job.description);
  }

  if (candidatePostingEmail) {
    const onDnc = await isAddressOnDnc(candidatePostingEmail, db);
    if (!onDnc) {
      return {
        contact_email: candidatePostingEmail,
        contact_source: 'posting',
      };
    }
  }

  // (b) Hunter-style Finder API (off by default)
  if (finderEnabled && finder) {
    const domain = extractCompanyDomain(job.apply_url) || job.company;
    try {
      const foundEmail = await finder.findContact(domain);
      if (foundEmail) {
        const onDnc = await isAddressOnDnc(foundEmail, db);
        if (!onDnc) {
          return {
            contact_email: foundEmail,
            contact_source: 'finder',
          };
        }
      }
    } catch {
      // Ignore finder API errors and fall through
    }
  }

  // (c) Pattern guess on company domain: careers@, jobs@, hr@ (off by default)
  if (guessEnabled) {
    const domain = extractCompanyDomain(job.apply_url);
    if (domain) {
      const patterns = ['careers', 'jobs', 'hr'];
      for (const prefix of patterns) {
        const guessed = `${prefix}@${domain}`;
        const onDnc = await isAddressOnDnc(guessed, db);
        if (!onDnc) {
          return {
            contact_email: guessed,
            contact_source: 'guessed',
          };
        }
      }
    }
  }

  // (d) Nothing
  return {
    contact_email: null,
    contact_source: 'none',
  };
}
