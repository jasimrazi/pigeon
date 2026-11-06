import { describe, it, expect } from 'vitest';
import {
  getEffectiveDryRun,
  isKillSwitchActive,
  KILL_SWITCH_KV_KEY,
  DRY_RUN_KV_KEY,
} from './safety.js';
import type { KVLike } from './google/auth.js';

function createMockKv(initial: Record<string, string> = {}): KVLike & {
  store: Map<string, string>;
  shouldThrow: boolean;
} {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    store,
    shouldThrow: false,
    async get(key: string) {
      if (this.shouldThrow) {
        throw new Error('KV network fault');
      }
      return this.store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      if (this.shouldThrow) {
        throw new Error('KV network fault');
      }
      this.store.set(key, value);
    },
    async delete(key: string) {
      if (this.shouldThrow) {
        throw new Error('KV network fault');
      }
      this.store.delete(key);
    },
  };
}

describe('Safety Controls: DRY_RUN & Kill Switch', () => {
  describe('Constants', () => {
    it('exports standard single-spelling KV keys', () => {
      expect(KILL_SWITCH_KV_KEY).toBe('kill_switch');
      expect(DRY_RUN_KV_KEY).toBe('dry_run');
    });
  });

  describe('getEffectiveDryRun combinations and fail-safe', () => {
    // 1. wrangler=true, KV=false -> true (wrangler var is true)
    it('returns true when wrangler var is true and KV is false', async () => {
      const kv = createMockKv({ [DRY_RUN_KV_KEY]: 'false' });
      const result = await getEffectiveDryRun(true, kv);
      expect(result).toBe(true);

      const resultString = await getEffectiveDryRun('true', kv);
      expect(resultString).toBe(true);
    });

    // 2. wrangler=true, KV=true -> true
    it('returns true when wrangler var is true and KV is true', async () => {
      const kv = createMockKv({ [DRY_RUN_KV_KEY]: 'true' });
      const result = await getEffectiveDryRun(true, kv);
      expect(result).toBe(true);
    });

    // 3. wrangler=false, KV=true -> true (KV override is true)
    it('returns true when wrangler var is false and KV is true', async () => {
      const kv = createMockKv({ [DRY_RUN_KV_KEY]: 'true' });
      const result = await getEffectiveDryRun(false, kv);
      expect(result).toBe(true);

      const resultString = await getEffectiveDryRun('false', kv);
      expect(resultString).toBe(true);
    });

    // 4. wrangler=false, KV=false -> false
    it('returns false when wrangler var is false and KV is false', async () => {
      const kv = createMockKv({ [DRY_RUN_KV_KEY]: 'false' });
      const result = await getEffectiveDryRun(false, kv);
      expect(result).toBe(false);

      const resultString = await getEffectiveDryRun('false', kv);
      expect(resultString).toBe(false);
    });

    // 5. wrangler=false, KV is missing/null -> false
    it('returns false when wrangler var is false and KV is unset', async () => {
      const kv = createMockKv();
      const result = await getEffectiveDryRun(false, kv);
      expect(result).toBe(false);
    });

    // 6. wrangler=true, KV is missing/null -> true
    it('returns true when wrangler var is true and KV is unset', async () => {
      const kv = createMockKv();
      const result = await getEffectiveDryRun(true, kv);
      expect(result).toBe(true);
    });

    // 7. KV failure counts as true (fail-safe)
    it('returns true when KV read throws an error (KV failure counts as true)', async () => {
      const kv = createMockKv();
      kv.shouldThrow = true;

      // Even if wrangler var is false, KV failure forces effective dry-run = true
      const result = await getEffectiveDryRun(false, kv);
      expect(result).toBe(true);

      const resultTrue = await getEffectiveDryRun(true, kv);
      expect(resultTrue).toBe(true);
    });
  });

  describe('isKillSwitchActive logic and fail-safe', () => {
    it('returns true when env kill switch is true', async () => {
      const kv = createMockKv({ [KILL_SWITCH_KV_KEY]: 'false' });
      const result = await isKillSwitchActive(kv, true);
      expect(result).toBe(true);
    });

    it('returns true when KV kill_switch is true', async () => {
      const kv = createMockKv({ [KILL_SWITCH_KV_KEY]: 'true' });
      const result = await isKillSwitchActive(kv, false);
      expect(result).toBe(true);
    });

    it('returns false when both env and KV kill switch are false', async () => {
      const kv = createMockKv({ [KILL_SWITCH_KV_KEY]: 'false' });
      const result = await isKillSwitchActive(kv, false);
      expect(result).toBe(false);
    });

    it('returns true when KV read throws (KV failure halts sending as fail-safe)', async () => {
      const kv = createMockKv();
      kv.shouldThrow = true;
      const result = await isKillSwitchActive(kv, false);
      expect(result).toBe(true);
    });
  });
});
