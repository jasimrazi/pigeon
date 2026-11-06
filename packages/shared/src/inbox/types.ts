import type { D1LikeDatabase } from '../state-machine.js';
import type { KVLike } from '../google/auth.js';
import type { GmailSender } from '../google/types.js';
import type { Notifier } from '../notifier.js';
import type { Profile } from '../profile.js';
import type { LLMClient } from '../types.js';

export type MessageClassificationType = 'bounce' | 'auto_reply' | 'reply' | 'sent_by_user';

export type OutcomeLabel = 'interview' | 'rejection' | 'other';

export interface ClassificationResult {
  type: MessageClassificationType;
  label?: OutcomeLabel | undefined;
  confidence?: 'high' | 'medium' | 'low' | undefined;
  reason: string;
}

export interface ThreadMessage {
  id: string;
  threadId: string;
  snippet?: string | undefined;
  headers: Record<string, string>; // normalized lowercase header names
}

export interface ClassifierContext {
  userEmail?: string | undefined;
  jobTitle?: string | undefined;
  company?: string | undefined;
}

export interface InboxClassifier {
  classify(message: ThreadMessage, context?: ClassifierContext): Promise<ClassificationResult>;
}

export interface PollerOptions {
  db: D1LikeDatabase;
  config: KVLike;
  gmailClient?: GmailSender | undefined;
  gmailSender?: GmailSender | undefined;
  classifier?: InboxClassifier | undefined;
  llmClient?: LLMClient | undefined;
  notifier?: Notifier | undefined;
  profile?: Profile | undefined;
  nowMs?: number | undefined;
  maxDaysOld?: number | undefined; // default 30
}

export interface PollerResult {
  success: boolean;
  paused?: boolean | undefined;
  reason?: string | undefined;
  threadsPolled: number;
  threadsChanged: number;
  bouncesDetected: number;
  repliesDetected: number;
  interviewsDetected: number;
  rejectionsDetected: number;
  autoRepliesIgnored: number;
  followUpsCreated: number;
  // Ergonomic aliases
  polledThreads: number;
  bouncedCount: number;
  repliedCount: number;
  autoReplyCount: number;
  unchangedThreads: number;
  skippedAuthInvalid: boolean;
  error?: string | undefined;
}

export interface FollowUpOptions {
  db: D1LikeDatabase;
  profile: Profile;
  nowMs?: number | undefined;
  businessDaysThreshold?: number | undefined; // default 6
  maxFollowUps?: number | undefined; // default 1
}

export interface FollowUpResult {
  createdCount: number;
  applicationIds: string[];
}
