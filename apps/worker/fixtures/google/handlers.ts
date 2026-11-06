import { http, HttpResponse } from 'msw';

export const googleHandlers = [
  // Google OAuth2 Token Exchange & Refresh
  http.post('https://oauth2.googleapis.com/token', async ({ request }) => {
    const text = await request.text();
    const params = new URLSearchParams(text);
    const grantType = params.get('grant_type');

    if (grantType === 'authorization_code') {
      const code = params.get('code');
      if (code === 'invalid_code') {
        return HttpResponse.json(
          { error: 'invalid_grant', error_description: 'Code invalid' },
          { status: 400 },
        );
      }
      return HttpResponse.json({
        access_token: 'mock-access-token-xyz',
        refresh_token: 'mock-refresh-token-12345',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'gmail.send gmail.readonly spreadsheets',
      });
    }

    if (grantType === 'refresh_token') {
      const refreshToken = params.get('refresh_token');
      if (refreshToken === 'invalid_refresh_token') {
        return HttpResponse.json(
          { error: 'invalid_grant', error_description: 'Token expired or revoked' },
          { status: 400 },
        );
      }
      return HttpResponse.json({
        access_token: 'mock-refreshed-access-token-abc',
        expires_in: 3600,
        token_type: 'Bearer',
      });
    }

    return HttpResponse.json({ error: 'unsupported_grant_type' }, { status: 400 });
  }),

  // Gmail Profile Ping
  http.get('https://gmail.googleapis.com/gmail/v1/users/me/profile', ({ request }) => {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || authHeader.includes('invalid')) {
      return HttpResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    return HttpResponse.json({
      emailAddress: 'alex.mercer@example.com',
      messagesTotal: 42,
      threadsTotal: 10,
      historyId: '99999',
    });
  }),

  // Gmail Send Message
  http.post('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', async ({ request }) => {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || authHeader.includes('invalid')) {
      return HttpResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as { raw?: string };
    if (!body.raw) {
      return HttpResponse.json({ error: 'Missing raw message payload' }, { status: 400 });
    }

    return HttpResponse.json({
      id: 'mock-gmail-msg-id-777',
      threadId: 'mock-gmail-thread-id-888',
    });
  }),

  // Gmail Sent Search by rfc822msgid
  http.get('https://gmail.googleapis.com/gmail/v1/users/me/messages', ({ request }) => {
    const url = new URL(request.url);
    const q = url.searchParams.get('q');

    if (q && q.includes('already-sent-msg-id')) {
      return HttpResponse.json({
        messages: [{ id: 'mock-recovered-msg-id', threadId: 'mock-recovered-thread-id' }],
        resultSizeEstimate: 1,
      });
    }

    return HttpResponse.json({
      messages: [],
      resultSizeEstimate: 0,
    });
  }),

  // Gmail Get Thread by ID
  http.get('https://gmail.googleapis.com/gmail/v1/users/me/threads/:threadId', ({ request, params }) => {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || authHeader.includes('invalid')) {
      return HttpResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const threadId = params.threadId as string;
    const thread = mockThreadsStore.get(threadId);
    if (!thread) {
      return HttpResponse.json({ error: 'Thread not found' }, { status: 404 });
    }

    return HttpResponse.json(thread);
  }),
];

export const mockThreadsStore = new Map<string, unknown>();

export function resetMockThreadsStore() {
  mockThreadsStore.clear();
}
