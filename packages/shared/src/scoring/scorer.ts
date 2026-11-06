import { z } from 'zod';
import type { LLMClient } from '../types.js';
import type { Profile } from '../profile.js';
import { wrapUntrusted } from '../safety.js';

export const ScorerOutputSchema = z.object({
  score: z.number().min(0).max(100),
  matched_skills: z.array(z.string()).default([]),
  missing_skills: z.array(z.string()).default([]),
  red_flags: z.array(z.string()).default([]),
  reasons: z
    .union([z.string(), z.array(z.string())])
    .transform((val) => (Array.isArray(val) ? val.join('; ') : val)),
});

export type ScorerOutput = z.infer<typeof ScorerOutputSchema>;

export interface ScoredJobResult {
  score: number;
  matched_skills: string[];
  missing_skills: string[];
  red_flags: string[];
  reasons: string;
  scorer_failed: boolean;
}

export interface ScorableJob {
  title: string;
  company: string;
  location?: string | null | undefined;
  description: string;
  salary_raw?: string | null | undefined;
}

export interface Scorer {
  scoreJob(job: ScorableJob, profile: Profile): Promise<ScoredJobResult>;
}

export function buildScorerPrompt(job: ScorableJob, profile: Profile): string {
  // Truncate job description to 6000 characters
  const desc = (job.description || '').slice(0, 6000);

  const candidateProfile = {
    name: profile.name,
    skills: profile.skills,
    experience: profile.experience.map((exp) => ({
      title: exp.title,
      company: exp.company,
      highlights: exp.highlights,
    })),
    preferences: profile.preferences,
  };

  const postingBody = `Title: ${job.title}
Company: ${job.company}
Location: ${job.location || 'Unspecified'}
Salary: ${job.salary_raw || 'Unspecified'}

${desc}`;

  return `You are an automated job suitability evaluator.

Evaluate the fit between the candidate profile and the job posting provided below.

<candidate_profile>
${JSON.stringify(candidateProfile, null, 2)}
</candidate_profile>

${wrapUntrusted(postingBody, 'job_posting')}

You must also check for any scam or red flags in the posting:
- Asks for application fee, training fee, equipment deposit, or payment (code: FEE_OR_DEPOSIT)
- Asks for sensitive ID documents, passport, SSN, or bank account details upfront (code: ID_DOCUMENTS)
- Contact is exclusively via WhatsApp, Telegram, or personal messaging with no corporate email or website (code: WHATSAPP_OR_TELEGRAM_ONLY)
- Unrealistic pay or claims of quick wealth (code: UNREALISTIC_PAY)
- No identifiable or verifiable company name (code: NO_COMPANY)

Return ONLY a valid JSON object matching this exact schema:
{
  "score": <number between 0 and 100 representing overall fit>,
  "matched_skills": [<array of candidate skills mentioned or relevant to the job>],
  "missing_skills": [<array of key required skills the candidate lacks>],
  "red_flags": [<array of red flag codes detected, or empty array>],
  "reasons": "<concise explanation of match evaluation>"
}`;
}

export function extractJsonFromText(rawText: string): unknown {
  const trimmed = rawText.trim();

  // If wrapped in markdown code fence ```json ... ```
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const jsonString = codeBlockMatch?.[1] ? codeBlockMatch[1].trim() : trimmed;

  // Find first { and last }
  const firstBrace = jsonString.indexOf('{');
  const lastBrace = jsonString.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const candidate = jsonString.slice(firstBrace, lastBrace + 1);
    return JSON.parse(candidate);
  }

  return JSON.parse(jsonString);
}

export class DefaultScorer implements Scorer {
  private readonly llm: LLMClient;

  constructor(llm: LLMClient) {
    this.llm = llm;
  }

  async scoreJob(job: ScorableJob, profile: Profile): Promise<ScoredJobResult> {
    const prompt = buildScorerPrompt(job, profile);

    // Attempt 1
    try {
      const response1 = await this.llm.generateText(prompt);
      const parsed1 = extractJsonFromText(response1);
      const validated1 = ScorerOutputSchema.parse(parsed1);

      return {
        score: Math.round(validated1.score),
        matched_skills: validated1.matched_skills,
        missing_skills: validated1.missing_skills,
        red_flags: validated1.red_flags,
        reasons: validated1.reasons,
        scorer_failed: false,
      };
    } catch {
      // Retry once on invalid JSON or zod schema mismatch
      try {
        const retryPrompt = `${prompt}\n\nIMPORTANT: Your previous response was not valid JSON. You MUST output strictly a JSON object with keys: score, matched_skills, missing_skills, red_flags, reasons.`;
        const response2 = await this.llm.generateText(retryPrompt);
        const parsed2 = extractJsonFromText(response2);
        const validated2 = ScorerOutputSchema.parse(parsed2);

        return {
          score: Math.round(validated2.score),
          matched_skills: validated2.matched_skills,
          missing_skills: validated2.missing_skills,
          red_flags: validated2.red_flags,
          reasons: validated2.reasons,
          scorer_failed: false,
        };
      } catch {
        // Second failure sets scorer_failed
        return {
          score: 0,
          matched_skills: [],
          missing_skills: [],
          red_flags: [],
          reasons: 'LLM scorer returned invalid output twice',
          scorer_failed: true,
        };
      }
    }
  }
}
