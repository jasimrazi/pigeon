export interface ParsedSalary {
  salary_min: number | null;
  salary_max: number | null;
  currency: string | null;
  salary_raw: string | null;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  $: 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '₹': 'INR',
  '¥': 'JPY',
};

const NON_SALARY_TERMS = [
  'competitive',
  'doe',
  'depends on experience',
  'not disclosed',
  'negotiable',
  'market rate',
  'undisclosed',
  'tbd',
  'n/a',
];

export function parseSalary(
  input: string | number | null | undefined,
  maxInput?: number | null,
  currencyHint?: string | null,
): ParsedSalary {
  if (input === null || input === undefined) {
    return {
      salary_min: null,
      salary_max: null,
      currency: null,
      salary_raw: null,
    };
  }

  // If numeric inputs provided directly
  if (typeof input === 'number') {
    const min = input > 0 ? input : null;
    const max = typeof maxInput === 'number' && maxInput > 0 ? maxInput : min;
    const currency = currencyHint || 'USD';
    const raw = min !== null && max !== null ? `${min} - ${max} ${currency}` : null;
    return {
      salary_min: min,
      salary_max: max,
      currency,
      salary_raw: raw,
    };
  }

  const rawStr = input.trim();
  if (!rawStr) {
    return {
      salary_min: null,
      salary_max: null,
      currency: null,
      salary_raw: null,
    };
  }

  const lower = rawStr.toLowerCase();
  for (const term of NON_SALARY_TERMS) {
    if (lower === term || lower.includes(`(${term})`)) {
      return {
        salary_min: null,
        salary_max: null,
        currency: null,
        salary_raw: rawStr,
      };
    }
  }

  // Detect currency
  let currency: string | null = currencyHint || null;
  for (const [sym, code] of Object.entries(CURRENCY_SYMBOLS)) {
    if (rawStr.includes(sym)) {
      currency = code;
      break;
    }
  }
  if (!currency) {
    const codeMatch = rawStr.match(/\b(USD|EUR|GBP|INR|CAD|AUD|SGD|CHF|JPY)\b/i);
    if (codeMatch?.[1]) {
      currency = codeMatch[1].toUpperCase();
    }
  }

  // Detect frequency
  const isMonthly = /(?:per\s+month|\/\s*month|\/\s*mo\b|\bmonthly\b|\bpm\b)/i.test(rawStr);
  const isHourly = /(?:per\s+hour|\/\s*hour|\/\s*hr\b|\bhourly\b)/i.test(rawStr);

  // 1. Check for Indian LPA: e.g. "15 - 25 LPA", "20 LPA", "18 Lakhs", "15L - 25L"
  const lpaMatch = rawStr.match(
    /(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s*(?:lpa|lakhs?|l)\b/i,
  );
  if (lpaMatch?.[1] && lpaMatch[2]) {
    const minVal = parseFloat(lpaMatch[1]) * 100000;
    const maxVal = parseFloat(lpaMatch[2]) * 100000;
    return {
      salary_min: minVal,
      salary_max: maxVal,
      currency: 'INR',
      salary_raw: rawStr,
    };
  }

  const singleLpaMatch = rawStr.match(/(\d+(?:\.\d+)?)\s*(?:lpa|lakhs?|l)\b/i);
  if (singleLpaMatch?.[1]) {
    const val = parseFloat(singleLpaMatch[1]) * 100000;
    return {
      salary_min: val,
      salary_max: val,
      currency: 'INR',
      salary_raw: rawStr,
    };
  }

  // Strip currency symbols and commas to make range detection foolproof
  // E.g. "$120k - $150k" -> "120k - 150k"
  // "$120,000 - $150,000 USD" -> "120000 - 150000 USD"
  const stripped = rawStr.replace(/[$€£₹¥]/g, ' ').replace(/,/g, '');

  // 2. Check for ranges with 'k': e.g. "120k - 150k", "120k to 150k"
  const kRangeMatch = stripped.match(/(\d+(?:\.\d+)?)\s*k\b\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s*k\b/i);
  if (kRangeMatch?.[1] && kRangeMatch[2]) {
    let minVal = parseFloat(kRangeMatch[1]) * 1000;
    let maxVal = parseFloat(kRangeMatch[2]) * 1000;
    if (isMonthly) {
      minVal *= 12;
      maxVal *= 12;
    }
    return {
      salary_min: minVal,
      salary_max: maxVal,
      currency: currency || 'USD',
      salary_raw: rawStr,
    };
  }

  // 3. Check for standard numeric ranges: e.g. "120000 - 150000"
  const numRangeMatch = stripped.match(/(\d{2,9}(?:\.\d+)?)\s*(?:-|to)\s*(\d{2,9}(?:\.\d+)?)/i);
  if (numRangeMatch?.[1] && numRangeMatch[2]) {
    let minVal = parseFloat(numRangeMatch[1]);
    let maxVal = parseFloat(numRangeMatch[2]);
    // If numbers look like thousands without k (e.g. 120 - 150 in context of salary)
    if (minVal < 1000 && maxVal < 1000 && !isHourly && !isMonthly) {
      minVal *= 1000;
      maxVal *= 1000;
    }
    if (isMonthly) {
      minVal *= 12;
      maxVal *= 12;
    } else if (isHourly) {
      minVal *= 2000;
      maxVal *= 2000;
    }
    return {
      salary_min: minVal,
      salary_max: maxVal,
      currency: currency || 'USD',
      salary_raw: rawStr,
    };
  }

  // 4. Single number with 'k': e.g. "140k"
  const singleKMatch = stripped.match(/(\d+(?:\.\d+)?)\s*k\b/i);
  if (singleKMatch?.[1]) {
    let val = parseFloat(singleKMatch[1]) * 1000;
    if (isMonthly) val *= 12;
    return {
      salary_min: val,
      salary_max: val,
      currency: currency || 'USD',
      salary_raw: rawStr,
    };
  }

  // 5. Single number: e.g. "120000" or "5000"
  const singleNumMatch = stripped.match(/(\d{3,9}(?:\.\d+)?)/);
  if (singleNumMatch?.[1]) {
    let val = parseFloat(singleNumMatch[1]);
    if (isMonthly) {
      val *= 12;
    } else if (isHourly) {
      val *= 2000;
    }
    return {
      salary_min: val,
      salary_max: val,
      currency: currency || 'USD',
      salary_raw: rawStr,
    };
  }

  return {
    salary_min: null,
    salary_max: null,
    currency,
    salary_raw: rawStr,
  };
}
