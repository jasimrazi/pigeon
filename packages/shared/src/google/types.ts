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

export interface AuthHealthState {
  status: 'ok' | 'invalid';
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
}

export interface SendEmailResult {
  gmailMessageId: string;
  gmailThreadId: string;
}

export interface GmailSender {
  send(params: SendEmailParams): Promise<SendEmailResult>;
  searchSentByMessageId(
    messageIdHeader: string,
  ): Promise<{ gmailMessageId: string; gmailThreadId: string } | null>;
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
