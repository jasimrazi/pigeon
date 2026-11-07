import { GoogleRateLimitError } from '../google/sender.js';
import { GoogleAuthError } from '../google/auth.js';
import { APPLICATION_STATUSES } from '../state-machine.js';
import { SHEET_COLUMNS } from './sanitizer.js';
import {
  type EnsureSheetResult,
  type BatchUpdateValuesOptions,
  type AppendValuesOptions,
  type SheetsClient,
  type SpreadsheetMetadata,
  SpreadsheetMetadataSchema,
  SheetsValueRangeSchema,
  SheetsBatchUpdateResponseSchema,
  SheetsAppendResponseSchema,
} from './types.js';

export interface RestSheetsClientOptions {
  baseUrl?: string | undefined;
  fetchFn?: typeof fetch | undefined;
  maxRetries?: number | undefined;
  initialDelayMs?: number | undefined;
}

export class RestSheetsClient implements SheetsClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly maxRetries: number;
  private readonly initialDelayMs: number;

  constructor(
    private readonly getAccessToken: () => Promise<string>,
    options?: RestSheetsClientOptions,
  ) {
    this.baseUrl = options?.baseUrl || 'https://sheets.googleapis.com/v4/spreadsheets';
    this.fetchFn = options?.fetchFn || fetch;
    this.maxRetries = options?.maxRetries ?? 3;
    this.initialDelayMs = options?.initialDelayMs ?? 500;
  }

  private async requestWithRetry<T>(url: string, init: RequestInit): Promise<T> {
    let delay = this.initialDelayMs;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const token = await this.getAccessToken();
      const headers = new Headers(init.headers || {});
      headers.set('Authorization', `Bearer ${token}`);
      headers.set('Content-Type', 'application/json');

      const response = await this.fetchFn(url, {
        ...init,
        headers,
      });

      if (response.status === 429) {
        if (attempt === this.maxRetries) {
          throw new GoogleRateLimitError('Google Sheets API rate limit exceeded (429)');
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2;
        continue;
      }

      if (response.status === 401) {
        const text = await response.text();
        throw new GoogleAuthError('auth_invalid', `Google Sheets 401 Unauthorized: ${text}`, 401);
      }

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Sheets API error (${response.status}): ${errText}`);
      }

      return (await response.json()) as T;
    }

    throw new Error('Unexpected exit from request retry loop');
  }

  async getSpreadsheet(spreadsheetId: string): Promise<SpreadsheetMetadata> {
    const url = `${this.baseUrl}/${encodeURIComponent(spreadsheetId)}`;
    const raw = await this.requestWithRetry<unknown>(url, { method: 'GET' });
    return SpreadsheetMetadataSchema.parse(raw);
  }

  async ensureSheet(options?: {
    spreadsheetId?: string | undefined;
    title?: string | undefined;
    tabName?: string | undefined;
  }): Promise<EnsureSheetResult> {
    const tabName = options?.tabName || 'Applications';
    let spreadsheetId = options?.spreadsheetId;
    let sheetId = 0;
    let created = false;

    if (!spreadsheetId) {
      // 1. Create a brand new spreadsheet
      const createRes = await this.requestWithRetry<{
        spreadsheetId: string;
        sheets: Array<{ properties: { sheetId: number; title: string } }>;
      }>(this.baseUrl, {
        method: 'POST',
        body: JSON.stringify({
          properties: {
            title: options?.title || 'Pigeon Applications',
          },
          sheets: [
            {
              properties: {
                title: tabName,
                gridProperties: {
                  frozenRowCount: 1,
                },
              },
            },
          ],
        }),
      });

      spreadsheetId = createRes.spreadsheetId;
      sheetId = createRes.sheets[0]?.properties.sheetId ?? 0;
      created = true;
    } else {
      // 2. Fetch existing spreadsheet
      const metadata = await this.getSpreadsheet(spreadsheetId);
      const existingSheet = metadata.sheets.find((s) => s.properties.title === tabName);

      if (existingSheet) {
        sheetId = existingSheet.properties.sheetId;
      } else {
        // Add sheet tab
        const addRes = await this.requestWithRetry<{
          replies: Array<{ addSheet?: { properties: { sheetId: number } } }>;
        }>(`${this.baseUrl}/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
          method: 'POST',
          body: JSON.stringify({
            requests: [
              {
                addSheet: {
                  properties: {
                    title: tabName,
                    gridProperties: {
                      frozenRowCount: 1,
                    },
                  },
                },
              },
            ],
          }),
        });
        sheetId = addRes.replies[0]?.addSheet?.properties.sheetId ?? 0;
      }
    }

    // 3. Write header row if needed (A1:Q1)
    const headerRange = `${tabName}!A1:Q1`;
    await this.requestWithRetry(
      `${this.baseUrl}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(headerRange)}?valueInputOption=RAW`,
      {
        method: 'PUT',
        body: JSON.stringify({
          range: headerRange,
          majorDimension: 'ROWS',
          values: [SHEET_COLUMNS],
        }),
      },
    );

    // 4. Format sheet: freeze header row, add basic filter, hide column A, add status dropdown
    const requests: unknown[] = [
      // Freeze row 1
      {
        updateSheetProperties: {
          properties: {
            sheetId,
            gridProperties: {
              frozenRowCount: 1,
            },
          },
          fields: 'gridProperties.frozenRowCount',
        },
      },
      // Basic filter on A1:Q
      {
        setBasicFilter: {
          filter: {
            range: {
              sheetId,
              startRowIndex: 0,
              startColumnIndex: 0,
              endColumnIndex: SHEET_COLUMNS.length,
            },
          },
        },
      },
      // Status dropdown validation on Column N (index 13)
      {
        setDataValidation: {
          range: {
            sheetId,
            startRowIndex: 1,
            startColumnIndex: 13,
            endColumnIndex: 14,
          },
          rule: {
            condition: {
              type: 'ONE_OF_LIST',
              values: APPLICATION_STATUSES.map((status) => ({ userEnteredValue: status })),
            },
            showCustomUi: true,
            strict: true,
          },
        },
      },
      // Hide Column A (Application ID)
      {
        updateDimensionProperties: {
          range: {
            sheetId,
            dimension: 'COLUMNS',
            startIndex: 0,
            endIndex: 1,
          },
          properties: {
            hiddenByUser: true,
          },
          fields: 'hiddenByUser',
        },
      },
    ];

    try {
      await this.requestWithRetry(
        `${this.baseUrl}/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
        {
          method: 'POST',
          body: JSON.stringify({ requests }),
        },
      );
    } catch (err) {
      // If basic filter or styling fails because it already exists, proceed safely
      console.warn('Non-fatal styling error in ensureSheet:', err);
    }

    return {
      spreadsheetId,
      sheetId,
      created,
    };
  }

  async readRowKeys(options: { spreadsheetId: string; range: string }): Promise<string[]> {
    const { spreadsheetId, range } = options;
    const url = `${this.baseUrl}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`;
    const raw = await this.requestWithRetry<unknown>(url, {
      method: 'GET',
    });
    const res = SheetsValueRangeSchema.parse(raw);

    if (!res.values || res.values.length === 0) {
      return [];
    }

    return res.values.map((row) => (row[0] !== undefined && row[0] !== null ? String(row[0]) : ''));
  }

  async batchUpdateValues(options: BatchUpdateValuesOptions): Promise<{ updatedRows: number }> {
    const { spreadsheetId, data, valueInputOption = 'RAW' } = options;
    const url = `${this.baseUrl}/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`;

    const raw = await this.requestWithRetry<unknown>(url, {
      method: 'POST',
      body: JSON.stringify({
        valueInputOption,
        data,
      }),
    });
    const res = SheetsBatchUpdateResponseSchema.parse(raw);

    return { updatedRows: res.totalUpdatedRows ?? data.length };
  }

  async appendValues(options: AppendValuesOptions): Promise<{ updatedRows: number }> {
    const { spreadsheetId, range, values, valueInputOption = 'RAW' } = options;
    const url = `${this.baseUrl}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append?valueInputOption=${valueInputOption}&insertDataOption=INSERT_ROWS`;

    const raw = await this.requestWithRetry<unknown>(url, {
      method: 'POST',
      body: JSON.stringify({ values }),
    });
    const res = SheetsAppendResponseSchema.parse(raw);

    return { updatedRows: res.updates?.updatedRows ?? values.length };
  }

  async appendRow(sheetName: string, row: Record<string, unknown>): Promise<void> {
    // Convenience helper matching earlier stub
    await this.appendValues({
      spreadsheetId: 'default',
      range: `${sheetName}!A:A`,
      values: [Object.values(row)],
    });
  }
}
