import type { LLMClient } from '../types.js';
import { wrapUntrusted } from '../safety.js';

export interface SelectableResume {
  id: string;
  label: string;
  tags: string[] | string;
  is_default?: boolean | number | null;
}

export interface JobForResumeSelection {
  title: string;
  description: string;
}

export interface ResumeSelectionResult {
  resume_id: string;
  reason: string;
}

export interface ResumeSelectorOptions {
  use_llm_tiebreak?: boolean;
  llmClient?: LLMClient;
}

function parseTags(raw: string[] | string): string[] {
  if (Array.isArray(raw)) {
    return raw.map((t) => String(t).trim()).filter(Boolean);
  }
  if (typeof raw !== 'string') {
    return [];
  }
  const trimmed = raw.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((t) => String(t).trim()).filter(Boolean);
      }
    } catch {
      // Fall through to comma-separated parsing
    }
  }
  return trimmed
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function scoreResume(
  resume: SelectableResume,
  job: JobForResumeSelection,
): {
  score: number;
  matchedTags: string[];
} {
  const tags = parseTags(resume.tags);
  const titleLower = job.title.toLowerCase();
  const descLower = job.description.toLowerCase();

  let score = 0;
  const matchedTags: string[] = [];

  for (const tag of tags) {
    const tagLower = tag.toLowerCase().trim();
    if (!tagLower) continue;

    // Use boundary matching when possible, or includes for multi-word / special tags
    const hasSpecial = /[^a-zA-Z0-9]/.test(tagLower);
    const inTitle = hasSpecial
      ? titleLower.includes(tagLower)
      : new RegExp(`\\b${escapeRegex(tagLower)}\\b`, 'i').test(titleLower);

    const inDesc = hasSpecial
      ? descLower.includes(tagLower)
      : new RegExp(`\\b${escapeRegex(tagLower)}\\b`, 'i').test(descLower);

    if (inTitle) {
      score += 2; // Extra weight for title match
      matchedTags.push(tag);
    } else if (inDesc) {
      score += 1;
      matchedTags.push(tag);
    }
  }

  return { score, matchedTags };
}

export function buildResumeSelectionPrompt(
  job: JobForResumeSelection,
  topScored: { resume: SelectableResume; score?: number }[],
): string {
  const postingSnippet = `Job Title: ${job.title}\nJob Description: ${job.description.slice(0, 1000)}`;
  return `You are selecting the best resume for a job application.

${wrapUntrusted(postingSnippet, 'job_posting')}

Candidate Resume Options:
${topScored
  .map(
    (t, i) =>
      `${i + 1}. ID: ${t.resume.id}, Label: ${t.resume.label}, Tags: ${JSON.stringify(t.resume.tags)}`,
  )
  .join('\n')}

Output JSON ONLY: {"selected_resume_id": "<id>", "reason": "<short explanation>"}`;
}

export async function selectResume(
  resumes: SelectableResume[],
  job: JobForResumeSelection,
  options?: ResumeSelectorOptions,
): Promise<ResumeSelectionResult> {
  if (!resumes || resumes.length === 0) {
    throw new Error('No resumes available for selection');
  }

  if (resumes.length === 1 && resumes[0]) {
    return {
      resume_id: resumes[0].id,
      reason: 'Only one resume available',
    };
  }

  // 1. Score each resume deterministically
  const scored = resumes.map((resume) => {
    const { score, matchedTags } = scoreResume(resume, job);
    return {
      resume,
      score,
      matchedTags,
      isDefault: Boolean(resume.is_default),
    };
  });

  // Find highest score
  const maxScore = Math.max(...scored.map((s) => s.score));
  const topScored = scored.filter((s) => s.score === maxScore);

  // If maxScore is 0, no tags matched: fall back to default resume
  if (maxScore === 0) {
    const defaultResume = scored.find((s) => s.isDefault) ?? scored[0];
    if (!defaultResume) {
      throw new Error('No default resume found');
    }
    return {
      resume_id: defaultResume.resume.id,
      reason: 'Default resume selected (no tag overlap with job description)',
    };
  }

  // Single winner
  if (topScored.length === 1 && topScored[0]) {
    const winner = topScored[0];
    return {
      resume_id: winner.resume.id,
      reason: `Highest overlap score ${winner.score} (tags: ${winner.matchedTags.join(', ')})`,
    };
  }

  // Tie between 2+ resumes
  // Optional LLM tiebreak (off by default)
  if (options?.use_llm_tiebreak && options.llmClient) {
    try {
      const prompt = buildResumeSelectionPrompt(job, topScored);

      const rawResp = await options.llmClient.generateText(prompt);
      const match = rawResp.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]) as {
          selected_resume_id?: string;
          reason?: string;
        };
        if (
          parsed.selected_resume_id &&
          topScored.some((t) => t.resume.id === parsed.selected_resume_id)
        ) {
          return {
            resume_id: parsed.selected_resume_id,
            reason: `LLM tiebreak: ${parsed.reason || 'Selected based on content fit'}`,
          };
        }
      }
    } catch {
      // If LLM tiebreak fails, fall through to default resume tiebreak
    }
  }

  // Deterministic tiebreak: ties go to the default resume
  const defaultWinner = topScored.find((t) => t.isDefault);
  if (defaultWinner) {
    return {
      resume_id: defaultWinner.resume.id,
      reason: `Tie at score ${maxScore} broken by default resume (${defaultWinner.resume.label})`,
    };
  }

  // If none of the tied resumes is default, pick the first tied resume
  const firstTied = topScored[0];
  if (!firstTied) {
    throw new Error('No tied resume found');
  }
  return {
    resume_id: firstTied.resume.id,
    reason: `Tie at score ${maxScore} (selected ${firstTied.resume.label})`,
  };
}

export const ResumeSelector = {
  selectResume,
};
