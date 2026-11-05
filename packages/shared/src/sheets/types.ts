import type { D1LikeDatabase } from '../state-machine.js';
import type { KVLike } from '../google/auth.js';
import type { Notifier } from '../notifier.js';

export interface SpreadsheetProperties {
  title: string;
}

export interface SheetGridProperties {
  rowCount?: number;
  columnCount?: number;
  frozenRowCount?: number;
  frozenColumnCount?: number;
}

export interface SheetProperties {
  sheetId: number;
  title: string;
  gridProperties?: SheetGridProperties;
}

export interface SheetMetadata {
  properties: SheetProperties;
  basicFilter?: unknown;
}

export interface SpreadsheetMetadata {
  spreadsheetId: string;
  properties: SpreadsheetProperties;
  sheets: SheetMetadata[];
}

export interface ValueRange {
  range: string;
  majorDimension?: 'ROWS' | 'COLUMNS';
  values?: unknown[][];
}

export interface EnsureSheetResult {
  spreadsheetId: string;
  sheetId: number;
  created: boolean;
}

export interface BatchUpdateValuesOptions {
  spreadsheetId: string;
  data: Array<{ range: string; values: unknown[][] }>;
  valueInputOption?: 'RAW' | 'USER_ENTERED';
}

export interface AppendValuesOptions {
  spreadsheetId: string;
  range: string;
  values: unknown[][];
  valueInputOption?: 'RAW' | 'USER_ENTERED';
}

export interface SheetsClient {
  ensureSheet(options?: {
    spreadsheetId?: string | undefined;
    title?: string | undefined;
    tabName?: string | undefined;
  }): Promise<EnsureSheetResult>;
  readRowKeys(options: { spreadsheetId: string; range: string }): Promise<string[]>;
  batchUpdateValues(options: BatchUpdateValuesOptions): Promise<{ updatedRows: number }>;
  appendValues(options: AppendValuesOptions): Promise<{ updatedRows: number }>;
  appendRow?(sheetName: string, row: Record<string, unknown>): Promise<void>;
  getSpreadsheet?(spreadsheetId: string): Promise<SpreadsheetMetadata>;
}

export interface ApplicationToSync {
  id: string;
  job_id: string;
  kind: string;
  channel: 'email' | 'manual';
  resume_id?: string | null;
  resume_label?: string | null;
  status: string;
  applied_at?: string | null;
  sent_at?: string | null;
  scheduled_at?: string | null;
  updated_at: string;
  notes?: string | null;
  title: string;
  company: string;
  source: string;
  apply_url?: string | null;
  location?: string | null;
  salary_raw?: string | null;
  salary_min?: number | null;
  salary_max?: number | null;
  currency?: string | null;
  contact_email?: string | null;
  match_score?: number | null;
  route_reason?: string | null;
}

export interface SyncOptions {
  db: D1LikeDatabase;
  config: KVLike;
  sheetsClient: SheetsClient;
  spreadsheetId?: string | undefined;
  tabName?: string | undefined;
  maxBatchSize?: number | undefined;
  notifier?: Notifier | undefined;
  nowMs?: number | undefined;
}

export interface SyncResult {
  success: boolean;
  paused?: boolean;
  reason?: string;
  syncedCount: number;
  updatedRows?: number;
  appendedRows?: number;
  error?: string;
}
