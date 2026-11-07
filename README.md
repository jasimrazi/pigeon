# Pigeon

Pigeon is a personal job-application automation tool built on Cloudflare Workers, D1, R2, KV, Queues, and Pages with React and Tailwind CSS.

## Workspace Structure

- **`apps/worker`** (`@pigeon/worker`): Cloudflare Workers application running Hono, with D1 (`pigeon-db`), R2 (`pigeon-resumes`), KV (`pigeon-config`), and Queue (`pigeon-jobs`).
- **`apps/dashboard`** (`@pigeon/dashboard`): Web dashboard shell built with Vite, React, and Tailwind CSS.
- **`packages/shared`** (`@pigeon/shared`): Shared TypeScript interfaces, types, and zod validation schemas.

## Dev Commands

```bash
# Start development servers
pnpm dev                             # Run worker dev server (wrangler dev)
pnpm --filter @pigeon/dashboard dev  # Run dashboard dev server (vite)

# Quality Checks
pnpm lint                            # Run ESLint (typescript-eslint strict)
pnpm lint:fix                        # Run ESLint with autofix
pnpm typecheck                       # Typecheck all packages (tsc --noEmit)
pnpm test                            # Run tests with Vitest (@cloudflare/vitest-pool-workers)

# Formatting
pnpm format                          # Format all files with Prettier
pnpm format:check                    # Check formatting with Prettier
```

## Local Testing

Pigeon includes a complete local testing kit for running and verifying the entire stack on your machine without cloud dependencies:

- **Runner**: `pnpm dev:local` runs Worker and Dashboard concurrently with migrations and health checks.
- **Smoke Tests**: `pnpm smoke:local` validates the Worker, Vite proxy, and KV configuration.
- **Seeding & Reset**: `pnpm seed:local` populates test data; `pnpm db:reset:local` resets the local database.

For complete step-by-step instructions on Windows (PowerShell), see [Local Testing Guide](docs/local-testing.md).

## Cloudflare Environments & Bindings

The worker (`apps/worker/wrangler.toml`) defines three environments: `dev`, `staging`, and `prod`.

| Binding      | Type                        | Resource Name                          |
| :----------- | :-------------------------- | :------------------------------------- |
| `DB`         | D1 Database                 | `pigeon-db` (`-staging`, `-prod`)      |
| `RESUMES`    | R2 Bucket                   | `pigeon-resumes` (`-staging`, `-prod`) |
| `CONFIG`     | KV Namespace                | `pigeon-config` (`-staging`, `-prod`)  |
| `JOBS_QUEUE` | Queue (Producer & Consumer) | `pigeon-jobs` (`-staging`, `-prod`)    |

Vars configured:

- `ENV`: `"dev"` | `"staging"` | `"prod"`
- `DRY_RUN`: `"true"` (default) | `"false"`

## Security & Access Control

Pigeon is secured for production deployment with owner-only access controls:

- **Cloudflare Access (Zero Trust)**: Protects both Cloudflare Pages (`apps/dashboard`) and the API Worker (`apps/worker`). The Worker verifies the `Cf-Access-Jwt-Assertion` header on every `/api/*` request against cached Cloudflare Access team JWKS (RS256 signature, audience tag, team issuer, and token expiry).
- **CORS & Origin Checks**: Outbound headers and origin matching are restricted to the configured dashboard domain (`DASHBOARD_ORIGIN`). State-changing requests (`POST`, `PUT`, `PATCH`, `DELETE`) require an exact Origin match and `application/json` Content-Type.
- **Kill Switch**: Stored in Cloudflare KV and evaluated dynamically before every outbound email dispatch. The dashboard provides a confirmation-gated toggle to instantly halt all sending.
- **Safety Defaults**: `DRY_RUN=true` by default. Outbound emails are only transmitted when `DRY_RUN=false`, the Kill Switch is disarmed, and Google OAuth health is valid.

## CI Workflow

A GitHub Actions workflow is located at [`.github/workflows/ci.yml`](.github/workflows/ci.yml) and runs on all pushes and pull requests to execute:

1. `pnpm install --frozen-lockfile`
2. `pnpm lint`
3. `pnpm typecheck`
4. `pnpm test`
