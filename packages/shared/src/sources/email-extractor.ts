const IGNORED_USERNAMES = new Set([
  'noreply',
  'no-reply',
  'no_reply',
  'donotreply',
  'do-not-reply',
  'do_not_reply',
  'bounce',
  'bounces',
  'mailer-daemon',
  'postmaster',
  'notification',
  'notifications',
  'alert',
  'alerts',
  'support',
  'billing',
  'help',
  'example',
  'sample',
  'test',
  'dummy',
  'your-email',
  'youremail',
  'user',
  'username',
]);

const IGNORED_DOMAINS = new Set([
  'example.com',
  'example.org',
  'example.net',
  'domain.com',
  'company.com',
  'email.com',
  'test.com',
  'yoursite.com',
  'website.com',
  'sentry.io',
  'w3.org',
  'schema.org',
]);

const IGNORED_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'pdf', 'zip']);

const STRICT_EMAIL_REGEX =
  /\b[A-Za-z0-9](?:[A-Za-z0-9._%+-]{0,62}[A-Za-z0-9])?@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,}\b/g;

/**
 * Extracts a valid contact email from job description text.
 * Ignores no-reply, templated, and placeholder email addresses.
 * Returns null if no valid contact email is found.
 */
export function extractContactEmail(text: string | null | undefined): string | null {
  if (!text) return null;

  const matches = text.match(STRICT_EMAIL_REGEX);
  if (!matches || matches.length === 0) return null;

  for (const rawEmail of matches) {
    const email = rawEmail.toLowerCase().trim();
    const parts = email.split('@');
    if (parts.length !== 2) continue;

    const [user, domain] = parts as [string, string];
    if (!user || !domain) continue;

    // Check user prefix ignore list
    if (IGNORED_USERNAMES.has(user)) continue;
    if (
      user.startsWith('no-reply') ||
      user.startsWith('noreply') ||
      user.startsWith('donotreply')
    ) {
      continue;
    }

    // Check domain ignore list
    if (IGNORED_DOMAINS.has(domain)) continue;

    // Check file extension false positives (e.g. image@2x.png)
    const ext = domain.split('.').pop() || '';
    if (IGNORED_EXTENSIONS.has(ext)) continue;

    // Reject obviously templated addresses
    if (user.includes('{') || user.includes('}') || domain.includes('{') || domain.includes('}')) {
      continue;
    }

    return email;
  }

  return null;
}
