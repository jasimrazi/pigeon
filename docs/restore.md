# Database Backup and Disaster Recovery (Restore Guide)

This runbook outlines the exact procedure for retrieving a backup SQL dump from Cloudflare R2 and restoring it safely into Cloudflare D1.

---

## 1. Backup Architecture Overview

- **Frequency**: Automatic weekly execution via GitHub Actions (`.github/workflows/backup.yml`) every Sunday at 02:00 UTC.
- **Export Method**: `wrangler d1 export pigeon-db-prod --remote --output=...`.
- **Destination**: Cloudflare R2 bucket `pigeon-resumes-prod` under the `backups/` prefix.
- **Retention**: 8 weeks (56 days) rolling window.

---

## 2. Listing and Downloading Backups

### Step 1: List Available Backups in R2

List the available backup files to identify the desired timestamp:

```bash
npx wrangler r2 object list pigeon-resumes-prod --prefix="backups/"
```

### Step 2: Download the Target Backup Dump

Download the chosen `.sql` dump to a secure local staging folder:

```bash
npx wrangler r2 object get "pigeon-resumes-prod/backups/pigeon-db-prod-2026-11-01T02-00-00-000Z.sql" \
  --file="./backups/restore-target.sql"
```

### Step 3: Validate Dump Integrity

Inspect the header and content of the downloaded file:

```bash
# Check non-empty file size
ls -lh ./backups/restore-target.sql

# Inspect initial schema lines
head -n 25 ./backups/restore-target.sql
```

Confirm the presence of standard SQLite DDL statements (`CREATE TABLE IF NOT EXISTS`, `INSERT INTO`).

---

## 3. Dry-Run Verification in Scratch Database

> [!IMPORTANT]
> **Always test restores in an isolated scratch database first.** Never restore directly to production without testing the dump in an ephemeral database.

### Step 1: Create a Temporary Scratch Database

```bash
npx wrangler d1 create pigeon-db-scratch
```

Copy the generated database ID from the command output.

### Step 2: Execute the Restore Script in Scratch

```bash
npx wrangler d1 execute pigeon-db-scratch --remote --file="./backups/restore-target.sql"
```

### Step 3: Verify Integrity & Row Counts

Run integrity queries against the scratch database:

```bash
# Check SQLite table integrity
npx wrangler d1 execute pigeon-db-scratch --remote --command="PRAGMA integrity_check;"

# Verify essential table counts
npx wrangler d1 execute pigeon-db-scratch --remote --command="SELECT 'jobs', count(*) FROM jobs UNION ALL SELECT 'applications', count(*) FROM applications UNION ALL SELECT 'events', count(*) FROM events;"
```

### Step 4: Tear Down Scratch Database

Once verification passes, delete the scratch database:

```bash
npx wrangler d1 delete pigeon-db-scratch
```

---

## 4. Production Database Restore Procedure

Follow these steps strictly during a disaster recovery or point-in-time recovery event:

### Step 1: Arm the Kill Switch (Halt All Outbound Senders)

Ensure no emails or sync jobs run during the restore:

```bash
pnpm --filter @pigeon/worker exec wrangler kv:key put --binding=CONFIG kill_switch true --env prod
```

### Step 2: Restore the SQL Dump to Production D1

Apply the SQL script to the production database:

```bash
pnpm --filter @pigeon/worker exec wrangler d1 execute pigeon-db-prod --remote --file="./backups/restore-target.sql"
```

### Step 3: Run Integrity & Sanity Verification

Verify table integrity and records:

```bash
pnpm --filter @pigeon/worker exec wrangler d1 execute pigeon-db-prod --remote \
  --command="PRAGMA integrity_check;"

pnpm --filter @pigeon/worker exec wrangler d1 execute pigeon-db-prod --remote \
  --command="SELECT count(*) as total_jobs FROM jobs; SELECT count(*) as total_apps FROM applications;"
```

### Step 4: Disarm Kill Switch

After verifying that data is restored and application health is verified:

```bash
pnpm --filter @pigeon/worker exec wrangler kv:key put --binding=CONFIG kill_switch false --env prod
```

Log the recovery event in your operations notes.
