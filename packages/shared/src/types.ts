export type ApplyRoute = 'auto_email' | 'manual_portal' | 'manual_review';

export interface HealthResponse {
  ok: true;
  dryRun: boolean;
  env: string;
}

export interface ErrorResponse {
  error: string;
}

export interface JobItem {
  id: string;
  title: string;
  company: string;
  location?: string;
  description: string;
  url: string;
  source: string;
  applyRoute: ApplyRoute;
  contactEmail?: string;
}

export interface JobSource {
  name: string;
  fetchJobs(): Promise<JobItem[]>;
}

export interface EmailSender {
  sendEmail(params: {
    to: string;
    subject: string;
    body: string;
    attachments?: Array<{ filename: string; content: Uint8Array; mimeType: string }>;
  }): Promise<{ messageId: string }>;
}

export interface SheetsClient {
  appendRow(sheetName: string, row: Record<string, unknown>): Promise<void>;
}

export interface LLMClient {
  generateText(prompt: string): Promise<string>;
}

export interface ContactFinder {
  findContact(domainOrCompany: string): Promise<string | null>;
}

export interface Notifier {
  notify(message: string): Promise<void>;
}
