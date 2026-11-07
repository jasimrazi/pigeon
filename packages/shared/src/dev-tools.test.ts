import { describe, it, expect } from 'vitest';
// @ts-expect-error Node.js fs module is available in Vitest node test runner
import * as fs from 'node:fs';
// @ts-expect-error Node.js path module is available in Vitest node test runner
import * as path from 'node:path';

describe('Developer Tools & Local Run Kit Verification', () => {
  const proc = (globalThis as unknown as { process?: { cwd?: () => string } }).process;
  let rootDir = proc?.cwd ? proc.cwd() : '.';
  while (
    !fs.existsSync(path.join(rootDir, 'pnpm-workspace.yaml')) &&
    path.dirname(rootDir) !== rootDir
  ) {
    rootDir = path.dirname(rootDir);
  }

  describe('Vite Dev Proxy Configuration', () => {
    it('vite.config.ts configures proxy for /api, /auth, and /health targeting http://127.0.0.1:8787', () => {
      const viteConfigPath = path.join(rootDir, 'apps/dashboard/vite.config.ts');
      expect(fs.existsSync(viteConfigPath)).toBe(true);

      const content = fs.readFileSync(viteConfigPath, 'utf8');

      // Check server port 5173
      expect(content).toContain('port: 5173');

      // Check proxy forwards for /api, /auth, /health targeting 127.0.0.1:8787
      expect(content).toContain("'/api'");
      expect(content).toContain("'/auth'");
      expect(content).toContain("'/health'");
      expect(content).toContain('http://127.0.0.1:8787');
    });
  });
});
