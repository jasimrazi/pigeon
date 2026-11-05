import type { D1LikeDatabase } from './state-machine.js';

export interface NotificationPayload {
  key: string;
  message: string;
  details?: Record<string, unknown> | undefined;
}

export interface Notifier {
  notify(payload: string | NotificationPayload): Promise<void>;
}

export class EventsNotifier implements Notifier {
  private readonly db?: D1LikeDatabase | undefined;

  constructor(db?: D1LikeDatabase) {
    this.db = db;
  }

  async notify(input: string | NotificationPayload): Promise<void> {
    const payload: NotificationPayload =
      typeof input === 'string' ? { key: 'default', message: input } : input;

    console.warn(`[Pigeon Notifier] [${payload.key}]: ${payload.message}`, payload.details ?? '');

    if (this.db) {
      const nowIso = new Date().toISOString();
      const eventId = crypto.randomUUID();
      await this.db
        .prepare(
          `INSERT INTO events (id, entity, entity_id, type, payload, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          eventId,
          'notification',
          payload.key,
          'notification_sent',
          JSON.stringify(payload),
          nowIso,
        )
        .run();
    }
  }
}
