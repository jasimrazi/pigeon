import { getGoogleAuthHealth } from '../google/auth.js';
import { transition } from '../state-machine.js';
import { DefaultInboxClassifier } from './classifier.js';
import { createPendingFollowUps } from './follow-up.js';
import type { PollerOptions, PollerResult, ThreadMessage } from './types.js';

interface PolledApplicationRow {
  id: string;
  job_id: string;
  status: string;
  gmail_thread_id: string;
  sent_at: string;
  title: string;
  company: string;
  contact_email: string | null;
}

/**
 * Polls Gmail threads for sent email applications from the last 30 days.
 * Classifies new thread messages into bounces, auto-replies, and human replies
 * (interview, rejection, or other).
 *
 * Runs follow-up generator for applications with 6 business days elapsed and no reply.
 */
export async function pollInboxAndTrackOutcomes(options: PollerOptions): Promise<PollerResult> {
  const { db, config, notifier, profile, nowMs = Date.now(), maxDaysOld = 30 } = options;

  const gmailClient = options.gmailClient ?? options.gmailSender;
  const classifier = options.classifier ?? new DefaultInboxClassifier(options.llmClient);

  // 1. Auth Health Guard: Skip entirely if health is not ok
  const health = await getGoogleAuthHealth(config);
  if (health.status !== 'ok') {
    return {
      success: false,
      paused: true,
      skippedAuthInvalid: true,
      reason: `auth_invalid: ${health.reason || 'unauthorized'}`,
      threadsPolled: 0,
      threadsChanged: 0,
      bouncesDetected: 0,
      repliesDetected: 0,
      interviewsDetected: 0,
      rejectionsDetected: 0,
      autoRepliesIgnored: 0,
      followUpsCreated: 0,
      polledThreads: 0,
      bouncedCount: 0,
      repliedCount: 0,
      autoReplyCount: 0,
      unchangedThreads: 0,
    };
  }

  if (!gmailClient) {
    throw new Error('Missing gmailClient / gmailSender in PollerOptions');
  }

  const nowIso = new Date(nowMs).toISOString();
  const dateStr = nowIso.slice(0, 10);
  const cutoffIso = new Date(nowMs - maxDaysOld * 24 * 60 * 60 * 1000).toISOString();

  // 2. Select email applications sent in the last 30 days with a thread ID
  const query = `
    SELECT
      a.id, a.job_id, a.status, a.gmail_thread_id, a.sent_at,
      j.title, j.company, j.contact_email
    FROM applications a
    JOIN jobs j ON a.job_id = j.id
    WHERE a.channel = 'email'
      AND a.gmail_thread_id IS NOT NULL
      AND a.status IN ('sent', 'replied')
      AND a.sent_at >= ?
    ORDER BY a.sent_at DESC
  `;

  const { results: rawApps } = await db.prepare(query).bind(cutoffIso).all<PolledApplicationRow>();
  const apps = rawApps || [];

  let threadsPolled = 0;
  let threadsChanged = 0;
  let bouncesDetected = 0;
  let repliesDetected = 0;
  let interviewsDetected = 0;
  let rejectionsDetected = 0;
  let autoRepliesIgnored = 0;

  for (const app of apps) {
    const threadId = app.gmail_thread_id;
    if (!threadId || typeof gmailClient.getThread !== 'function') {
      continue;
    }

    let thread;
    try {
      thread = await gmailClient.getThread(threadId, 'metadata');
    } catch (err) {
      console.warn(`Failed to fetch thread ${threadId}:`, err);
      continue;
    }

    if (!thread) {
      continue;
    }

    threadsPolled++;

    const messages = thread.messages || [];
    const currentCount = messages.length;

    // Check cached message count in KV
    const countKey = `gmail_thread_count:${threadId}`;
    const lastCountStr = await config.get(countKey);
    const lastCount = lastCountStr ? Number.parseInt(lastCountStr, 10) : 1;

    // Process only threads that changed
    if (currentCount <= lastCount) {
      continue;
    }

    threadsChanged++;
    const newMessages = messages.slice(lastCount);

    for (const msg of newMessages) {
      // Normalize headers to lowercase keys
      const headersMap: Record<string, string> = {};
      for (const h of msg.payload?.headers || []) {
        if (h.name && h.value) {
          headersMap[h.name.toLowerCase()] = h.value;
        }
      }

      const threadMsg: ThreadMessage = {
        id: msg.id,
        threadId: msg.threadId || threadId,
        snippet: msg.snippet,
        headers: headersMap,
      };

      const result = await classifier.classify(threadMsg, {
        userEmail: profile?.email,
        jobTitle: app.title,
        company: app.company,
      });

      if (result.type === 'sent_by_user') {
        continue;
      }

      if (result.type === 'bounce') {
        bouncesDetected++;

        // 1. Transition application to bounced
        await transition(db, 'application', app.id, 'bounced', result.reason);

        // 2. Add contact_email to do_not_contact
        if (app.contact_email) {
          await db
            .prepare(
              `INSERT OR IGNORE INTO do_not_contact (value, reason, created_at)
               VALUES (?, 'email_bounced', ?)`,
            )
            .bind(app.contact_email.toLowerCase().trim(), nowIso)
            .run();
        }

        // 3. Increment daily_counters.bounces
        await db
          .prepare(
            `INSERT INTO daily_counters (date, sends, bounces)
             VALUES (?, 0, 1)
             ON CONFLICT(date) DO UPDATE SET bounces = bounces + 1`,
          )
          .bind(dateStr)
          .run();

        // 4. Notify once per application and event
        const notifyKey = `notified:bounce:${app.id}`;
        const alreadyNotified = await config.get(notifyKey);
        if (alreadyNotified !== 'true') {
          if (notifier) {
            await notifier.notify({
              key: `bounce:${app.id}`,
              message: `Email to ${app.company} (${app.contact_email || 'unknown'}) bounced: ${result.reason}`,
            });
          }
          await config.put(notifyKey, 'true');
        }

        break; // Stop processing further messages for a bounced thread
      }

      if (result.type === 'auto_reply') {
        autoRepliesIgnored++;
        continue; // Ignored, not counted as reply
      }

      if (result.type === 'reply') {
        repliesDetected++;

        if (result.label === 'interview') {
          interviewsDetected++;

          // Transition: sent -> replied -> interview
          if (app.status === 'sent') {
            await transition(db, 'application', app.id, 'replied', 'INTERVIEW_INVITATION_RECEIVED');
          }
          await transition(db, 'application', app.id, 'interview', result.reason);

          // Notify once
          const notifyKey = `notified:interview:${app.id}`;
          const alreadyNotified = await config.get(notifyKey);
          if (alreadyNotified !== 'true') {
            if (notifier) {
              await notifier.notify({
                key: `interview:${app.id}`,
                message: `Interview invitation received from ${app.company} for ${app.title}!`,
              });
            }
            await config.put(notifyKey, 'true');
          }
        } else if (result.label === 'rejection') {
          rejectionsDetected++;

          // Transition: sent -> replied -> rejected
          if (app.status === 'sent') {
            await transition(db, 'application', app.id, 'replied', 'REJECTION_NOTICE_RECEIVED');
          }
          await transition(db, 'application', app.id, 'rejected', result.reason);
        } else {
          // General / Ambiguous human reply -> status stays replied
          if (app.status === 'sent') {
            await transition(db, 'application', app.id, 'replied', result.reason);
          }

          // Notify once
          const notifyKey = `notified:replied:${app.id}`;
          const alreadyNotified = await config.get(notifyKey);
          if (alreadyNotified !== 'true') {
            if (notifier) {
              await notifier.notify({
                key: `replied:${app.id}`,
                message: `New reply received from ${app.company} for ${app.title}`,
              });
            }
            await config.put(notifyKey, 'true');
          }
        }
      }
    }

    // Update stored message count in KV
    await config.put(countKey, String(currentCount));
  }

  // 3. Follow-up Processing
  let followUpsCreated = 0;
  if (profile) {
    const followUpRes = await createPendingFollowUps({
      db,
      profile,
      nowMs,
      businessDaysThreshold: 6,
      maxFollowUps: 1,
    });
    followUpsCreated = followUpRes.createdCount;
  }

  return {
    success: true,
    threadsPolled,
    threadsChanged,
    bouncesDetected,
    repliesDetected,
    interviewsDetected,
    rejectionsDetected,
    autoRepliesIgnored,
    followUpsCreated,
    polledThreads: threadsPolled,
    bouncedCount: bouncesDetected,
    repliedCount: repliesDetected,
    autoReplyCount: autoRepliesIgnored,
    unchangedThreads: threadsPolled - threadsChanged,
    skippedAuthInvalid: false,
  };
}
