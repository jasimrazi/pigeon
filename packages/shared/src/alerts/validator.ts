const ALLOWED_SENDER_DOMAINS = ['linkedin.com', 'naukri.com', 'indeed.com'];

/**
 * Extracts the domain from an email address (e.g. 'foo@em.linkedin.com' -> 'em.linkedin.com').
 */
export function extractEmailDomain(email: string): string {
  if (!email) return '';
  const atIndex = email.lastIndexOf('@');
  if (atIndex === -1) return '';
  return email
    .slice(atIndex + 1)
    .toLowerCase()
    .trim();
}

/**
 * Validates if the sender domain is in the allowed list (LinkedIn, Naukri, Indeed).
 * Subdomains (e.g. em.linkedin.com, mail.indeed.com) are valid.
 */
export function isAllowedSender(fromAddress: string): boolean {
  const domain = extractEmailDomain(fromAddress);
  if (!domain) return false;

  for (const allowed of ALLOWED_SENDER_DOMAINS) {
    if (domain === allowed || domain.endsWith('.' + allowed)) {
      return true;
    }
  }
  return false;
}

export interface ForwardingValidationParams {
  envelopeSender?: string | undefined;
  configuredAddress?: string | undefined;
}

/**
 * Strictly validates that the envelope sender equals the configured forwarding address
 * (exact, case-insensitive). Header matches alone (X-Forwarded-For, etc.) are NOT enough.
 */
export function isAuthorizedForwarding(params: ForwardingValidationParams): boolean {
  if (!params.configuredAddress) {
    // If no forwarding address is explicitly configured, accept
    return true;
  }

  const target = params.configuredAddress.toLowerCase().trim();
  if (!target) return true;

  if (!params.envelopeSender) {
    return false;
  }

  return params.envelopeSender.toLowerCase().trim() === target;
}
