import type { Profile } from '../profile.js';
import { TECH_LEXICON } from './lexicon.js';

export interface ValidationTargetJob {
  title: string;
  company: string;
}

export interface ValidatorOptions {
  bannedPhrases?: string[] | undefined;
  minWords?: number | undefined;
  maxWords?: number | undefined;
}

export const DEFAULT_BANNED_PHRASES: readonly string[] = [
  'i am writing to apply',
  'i believe i am the ideal candidate',
  'to whom it may concern',
  'think outside the box',
  'hit the ground running',
  'fast learner',
  'team player',
  'hard worker',
  'dear hiring manager',
] as const;

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Computes candidate years of experience from profile.
 */
export function getCandidateYearsOfExperience(profile: Profile): number {
  if (typeof profile.experience_years === 'number') {
    return profile.experience_years;
  }

  if (profile.filters?.experience_range?.min !== undefined) {
    return profile.filters.experience_range.min;
  }

  if (Array.isArray(profile.experience) && profile.experience.length > 0) {
    let totalMonths = 0;
    const now = new Date();

    for (const exp of profile.experience) {
      if (!exp.start_date) continue;
      const start = new Date(exp.start_date);
      const end = exp.end_date ? new Date(exp.end_date) : now;
      const months =
        (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
      totalMonths += Math.max(0, months);
    }
    return Math.round(totalMonths / 12);
  }

  return 0;
}

/**
 * Pure guardrail validator for cover letters.
 * Returns an array of error messages (empty if valid).
 */
export function validateCoverLetter(
  body: string,
  subject: string,
  profile: Profile,
  job: ValidationTargetJob,
  options?: ValidatorOptions,
): string[] {
  const errors: string[] = [];

  if (!body || typeof body !== 'string' || !body.trim()) {
    return ['Cover letter body is empty.'];
  }

  const trimmedBody = body.trim();

  // 1. Company name present and exact
  if (!trimmedBody.includes(job.company)) {
    errors.push(`Company name '${job.company}' must be present and exact in the cover letter.`);
  }

  // 2. Job title present (case-insensitive in body or subject)
  const titleLower = job.title.toLowerCase();
  const bodyLower = trimmedBody.toLowerCase();
  const subjectLower = (subject || '').toLowerCase();

  if (!bodyLower.includes(titleLower) && !subjectLower.includes(titleLower)) {
    errors.push(`Job title '${job.title}' must be present in the cover letter.`);
  }

  // 3. Candidate name sign-off check
  if (profile.name && !bodyLower.includes(profile.name.toLowerCase())) {
    errors.push(`Cover letter must be signed with candidate's name '${profile.name}'.`);
  }

  // 4. Hallucinated skills check against TECH_LEXICON
  const profileSkillsLower = new Set((profile.skills || []).map((s) => s.toLowerCase().trim()));

  // Also include skills from experience highlights / titles if any
  for (const exp of profile.experience || []) {
    for (const h of exp.highlights || []) {
      for (const word of h.split(/\s+/)) {
        profileSkillsLower.add(word.toLowerCase().replace(/[^a-z0-9+#.-]/g, ''));
      }
    }
  }

  for (const tech of TECH_LEXICON) {
    const techLower = tech.toLowerCase();

    // Skip if already in candidate profile skills
    if (profileSkillsLower.has(techLower)) {
      continue;
    }

    // Check if skill is substring of any candidate skill (e.g. 'react' in 'react native')
    let covered = false;
    for (const skill of profileSkillsLower) {
      if (skill === techLower || skill.includes(techLower) || techLower.includes(skill)) {
        covered = true;
        break;
      }
    }
    if (covered) continue;

    // Word boundary regex for the tech
    let regex: RegExp;
    if (techLower === 'go') {
      // Special case for 'go' to prevent matching English verb 'go'
      regex = /\b(?:Go\s+language|Golang|Go\s+developer|Go\s+code)\b/i;
    } else if (
      techLower === '.net' ||
      techLower === 'c++' ||
      techLower === 'c#' ||
      techLower === 'ci/cd'
    ) {
      regex = new RegExp(`(?:^|\\s)${escapeRegex(techLower)}(?:\\s|[.,;:]|$)`, 'i');
    } else {
      regex = new RegExp(`\\b${escapeRegex(techLower)}\\b`, 'i');
    }

    if (regex.test(trimmedBody)) {
      errors.push(`Hallucinated skill: '${tech}' is not listed in candidate profile skills.`);
    }
  }

  // 5. Years-of-experience claims match profile
  const profileYears = getCandidateYearsOfExperience(profile);
  const experienceClaimPatterns = [
    /(\d+)\+?\s*(?:years?|yrs?)(?:\s+of)?\s+(?:experience|exp)\b/gi,
    /experience\s+of\s+(\d+)\+?\s*(?:years?|yrs?)\b/gi,
    /(?:over|more than|nearly|around|past)\s+(\d+)\+?\s*(?:years?|yrs?)\b/gi,
  ];

  for (const pattern of experienceClaimPatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(trimmedBody)) !== null) {
      const claimedYears = Number.parseInt(match[1] || '0', 10);
      if (claimedYears > 0 && claimedYears !== profileYears) {
        errors.push(
          `Years of experience claim (${claimedYears} years) does not match profile (${profileYears} years).`,
        );
        break;
      }
    }
  }

  // 6. No placeholders such as [Name], {{company}} or <role>
  const placeholderRegexes = [
    /\[(?:[a-zA-Z0-9_\s\-/]+)\]/g,
    /\{\{(?:[a-zA-Z0-9_\s\-/]+)\}\}/g,
    /<(?:[a-zA-Z0-9_\s\-/]+)>/g,
  ];

  for (const regex of placeholderRegexes) {
    const matches = trimmedBody.match(regex);
    if (matches) {
      for (const m of matches) {
        // Exclude legitimate markdown or standard punctuation
        if (m === '<p>' || m === '</p>' || m === '<br>' || m === '<br/>') continue;
        errors.push(`Leftover placeholder detected: '${m}'.`);
      }
    }
  }

  // 7. No URLs except those in profile
  const allowedUrls = new Set<string>();
  if (profile.answers?.links) {
    for (const val of Object.values(profile.answers.links)) {
      if (typeof val === 'string' && val.trim()) {
        allowedUrls.add(val.trim().toLowerCase().replace(/\/+$/, ''));
      }
    }
  }
  if (profile.answers?.other) {
    for (const val of Object.values(profile.answers.other)) {
      if (typeof val === 'string' && val.startsWith('http')) {
        allowedUrls.add(val.trim().toLowerCase().replace(/\/+$/, ''));
      }
    }
  }

  const urlRegex = /(?:https?:\/\/|www\.)[^\s)\]>,;"']+/gi;
  let urlMatch: RegExpExecArray | null;
  while ((urlMatch = urlRegex.exec(trimmedBody)) !== null) {
    const rawUrl = urlMatch[0];
    const cleanedUrl = rawUrl.replace(/[.,;:]+$/, '');
    const normalizedFound = cleanedUrl.toLowerCase().replace(/\/+$/, '');
    if (!allowedUrls.has(normalizedFound)) {
      errors.push(`Unauthorized URL: '${cleanedUrl}' is not in candidate profile.`);
    }
  }

  // 8. No salary figures
  const salaryPatterns = [
    /(?:\$|€|£|₹|Rs\.?)\s*\d+/i,
    /\b\d+(?:,\d{3})*\s*(?:k|usd|eur|gbp|inr|lpa|ctc)\b/i,
    /\b(?:salary|compensation|remuneration|expected ctc|current ctc)\b/i,
  ];

  for (const pat of salaryPatterns) {
    if (pat.test(trimmedBody)) {
      errors.push('Salary figure or compensation mention detected in letter.');
      break;
    }
  }

  // 9. None of the banned phrases
  const bannedPhrases = [
    ...DEFAULT_BANNED_PHRASES,
    ...(options?.bannedPhrases || []).map((p) => p.toLowerCase().trim()),
  ];

  for (const phrase of bannedPhrases) {
    if (phrase && bodyLower.includes(phrase)) {
      errors.push(`Banned phrase detected: '${phrase}'.`);
    }
  }

  // 10. Word count within bounds (150-250 words)
  const minWords = options?.minWords ?? 150;
  const maxWords = options?.maxWords ?? 250;
  const words = trimmedBody.split(/\s+/).filter(Boolean).length;

  if (words < minWords) {
    errors.push(`Cover letter is too short (${words} words; minimum is ${minWords}).`);
  } else if (words > maxWords) {
    errors.push(`Cover letter is too long (${words} words; maximum is ${maxWords}).`);
  }

  return errors;
}
