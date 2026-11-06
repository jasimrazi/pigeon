import { z } from 'zod';
import type { LLMClient } from '../types.js';
import type { Profile } from '../profile.js';
import { getCandidateYearsOfExperience } from './validator.js';
import { wrapUntrusted } from '../safety.js';

export const GeneratedCoverLetterSchema = z.object({
  subject: z.string().min(1),
  body: z.string().min(1),
});

export type GeneratedCoverLetter = z.infer<typeof GeneratedCoverLetterSchema>;

export interface CoverLetterJobParams {
  title: string;
  company: string;
  description: string;
}

export interface CoverLetterGenerationParams {
  profile: Profile;
  job: CoverLetterJobParams;
  previousErrors?: string[] | undefined;
}

export interface CoverLetterGenerator {
  generate(params: CoverLetterGenerationParams): Promise<GeneratedCoverLetter>;
}

export function buildCoverLetterPrompt(params: CoverLetterGenerationParams): string {
  const { profile, job, previousErrors } = params;
  const yearsExp = getCandidateYearsOfExperience(profile);

  const profileSummary = [
    `Name: ${profile.name}`,
    `Email: ${profile.email}`,
    `Total Years of Experience: ${yearsExp}`,
    `Skills: ${profile.skills.join(', ')}`,
    'Work Experience:',
    ...(profile.experience || []).map(
      (e) =>
        `- ${e.title} at ${e.company} (${e.start_date} to ${e.current ? 'Present' : (e.end_date ?? '')}): ${e.description || ''} ${
          e.highlights ? `[Highlights: ${e.highlights.join('; ')}]` : ''
        }`,
    ),
    'Education:',
    ...(profile.education || []).map(
      (ed) =>
        `- ${ed.degree} in ${ed.field_of_study || ''} from ${ed.institution} (${ed.start_date || ''} - ${ed.end_date || ''})`,
    ),
  ].join('\n');

  let errorFeedback = '';
  if (previousErrors && previousErrors.length > 0) {
    errorFeedback = `
IMPORTANT: Your previous draft failed validation with the following errors:
${previousErrors.map((err) => `- ${err}`).join('\n')}
You MUST fix every single one of these errors in your new draft.
`;
  }

  const postingBody = `Job Title: ${job.title}
Company: ${job.company}
Description:
${job.description.slice(0, 4000)}`;

  return `You are an expert career advisor writing a grounded, authentic cover letter.

CANDIDATE PROFILE (TRUE FACTS ONLY):
${profileSummary}

${wrapUntrusted(postingBody, 'job_posting')}
${errorFeedback}
STRICT WRITING RULES:
1. Exact Company Name: Must include "${job.company}" exactly as written.
2. Exact Job Title: Must include "${job.title}".
3. Word Count: Plain text between 150 and 250 words. Count your words carefully.
4. Sign-off: Sign off with the candidate's exact name "${profile.name}".
5. Truthful & Grounded: Mention ONLY skills, employers, and experience that appear in the candidate profile. Do NOT invent or hallucinate any other technologies (e.g. do not mention Rust, Python, AWS, Docker unless explicitly listed in candidate skills).
6. Experience Claims: If you mention years of experience, it must match ${yearsExp} years.
7. No Placeholders: Absolutely no brackets or placeholders like [Name], {{company}}, <role>.
8. No Salary: Never mention salary figures, compensation, or CTC.
9. No Clichés: Avoid generic phrases such as "I am writing to apply", "I believe I am the ideal candidate", "to whom it may concern".
10. Output Format: Output ONLY valid JSON with keys "subject" and "body". No markdown formatting or extra text.

Example JSON output format:
{
  "subject": "Application for ${job.title} - ${profile.name}",
  "body": "Dear Hiring Team at ${job.company}, ... Sincerely, ${profile.name}"
}`;
}

function extractJson(text: string): string {
  const trimmed = text.trim();
  // Strip markdown code fences if present
  const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (match && match[1]) {
    return match[1].trim();
  }
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

export class DefaultCoverLetterGenerator implements CoverLetterGenerator {
  constructor(private readonly llm: LLMClient) {}

  async generate(params: CoverLetterGenerationParams): Promise<GeneratedCoverLetter> {
    const prompt = buildCoverLetterPrompt(params);
    const rawResponse = await this.llm.generateText(prompt);

    const jsonStr = extractJson(rawResponse);
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (err) {
      throw new Error(
        `Cover letter LLM returned invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const validated = GeneratedCoverLetterSchema.safeParse(parsed);
    if (!validated.success) {
      throw new Error(`Cover letter LLM output schema invalid: ${validated.error.message}`);
    }

    return validated.data;
  }
}
