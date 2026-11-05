import { describe, it, expect } from 'vitest';
import { extractContactEmail } from './email-extractor.js';

describe('Contact Email Extraction', () => {
  it('keeps genuine recruiter and hiring emails', () => {
    expect(
      extractContactEmail(
        'Interested candidates should send their resume to recruiter@acme.com for consideration.',
      ),
    ).toBe('recruiter@acme.com');

    expect(extractContactEmail('Please reach out to talent.team@startup.io directly.')).toBe(
      'talent.team@startup.io',
    );

    expect(
      extractContactEmail('Apply by emailing jobs-infra@stripe.com with your portfolio.'),
    ).toBe('jobs-infra@stripe.com');
  });

  it('ignores no-reply, noreply, and donotreply addresses', () => {
    expect(
      extractContactEmail(
        'Automated confirmation will be sent from no-reply@acme.com upon submission.',
      ),
    ).toBeNull();

    expect(extractContactEmail('Do not reply to noreply@company.com.')).toBeNull();

    expect(
      extractContactEmail('Messages from donotreply@greenhouse.io will not be monitored.'),
    ).toBeNull();
  });

  it('ignores templated and placeholder addresses', () => {
    expect(extractContactEmail('Send your inquiries to user@example.com.')).toBeNull();

    expect(extractContactEmail('Contact your-email@domain.com.')).toBeNull();
  });

  it('ignores image file false positives like image@2x.png', () => {
    expect(extractContactEmail('Check out our logo at assets/logo@2x.png on Github.')).toBeNull();
  });

  it('handles HN comment with an email', () => {
    const hnComment = `Stripe | Infrastructure Engineer | San Francisco, CA | REMOTE | $160k-$220k
We are expanding our core payment platform. Looking for engineers with strong systems background.
Email us directly: jobs-infra@stripe.com (please mention HN).`;

    const email = extractContactEmail(hnComment);
    expect(email).toBe('jobs-infra@stripe.com');
  });
});
