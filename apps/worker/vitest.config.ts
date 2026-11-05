import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      remoteBindings: false,
      miniflare: {
        bindings: {
          IS_TEST: true,
        },
      },
    }),
  ],
  resolve: {
    conditions: ['node', 'import'],
  },
  test: {
    setupFiles: ['./fixtures/setup.ts'],
    dangerouslyIgnoreUnhandledErrors: true,
  },
});
