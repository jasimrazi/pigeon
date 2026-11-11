import type { LLMClient } from '../types.js';

export interface WorkersAiBindingLike {
  run(model: string, options: unknown): Promise<unknown>;
}

export type CloudflareAiBinding = WorkersAiBindingLike;

export class WorkersAiClient implements LLMClient {
  private readonly ai: WorkersAiBindingLike;
  private readonly model: string;

  constructor(ai: WorkersAiBindingLike, model: string = '@cf/meta/llama-3.1-8b-instruct') {
    this.ai = ai;
    this.model = model;
  }

  async generateText(prompt: string): Promise<string> {
    const response = (await this.ai.run(this.model, {
      messages: [
        {
          role: 'system',
          content:
            'You are a strict, analytical job applicant fit evaluator. Output strictly JSON with no surrounding markdown or explanation.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
    })) as { response?: string } | string;

    if (typeof response === 'string') {
      return response;
    }
    return response?.response ?? JSON.stringify(response);
  }
}

export class GeminiClient implements LLMClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchFn: typeof fetch;

  constructor(apiKey: string, model: string = 'gemini-2.0-flash', fetchFn: typeof fetch = fetch) {
    this.apiKey = apiKey;
    this.model = model;
    this.fetchFn = fetchFn;
  }

  async generateText(prompt: string): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    const res = await this.fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini API error (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };

    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  }
}

export class MockLLMClient implements LLMClient {
  private responses: string[];
  public calls: string[] = [];

  constructor(responses?: string | string[]) {
    if (!responses) {
      this.responses = [];
    } else {
      this.responses = Array.isArray(responses) ? [...responses] : [responses];
    }
  }

  setResponses(responses: string | string[]): void {
    this.responses = Array.isArray(responses) ? [...responses] : [responses];
    this.calls = [];
  }

  async generateText(prompt: string): Promise<string> {
    this.calls.push(prompt);
    const nextResp =
      this.responses.shift() ??
      JSON.stringify({
        score: 85,
        matched_skills: ['TypeScript', 'SQL'],
        missing_skills: [],
        red_flags: [],
        reasons: 'Strong technical fit with profile skills and experience.',
      });
    return nextResp;
  }
}

export function createLLMClient(config: {
  provider?: string | undefined;
  ai?: WorkersAiBindingLike | undefined;
  aiBinding?: WorkersAiBindingLike | undefined;
  geminiApiKey?: string | undefined;
  mockClient?: LLMClient | undefined;
  model?: string | undefined;
}): LLMClient {
  if (config.mockClient) {
    return config.mockClient;
  }
  if (config.provider === 'gemini' && config.geminiApiKey) {
    return new GeminiClient(config.geminiApiKey, config.model ?? 'gemini-2.0-flash');
  }
  const ai = config.ai ?? config.aiBinding;
  if (ai) {
    return new WorkersAiClient(ai, config.model ?? '@cf/meta/llama-3.1-8b-instruct');
  }
  throw new Error(
    `Cannot create LLMClient: provider is '${config.provider}', but missing binding or API key.`,
  );
}
