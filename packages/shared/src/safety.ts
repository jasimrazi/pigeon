import type { KVLike } from './google/auth.js';

export const KILL_SWITCH_KV_KEY = 'kill_switch';
export const DRY_RUN_KV_KEY = 'dry_run';

/**
 * Calculates effective DRY_RUN boolean.
 * effective dry-run = (wrangler var is true) OR (KV override is true).
 * A KV read error counts as true.
 */
export async function getEffectiveDryRun(
  wranglerDryRun: boolean | string | undefined,
  config: KVLike,
): Promise<boolean> {
  const wranglerIsTrue = wranglerDryRun === true || wranglerDryRun === 'true';
  if (wranglerIsTrue) {
    return true;
  }

  try {
    const kvVal = await config.get(DRY_RUN_KV_KEY);
    return kvVal === 'true';
  } catch {
    // Fail-safe: a KV read error counts as true
    return true;
  }
}

/**
 * Checks whether the Kill Switch is active.
 * Uses KILL_SWITCH_KV_KEY.
 * A KV read error counts as active (fail-safe: nothing sent).
 */
export async function isKillSwitchActive(
  config: KVLike,
  envKillSwitch?: boolean | string | undefined,
): Promise<boolean> {
  if (envKillSwitch === true || envKillSwitch === 'true') {
    return true;
  }

  try {
    const kvVal = await config.get(KILL_SWITCH_KV_KEY);
    return kvVal === 'true';
  } catch {
    // Fail-safe: KV read failure halts sending
    return true;
  }
}
