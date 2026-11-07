import { z } from 'zod';

export interface GoogleOAuthSecrets {
  clientId: string;
  clientSecret: string;
  tokenEncryptionKey: string;
  redirectUri?: string | undefined;
}

export interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string | undefined;
  scope?: string | undefined;
  token_type: string;
}

export interface GoogleTokenRefreshResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

export const GoogleTokenResponseSchema = z.object({
  access_token: z.string().max(4096),
  expires_in: z.number().int().min(0),
  refresh_token: z.string().max(4096).optional(),
  scope: z.string().max(4096).optional(),
  token_type: z.string().max(100),
});

export const GoogleTokenRefreshResponseSchema = z.object({
  access_token: z.string().max(4096),
  expires_in: z.number().int().min(0),
  token_type: z.string().max(100),
});

export const GmailHeaderSchema = z.object({
  name: z.string().max(500),
  value: z.string().max(10000),
});

export const GmailThreadMessagePayloadSchema = z.object({
  headers: z.array(GmailHeaderSchema).max(200).optional(),
  mimeType: z.string().max(200).optional(),
});

export const GmailThreadMessageSchema = z.object({
  id: z.string().max(100),
  threadId: z.string().max(100).optional(),
  snippet: z.string().max(5000).optional(),
  internalDate: z.string().max(100).optional(),
  payload: GmailThreadMessagePayloadSchema.optional(),
});

export const GmailThreadSchema = z.object({
  id: z.string().max(100),
  historyId: z.string().max(100).optional(),
  messages: z.array(GmailThreadMessageSchema).max(500).default([]),
});

export const GmailSearchMessagesResponseSchema = z.object({
  messages: z
    .array(
      z.object({
        id: z.string().max(100),
        threadId: z.string().max(100),
      }),
    )
    .max(100)
    .optional(),
  nextPageToken: z.string().max(1000).optional(),
});

export interface AuthHealthState {
  status: 'ok' | 'invalid' | 'unknown';
  checked_at: string;
  reason: string | null;
}

export interface SendEmailParams {
  fromEmail: string;
  fromName?: string | undefined;
  recipientEmail: string;
  subject: string;
  bodyText: string;
  messageIdHeader: string;
  resumePdfBytes?: Uint8Array | undefined;
  resumeFileName?: string | undefined;
  threadId?: string | undefined;
  inReplyTo?: string | undefined;
  references?: string | undefined;
}

export interface SendEmailResult {
  gmailMessageId: string;
  gmailThreadId: string;
}

export interface GmailThreadMessagePayload {
  headers?: Array<{ name: string; value: string }> | undefined;
  mimeType?: string | undefined;
}

export interface GmailThreadMessage {
  id: string;
  threadId?: string | undefined;
  snippet?: string | undefined;
  internalDate?: string | undefined;
  payload?: GmailThreadMessagePayload | undefined;
}

export interface GmailThread {
  id: string;
  historyId?: string | undefined;
  messages: GmailThreadMessage[];
}

export interface GmailSender {
  send(params: SendEmailParams): Promise<SendEmailResult>;
  searchSentByMessageId(
    messageIdHeader: string,
  ): Promise<{ gmailMessageId: string; gmailThreadId: string } | null>;
  getThread?(
    threadId: string,
    format?: 'metadata' | 'full' | 'minimal',
  ): Promise<GmailThread | null>;
}

export interface GoogleProfileResponse {
  emailAddress: string;
  messagesTotal: number;
  threadsTotal: number;
  historyId: string;
}

export interface ApprovalResult {
  application_id: string;
  status: 'approved' | 'rejected';
  reason?: string | undefined;
}

export interface BulkApprovalResult {
  approved: string[];
  rejected: Array<{ id: string; reason: string }>;
}
