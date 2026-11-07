import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';

export default defineConfig(async () => {
  const migrationsPath = path.join(__dirname, 'migrations');
  const migrations = await readD1Migrations(migrationsPath);

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.toml' },
        remoteBindings: false,
        miniflare: {
          bindings: {
            IS_TEST: true,
            ALLOW_INSECURE_DEV_AUTH: true,
            TEST_MIGRATIONS: migrations,
            DEV_RECIPIENT_ALLOWLIST:
              'jobs@stripe.com, recruiter@acmeops.com, @stripe.com, @acmeops.com, @example.test',
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
  };
});
