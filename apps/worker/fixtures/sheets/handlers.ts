import { http, HttpResponse } from 'msw';

export interface MockSheetsStore {
  spreadsheetTitle: string;
  sheets: Array<{ sheetId: number; title: string }>;
  values: Map<string, unknown[][]>; // range -> 2D array
  batchUpdateCalls: number;
  lastBatchData: Array<{ range: string; values: unknown[][] }>;
  simulateRateLimit: boolean;
  simulateOutage: boolean;
  rateLimitCount: number;
}

export function createSheetsStore(): MockSheetsStore {
  const store: MockSheetsStore = {
    spreadsheetTitle: 'Pigeon Applications',
    sheets: [{ sheetId: 0, title: 'Applications' }],
    values: new Map<string, unknown[][]>(),
    batchUpdateCalls: 0,
    lastBatchData: [],
    simulateRateLimit: false,
    simulateOutage: false,
    rateLimitCount: 0,
  };

  // Seed header row
  store.values.set('Applications!A1:Q1', [
    [
      'Application ID',
      'Date',
      'Company',
      'Role',
      'Source',
      'Channel',
      'Job link',
      'Location',
      'Salary',
      'Contact email',
      'Resume used',
      'Match score',
      'Route reason',
      'Status',
      'Applied or sent at',
      'Last updated',
      'Notes',
    ],
  ]);

  // Seed column A with header
  store.values.set('Applications!A:A', [['Application ID']]);

  return store;
}

export let currentSheetsStore = createSheetsStore();

export function resetSheetsStore(): void {
  currentSheetsStore = createSheetsStore();
}

export const sheetsHandlers = [
  // 1. Create Spreadsheet
  http.post('https://sheets.googleapis.com/v4/spreadsheets', async ({ request }) => {
    if (currentSheetsStore.simulateOutage) {
      return new HttpResponse('503 Service Unavailable', { status: 503 });
    }
    const body = (await request.json()) as { properties?: { title?: string } };
    currentSheetsStore.spreadsheetTitle = body?.properties?.title || 'Pigeon Applications';
    return HttpResponse.json({
      spreadsheetId: 'mock-sheet-id-456',
      properties: { title: currentSheetsStore.spreadsheetTitle },
      sheets: currentSheetsStore.sheets.map((s) => ({ properties: s })),
    });
  }),

  // 2. Get Spreadsheet metadata
  http.get('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId', () => {
    if (currentSheetsStore.simulateOutage) {
      return new HttpResponse('503 Service Unavailable', { status: 503 });
    }
    return HttpResponse.json({
      spreadsheetId: 'mock-sheet-id-456',
      properties: { title: currentSheetsStore.spreadsheetTitle },
      sheets: currentSheetsStore.sheets.map((s) => ({ properties: s })),
    });
  }),

  // 3. Metadata batchUpdate (formatting, adding sheets, data validation, filters)
  http.post(/^https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/[^/]+:batchUpdate/, () => {
    if (currentSheetsStore.simulateOutage) {
      return new HttpResponse('503 Service Unavailable', { status: 503 });
    }
    return HttpResponse.json({
      replies: [{ addSheet: { properties: { sheetId: 10 } } }],
    });
  }),

  // 4. Get Values (e.g. Applications!A:A)
  http.get(
    /^https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/[^/]+\/values\/(.+)/,
    ({ request }) => {
      if (currentSheetsStore.simulateOutage) {
        return new HttpResponse('503 Service Unavailable', { status: 503 });
      }
      const url = new URL(request.url);
      const match = url.pathname.match(/\/values\/(.+)$/);
      const range = match?.[1] ? decodeURIComponent(match[1]) : '';

      const existing = currentSheetsStore.values.get(range);
      if (existing) {
        return HttpResponse.json({
          range,
          majorDimension: 'ROWS',
          values: existing,
        });
      }

      if (range.endsWith('!A:A')) {
        const colA = currentSheetsStore.values.get('Applications!A:A') || [['Application ID']];
        return HttpResponse.json({
          range,
          majorDimension: 'ROWS',
          values: colA,
        });
      }

      return HttpResponse.json({
        range,
        majorDimension: 'ROWS',
        values: [],
      });
    },
  ),

  // 5. Put Values (e.g. Applications!A1:Q1 header)
  http.put(
    /^https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/[^/]+\/values\/(.+)/,
    async ({ request }) => {
      if (currentSheetsStore.simulateOutage) {
        return new HttpResponse('503 Service Unavailable', { status: 503 });
      }
      const url = new URL(request.url);
      const match = url.pathname.match(/\/values\/(.+)$/);
      const range = match?.[1] ? decodeURIComponent(match[1]) : '';

      const body = (await request.json()) as { values?: unknown[][] };
      if (body?.values) {
        currentSheetsStore.values.set(range, body.values);
      }
      return HttpResponse.json({
        updatedRange: range,
        updatedRows: body?.values?.length ?? 1,
      });
    },
  ),

  // 6. Values batchUpdate (bulk row writes)
  http.post(
    /^https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/[^/]+\/values:batchUpdate/,
    async ({ request }) => {
      if (currentSheetsStore.simulateOutage) {
        return new HttpResponse('503 Service Unavailable', { status: 503 });
      }

      if (currentSheetsStore.simulateRateLimit && currentSheetsStore.rateLimitCount < 2) {
        currentSheetsStore.rateLimitCount++;
        return HttpResponse.json({ error: { message: 'Quota exceeded' } }, { status: 429 });
      }

      currentSheetsStore.batchUpdateCalls++;
      const body = (await request.json()) as {
        data?: Array<{ range: string; values: unknown[][] }>;
      };

      const data = body?.data || [];
      currentSheetsStore.lastBatchData = data;

      const colA = currentSheetsStore.values.get('Applications!A:A') || [['Application ID']];

      for (const item of data) {
        currentSheetsStore.values.set(item.range, item.values);

        // Track Application ID in Column A
        const appId = item.values[0]?.[0];
        if (appId !== undefined && appId !== null) {
          const idStr = String(appId);
          if (!colA.some((r) => r[0] === idStr)) {
            colA.push([idStr]);
          }
        }
      }

      currentSheetsStore.values.set('Applications!A:A', colA);

      return HttpResponse.json({
        totalUpdatedRows: data.length,
        responses: data.map((d) => ({ updatedRange: d.range })),
      });
    },
  ),
];
