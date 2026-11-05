import { describe, it, expect } from 'vitest';
import { ProfileSchema, type Profile } from './profile.js';

export const validProfileFixture: Profile = {
  name: 'Alex Mercer',
  email: 'alex.mercer@example.com',
  skills: ['TypeScript', 'Cloudflare Workers', 'Node.js', 'React', 'SQL'],
  experience: [
    {
      title: 'Senior Systems Engineer',
      company: 'CloudTech Solutions',
      location: 'Remote',
      start_date: '2021-03',
      end_date: '2024-08',
      current: false,
      description: 'Architected serverless edge backends and microservices.',
      highlights: ['Reduced edge latency by 45%', 'Designed D1-backed real-time caching layer'],
    },
  ],
  education: [
    {
      institution: 'State University',
      degree: 'B.S. Computer Science',
      field_of_study: 'Software Engineering',
      start_date: '2016-09',
      end_date: '2020-05',
    },
  ],
  preferences: {
    locations: ['Remote', 'San Francisco, CA', 'New York, NY'],
    remote: true,
    roles: ['Backend Engineer', 'Systems Engineer', 'Full Stack Engineer'],
  },
  filters: {
    titles: ['Senior Software Engineer', 'Staff Engineer', 'Backend Engineer'],
    locations: ['Remote', 'United States'],
    min_salary: 140000,
    experience_range: {
      min: 4,
      max: 10,
    },
    company_blacklist: ['SpamCorp', 'BadCulture Inc'],
    min_score: 75,
    require_salary: false,
  },
  send_settings: {
    daily_cap: 10,
    window: {
      start: '09:00',
      end: '17:00',
    },
    timezone: 'America/New_York',
    ramp_base: 2,
    ramp_step: 1,
    auto_approve_above_score: 85,
  },
  answers: {
    notice_period: '2 weeks',
    current_ctc: '$160,000',
    expected_ctc: '$180,000',
    work_authorisation: 'US Citizen',
    links: {
      linkedin: 'https://linkedin.com/in/alex-mercer',
      github: 'https://github.com/alex-mercer',
      portfolio: 'https://alexmercer.dev',
    },
    other: {
      preferred_contact: 'email',
      relocation: 'no',
    },
  },
};

describe('Profile Validation', () => {
  it('accepts the full example fixture', () => {
    const parsed = ProfileSchema.parse(validProfileFixture);
    expect(parsed.name).toBe('Alex Mercer');
    expect(parsed.email).toBe('alex.mercer@example.com');
    expect(parsed.skills).toHaveLength(5);
    expect(parsed.send_settings.daily_cap).toBe(10);
    expect(parsed.answers.notice_period).toBe('2 weeks');
  });

  it('rejects missing required name', () => {
    const invalid = { ...validProfileFixture, name: '' };
    expect(() => ProfileSchema.parse(invalid)).toThrow();
  });

  it('rejects invalid email', () => {
    const invalid = { ...validProfileFixture, email: 'not-an-email' };
    expect(() => ProfileSchema.parse(invalid)).toThrow();
  });

  it('rejects empty skills array', () => {
    const invalid = { ...validProfileFixture, skills: [] };
    expect(() => ProfileSchema.parse(invalid)).toThrow();
  });

  it('rejects negative daily cap', () => {
    const invalid = {
      ...validProfileFixture,
      send_settings: {
        ...validProfileFixture.send_settings,
        daily_cap: -5,
      },
    };
    expect(() => ProfileSchema.parse(invalid)).toThrow();
  });

  it('rejects auto_approve_above_score out of range', () => {
    const invalid = {
      ...validProfileFixture,
      send_settings: {
        ...validProfileFixture.send_settings,
        auto_approve_above_score: 120,
      },
    };
    expect(() => ProfileSchema.parse(invalid)).toThrow();
  });

  it('rejects malformed non-object inputs', () => {
    expect(() => ProfileSchema.parse(null)).toThrow();
    expect(() => ProfileSchema.parse('string')).toThrow();
    expect(() => ProfileSchema.parse(123)).toThrow();
  });
});
