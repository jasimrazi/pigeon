import { buildMimeMessage, toBase64Url } from './mime.js';
import type { GmailSender, SendEmailParams, SendEmailResult } from './types.js';

export class GoogleRateLimitError extends Error {
  constructor(message = 'Rate limit exceeded') {
    super(message);
    this.name = 'GoogleRateLimitError';
  }
}

export class GoogleServerError extends Error {
  constructor(
    public readonly status: number,
    message = 'Google server error',
  ) {
    super(message);
    this.name = 'GoogleServerError';
  }
}

export class GoogleRecipientError extends Error {
  constructor(
    public readonly status: number,
    message = 'Permanent recipient error',
  ) {
    super(message);
    this.name = 'GoogleRecipientError';
  }
}

export class RestGmailSender implements GmailSender {
  constructor(private readonly getAccessToken: () => Promise<string>) {}

  async send(params: SendEmailParams): Promise<SendEmailResult> {
    const token = await this.getAccessToken();
    const mimeString = buildMimeMessage(params);
    const raw = toBase64Url(mimeString);

    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw }),
    });

    if (res.ok) {
      const data = (await res.json()) as { id: string; threadId: string };
      return {
        gmailMessageId: data.id,
        gmailThreadId: data.threadId,
      };
    }

    const errJson = (await res.json().catch(() => ({}))) as {
      error?: { message?: string; status?: string; code?: number };
    };
    const errMsg = errJson.error?.message || `Gmail API send failed with status ${res.status}`;

    if (res.status === 401) {
      const error = new Error(errMsg);
      error.name = 'GoogleAuthError';
      throw error;
    }

    if (res.status === 429) {
      throw new GoogleRateLimitError(errMsg);
    }

    if (res.status >= 500) {
      throw new GoogleServerError(res.status, errMsg);
    }

    // Permanent 4xx client/recipient error
    throw new GoogleRecipientError(res.status, errMsg);
  }

  async searchSentByMessageId(
    messageIdHeader: string,
  ): Promise<{ gmailMessageId: string; gmailThreadId: string } | null> {
    const token = await this.getAccessToken();
    const cleanId = messageIdHeader.replace(/^<|>$/g, '').trim();

    const query = encodeURIComponent(`rfc822msgid:${cleanId}`);
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      return null;
    }

    const data = (await res.json()) as {
      messages?: Array<{ id: string; threadId: string }>;
    };

    if (data.messages && data.messages.length > 0 && data.messages[0]) {
      return {
        gmailMessageId: data.messages[0].id,
        gmailThreadId: data.messages[0].threadId,
      };
    }

    return null;
  }
}
