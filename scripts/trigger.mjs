#!/usr/bin/env node

/**
 * CLI runner for Pigeon pipeline triggers against local Worker dev instance.
 * Usage: node scripts/trigger.mjs <action>
 *   Actions: ingest, score, draft, send, followups, sheets, all
 */

const action = process.argv[2]?.toLowerCase()?.trim();
const validActions = ['ingest', 'score', 'draft', 'send', 'followups', 'sheets', 'all'];

if (!action || !validActions.includes(action)) {
  console.error(`Usage: node scripts/trigger.mjs <action>`);
  console.error(`Available actions: ${validActions.join(', ')}`);
  process.exit(1);
}

const BASE_URL = process.env.PIGEON_WORKER_URL || 'http://127.0.0.1:8787';

async function runTrigger(targetAction) {
  const url = `${BASE_URL}/api/dev/trigger/${targetAction}`;
  console.log(`\n▶ Triggering [${targetAction}] -> ${url}...`);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:5173',
      },
    });

    const status = res.status;
    let data;
    try {
      data = await res.json();
    } catch {
      data = { raw: await res.text() };
    }

    if (!res.ok) {
      console.error(`✖ HTTP ${status} Error:`, data.error || data);
      return false;
    }

    console.log(`✔ HTTP ${status} OK`);
    formatSummary(targetAction, data);
    return true;
  } catch (err) {
    if (err.cause?.code === 'ECONNREFUSED' || err.message?.includes('fetch failed')) {
      console.error(`✖ Connection failed: Worker is not reachable at ${BASE_URL}.`);
      console.error(`  Please make sure 'pnpm dev:local' or 'wrangler dev' is running.`);
    } else {
      console.error(`✖ Trigger execution failed:`, err.message || err);
    }
    return false;
  }
}

function formatSummary(actionName, data) {
  switch (actionName) {
    case 'ingest':
      console.log(`  Sources processed: ${(data.enabledSources || []).join(', ') || 'none'}`);
      console.log(`  Total jobs currently in database: ${data.totalJobs ?? 'N/A'}`);
      break;

    case 'score': {
      const stats = data.stats || {};
      console.log(`  Jobs scored & processed: ${stats.scored ?? 0}`);
      console.log(`  Routed to auto_email: ${stats.routed_auto_email ?? 0}`);
      console.log(`  Routed to manual_portal: ${stats.routed_manual_portal ?? 0}`);
      console.log(`  Routed to manual_review: ${stats.routed_manual_review ?? 0}`);
      console.log(`  Skipped (low score / filters): ${stats.skipped ?? 0}`);
      break;
    }

    case 'draft':
      console.log(`  Applications created: ${data.created ?? 0}`);
      console.log(`  Candidates considered: ${data.candidatesFound ?? 0}`);
      if (data.errors && data.errors.length > 0) {
        console.warn(`  Warnings/Errors: ${data.errors.join('; ')}`);
      }
      break;

    case 'send': {
      console.log(`  Approved items processed: ${data.processed ?? 0}`);
      const results = data.sendResults || [];
      const sentCount = results.filter((r) => r.success && !r.dryRun).length;
      const dryRunCount = results.filter((r) => r.dryRun).length;
      const failedCount = results.filter((r) => !r.success).length;
      console.log(
        `  Sent live: ${sentCount} | Simulated (DRY_RUN): ${dryRunCount} | Policy blocks / Failed: ${failedCount}`,
      );
      break;
    }

    case 'followups':
      console.log(`  Follow-ups created: ${data.followUpsCreated ?? 0}`);
      console.log(`  Applications checked: ${data.applicationsChecked ?? 0}`);
      break;

    case 'sheets':
      console.log(`  Synced applications: ${data.syncedCount ?? data.processedCount ?? 0}`);
      break;

    default:
      console.log('  Result:', JSON.stringify(data));
  }
}

async function main() {
  if (action === 'all') {
    const sequence = ['ingest', 'score', 'draft', 'send', 'followups', 'sheets'];
    console.log(`Starting full pipeline trigger sequence: ${sequence.join(' -> ')}`);
    for (const step of sequence) {
      const ok = await runTrigger(step);
      if (!ok) {
        console.error(`\n✖ Pipeline aborted at step: ${step}`);
        process.exit(1);
      }
    }
    console.log(`\n🎉 Full pipeline sequence completed successfully!`);
  } else {
    const ok = await runTrigger(action);
    if (!ok) {
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
