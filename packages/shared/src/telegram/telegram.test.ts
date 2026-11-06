import { describe, it, expect, vi } from 'vitest';
import { TelegramNotifier, isIstQuietHours } from './telegram-notifier.js';
import type { KVLike } from '../google/auth.js';

describe('TelegramNotifier', () => {
  function createMockKv(): KVLike & { store: Map<string, string> } {
    const store = new Map<string, string>();
    return {
      store,
      async get(key: string) {
        return store.get(key) ?? null;
      },
      async put(key: string, val: string) {
        store.set(key, val);
      },
      async delete(key: string) {
        store.delete(key);
      },
    };
  }

  describe('isIstQuietHours', () => {
    it('correctly identifies quiet hours in IST (22:00 to 07:00 IST)', () => {
      // 22:30 IST = 17:00 UTC
      const quietNight = new Date('2026-11-06T17:00:00Z');
      expect(isIstQuietHours(quietNight)).toBe(true);

      // 03:00 IST = 21:30 UTC (prev day)
      const quietMorning = new Date('2026-11-05T21:30:00Z');
      expect(isIstQuietHours(quietMorning)).toBe(true);

      // 06:59 IST = 01:29 UTC
      const quietDawn = new Date('2026-11-06T01:29:00Z');
      expect(isIstQuietHours(quietDawn)).toBe(true);

      // 07:00 IST = 01:30 UTC (Day starts)
      const dayStart = new Date('2026-11-06T01:30:00Z');
      expect(isIstQuietHours(dayStart)).toBe(false);

      // 14:00 IST = 08:30 UTC
      const dayMid = new Date('2026-11-06T08:30:00Z');
      expect(isIstQuietHours(dayMid)).toBe(false);

      // 21:59 IST = 16:29 UTC
      const rightBeforeQuiet = new Date('2026-11-06T16:29:00Z');
      expect(isIstQuietHours(rightBeforeQuiet)).toBe(false);
    });
  });

  describe('Notification delivery, deduplication and quiet hours', () => {
    it('is a clean no-op when Telegram is not configured', async () => {
      const fetchMock = vi.fn();
      const notifier = new TelegramNotifier({
        botToken: undefined,
        chatId: undefined,
        fetchFn: fetchMock as unknown as typeof fetch,
      });

      await notifier.notify({ key: 'reply:123', message: 'New reply from employer' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('sends message via Telegram REST API when configured and outside quiet hours', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
      // 12:00 UTC = 17:30 IST (daytime)
      const daytime = new Date('2026-11-06T12:00:00Z');

      const notifier = new TelegramNotifier({
        botToken: 'test-bot-token',
        chatId: '123456789',
        fetchFn: fetchMock as unknown as typeof fetch,
        now: () => daytime,
      });

      await notifier.notify({
        key: 'interview:app-1',
        message: 'Interview invitation received from Stripe',
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const call = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(call).toBeDefined();
      const [url, init] = call;
      expect(url).toBe('https://api.telegram.org/bottest-bot-token/sendMessage');
      expect(init.method).toBe('POST');
      const body = JSON.parse(String(init.body));
      expect(body.chat_id).toBe('123456789');
      expect(body.text).toContain('Interview invitation received from Stripe');
    });

    it('fires once per event dedupe key (deduplication)', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
      const kv = createMockKv();
      const daytime = new Date('2026-11-06T12:00:00Z');

      const notifier = new TelegramNotifier({
        botToken: 'test-bot-token',
        chatId: '123456789',
        kv,
        fetchFn: fetchMock as unknown as typeof fetch,
        now: () => daytime,
      });

      // First call
      await notifier.notify({
        key: 'circuit_open:adzuna',
        message: 'Circuit breaker opened for adzuna',
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Second call with same key -> deduplicated!
      await notifier.notify({
        key: 'circuit_open:adzuna',
        message: 'Circuit breaker opened for adzuna',
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // New instance with same KV -> also deduplicated!
      const notifier2 = new TelegramNotifier({
        botToken: 'test-bot-token',
        chatId: '123456789',
        kv,
        fetchFn: fetchMock as unknown as typeof fetch,
        now: () => daytime,
      });
      await notifier2.notify({
        key: 'circuit_open:adzuna',
        message: 'Circuit breaker opened for adzuna',
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('suppresses non-critical notifications during quiet hours (22:00 to 07:00 IST)', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
      // 23:00 IST = 17:30 UTC (quiet hours!)
      const quietTime = new Date('2026-11-06T17:30:00Z');

      const notifier = new TelegramNotifier({
        botToken: 'test-bot-token',
        chatId: '123456789',
        fetchFn: fetchMock as unknown as typeof fetch,
        now: () => quietTime,
      });

      // Standard events are suppressed
      await notifier.notify({ key: 'reply:app-1', message: 'New reply' });
      await notifier.notify({ key: 'interview:app-2', message: 'Interview request' });
      await notifier.notify({ key: 'parser_suspect:naukri', message: 'Parser suspect' });
      await notifier.notify({ key: 'circuit_open:lever', message: 'Circuit open' });
      await notifier.notify({ key: 'manual_queue_digest:2026-11-06', message: 'Daily digest' });
      await notifier.notify({ key: 'send_failure_rate_above_20', message: 'Failure rate spike' });

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('bypasses quiet hours for critical events: auth_invalid and bounce_spike', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
      // 02:00 IST = 20:30 UTC (middle of the night quiet hours)
      const middleOfNight = new Date('2026-11-06T20:30:00Z');

      const notifier = new TelegramNotifier({
        botToken: 'test-bot-token',
        chatId: '123456789',
        fetchFn: fetchMock as unknown as typeof fetch,
        now: () => middleOfNight,
      });

      // 1. auth_invalid fires despite quiet hours
      await notifier.notify({
        key: 'auth_invalid',
        message: 'Google OAuth token expired or revoked! Immediate attention required.',
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const call1 = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(call1).toBeDefined();
      const body1 = JSON.parse(String(call1[1].body));
      expect(body1.text).toContain('Google OAuth token expired');

      // 2. bounce_spike fires despite quiet hours
      await notifier.notify({
        key: 'bounce_spike:2026-11-06',
        message: 'Bounce rate exceeded safety threshold! Brakes applied.',
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const call2 = fetchMock.mock.calls[1] as [string, RequestInit];
      expect(call2).toBeDefined();
      const body2 = JSON.parse(String(call2[1].body));
      expect(body2.text).toContain('Bounce rate exceeded safety threshold');
    });
  });
});
