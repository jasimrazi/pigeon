import type { Profile } from '../profile.js';

export interface FilterableJob {
  title: string;
  company: string;
  company_normalized?: string | undefined;
  location?: string | null | undefined;
  remote?: boolean | null | undefined;
  salary_min?: number | null | undefined;
  salary_max?: number | null | undefined;
  description?: string | null | undefined;
}

export interface RuleFilterResult {
  passed: boolean;
  reason?: string | undefined;
}

/**
 * Extracts minimum and maximum years of experience mentioned in job text.
 */
export function extractRequiredExperience(text: string): { min?: number; max?: number } | null {
  if (!text) return null;

  // Patterns like "5 to 8 years", "5-8 yrs", "5+ years", "at least 3 years", "minimum 4 years"
  const rangeMatch = text.match(
    /\b(\d{1,2})\s*(?:-|to)\s*(\d{1,2})\s*(?:\+)?\s*(?:years?|yrs?)\b/i,
  );
  if (rangeMatch?.[1] && rangeMatch[2]) {
    return {
      min: parseInt(rangeMatch[1], 10),
      max: parseInt(rangeMatch[2], 10),
    };
  }

  const minMatch = text.match(
    /(?:(?:at\s+least|minimum|min\.?)\s*(\d{1,2})|\b(\d{1,2})\s*\+)\s*(?:years?|yrs?)\b/i,
  );
  if (minMatch) {
    const val = parseInt(minMatch[1] || minMatch[2] || '', 10);
    if (!isNaN(val)) {
      return { min: val };
    }
  }

  return null;
}

/**
 * Cheap rule filters executed first before any LLM scoring.
 * Checks title include/exclude keywords, locations, remote preference,
 * salary thresholds, experience range, and company blacklists.
 */
export function evaluateRuleFilters(job: FilterableJob, profile: Profile): RuleFilterResult {
  const filters = profile.filters;
  const titleLower = job.title.toLowerCase();
  const compLower = job.company.toLowerCase();
  const compNormLower = (job.company_normalized || '').toLowerCase();

  // 1. Company Blacklist Check
  if (filters.company_blacklist && filters.company_blacklist.length > 0) {
    for (const blocked of filters.company_blacklist) {
      const bLower = blocked.toLowerCase().trim();
      if (
        bLower &&
        (compLower === bLower ||
          compNormLower === bLower ||
          compLower.includes(bLower) ||
          compNormLower.includes(bLower))
      ) {
        return { passed: false, reason: 'COMPANY_BLACKLIST' };
      }
    }
  }

  // 2. Title Exclude Keywords
  if (filters.title_exclude && filters.title_exclude.length > 0) {
    for (const excludeWord of filters.title_exclude) {
      const kw = excludeWord.toLowerCase().trim();
      if (kw && titleLower.includes(kw)) {
        return { passed: false, reason: 'TITLE_EXCLUDED' };
      }
    }
  }

  // 3. Title Include Keywords (checked if title_include or titles is non-empty)
  const includeTitles =
    filters.title_include && filters.title_include.length > 0
      ? filters.title_include
      : filters.titles;

  if (includeTitles && includeTitles.length > 0) {
    const matchesAny = includeTitles.some((titleKeyword) => {
      const kw = titleKeyword.toLowerCase().trim();
      return kw && titleLower.includes(kw);
    });

    if (!matchesAny) {
      return { passed: false, reason: 'TITLE_MISMATCH' };
    }
  }

  // 4. Location and Remote Check
  const jobIsRemote =
    job.remote === true ||
    titleLower.includes('remote') ||
    (job.location || '').toLowerCase().includes('remote');

  const requireRemote = filters.remote === true;
  const allowedLocations = filters.locations || [];

  if (requireRemote && !jobIsRemote) {
    // If candidate requires remote and job is not remote, check if location matches allowed locations
    if (allowedLocations.length > 0) {
      const jobLoc = (job.location || '').toLowerCase();
      const matchesLoc = allowedLocations.some((loc) => jobLoc.includes(loc.toLowerCase().trim()));
      if (!matchesLoc) {
        return { passed: false, reason: 'LOCATION_MISMATCH' };
      }
    } else {
      return { passed: false, reason: 'LOCATION_MISMATCH' };
    }
  } else if (!jobIsRemote && allowedLocations.length > 0) {
    const jobLoc = (job.location || '').toLowerCase();
    const matchesLoc = allowedLocations.some((loc) => jobLoc.includes(loc.toLowerCase().trim()));
    if (!matchesLoc) {
      return { passed: false, reason: 'LOCATION_MISMATCH' };
    }
  }

  // 5. Min Salary Check
  // Rule: Jobs with no salary pass unless require_salary is true
  const hasSalary = job.salary_max != null || job.salary_min != null;
  if (filters.min_salary != null && filters.min_salary > 0) {
    if (hasSalary) {
      const effectiveSalary = job.salary_max ?? job.salary_min ?? 0;
      if (effectiveSalary < filters.min_salary) {
        return { passed: false, reason: 'SALARY_LOW' };
      }
    } else if (filters.require_salary) {
      return { passed: false, reason: 'SALARY_REQUIRED' };
    }
  } else if (!hasSalary && filters.require_salary) {
    return { passed: false, reason: 'SALARY_REQUIRED' };
  }

  // 6. Experience Range Check
  if (filters.experience_range) {
    const fullText = `${job.title} ${job.description || ''}`;
    const requiredExp = extractRequiredExperience(fullText);

    if (requiredExp) {
      if (
        filters.experience_range.max != null &&
        requiredExp.min != null &&
        requiredExp.min > filters.experience_range.max
      ) {
        return { passed: false, reason: 'EXPERIENCE_TOO_HIGH' };
      }
      if (
        filters.experience_range.min != null &&
        requiredExp.max != null &&
        requiredExp.max < filters.experience_range.min
      ) {
        return { passed: false, reason: 'EXPERIENCE_TOO_LOW' };
      }
    }
  }

  return { passed: true };
}
