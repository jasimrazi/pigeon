import { describe, it, expect } from 'vitest';
import { APP_VERSION, BUILD_NUMBER, GIT_COMMIT, getAppVersionInfo } from './version.js';

describe('App Version Counter', () => {
  it('exposes valid semver, positive build counter, and formatted label', () => {
    const info = getAppVersionInfo();
    expect(info.version).toBe(APP_VERSION);
    expect(info.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(info.build).toBe(BUILD_NUMBER);
    expect(info.build).toBeGreaterThan(0);
    expect(info.commit).toBe(GIT_COMMIT);
    expect(info.commit.length).toBeGreaterThan(0);
    expect(info.label).toBe(`v${APP_VERSION} #${BUILD_NUMBER} (${GIT_COMMIT})`);
  });
});
