import type { KVLike } from '../google/auth.js';
import type { NotificationPayload, Notifier } from '../notifier.js';

export interface TelegramNotifierOptions {
  botToken?: string | undefined;
  chatId?: string | undefined;
  kv?: KVLike | undefined;
  now?: () => Date;
  fetchFn?: typeof fetch | undefined;
}

/**
 * Checks if the given date falls into IST quiet hours (22:00 to 07:00 IST).
 * IST is UTC + 5:30.
 */
export function isIstQuietHours(date: Date = new Date()): boolean {
  const istOffsetMs = (5 * 60 + 30) * 60 * 1000;
  const istTime = new Date(date.getTime() + istOffsetMs);
  const istHours = istTime.getUTCHours();
  return istHours >= 22 || istHours < 7;
}

/**
 * Critical notification types that bypass quiet hours.
 */
const QUIET_HOURS_EXEMPT_PREFIXES = ['auth_invalid', 'bounce_spike'];

function isQuietHoursExempt(key: string): boolean {
  return QUIET_HOURS_EXEMPT_PREFIXES.some(
    (prefix) => key === prefix || key.startsWith(`${prefix}:`) || key.startsWith(`${prefix}_`),
  );
}

export class TelegramNotifier implements Notifier {
  private readonly botToken?: string | undefined;
  private readonly chatId?: string | undefined;
  private readonly kv?: KVLike | undefined;
  private readonly now: () => Date;
  private readonly fetchFn: typeof fetch;
  private readonly sentKeysInMemory: Set<string> = new Set();

  constructor(options: TelegramNotifierOptions = {}) {
    this.botToken = options.botToken;
    this.chatId = options.chatId;
    this.kv = options.kv;
    this.now = options.now ?? (() => new Date());
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  async notify(input: string | NotificationPayload): Promise<void> {
    const payload: NotificationPayload =
      typeof input === 'string' ? { key: 'default', message: input } : input;

    // 1. Unconfigured Telegram: no-op
    if (!this.botToken || !this.chatId) {
      return;
    }

    const key = payload.key || 'default';

    // 2. Dedupe: fire once per event
    if (this.sentKeysInMemory.has(key)) {
      return;
    }

    const kvKey = `telegram_dedupe:${key}`;
    if (this.kv) {
      const alreadySent = await this.kv.get(kvKey);
      if (alreadySent) {
        this.sentKeysInMemory.add(key);
        return;
      }
    }

    // 3. Quiet hours check: 22:00 to 07:00 IST
    // Exempt types: auth_invalid and bounce_spike
    const currentDate = this.now();
    if (isIstQuietHours(currentDate) && !isQuietHoursExempt(key)) {
      return;
    }

    // 4. Send Telegram message
    const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
    const text = `[Pigeon] ${payload.message}`;

    try {
      const res = await this.fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.chatId,
          text,
        }),
      });

      if (!res.ok) {
        console.warn(`Telegram notification failed: status ${res.status}`);
        return;
      }

      // Mark as sent
      this.sentKeysInMemory.add(key);
      if (this.kv) {
        await this.kv.put(kvKey, currentDate.toISOString());
      }
    } catch (err) {
      console.warn('Error sending Telegram notification:', err);
    }
  }
}
