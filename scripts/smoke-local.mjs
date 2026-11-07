import { fileURLToPath } from 'node:url';

export async function runLocalSmokeTests(opts = {}) {
  const workerUrl = opts.workerUrl || 'http://127.0.0.1:8787';
  const dashboardUrl = opts.dashboardUrl || 'http://127.0.0.1:5173';
  const fetchFn = opts.fetch || globalThis.fetch;

  const results = [];

  // Check 1: Hits /health on 8787 and verifies 200 { status: 'ok' } or { ok: true }
  try {
    const res = await fetchFn(`${workerUrl}/health`);
    if (!res.ok) {
      throw new Error(`Expected HTTP 200 from /health, got ${res.status}`);
    }
    const data = await res.json();
    if (!data.ok && data.status !== 'ok') {
      throw new Error(
        `Expected { ok: true } or { status: 'ok' }, received: ${JSON.stringify(data)}`,
      );
    }
    results.push({ name: 'Worker /health check (port 8787)', passed: true, detail: '200 OK' });
  } catch (err) {
    results.push({ name: 'Worker /health check (port 8787)', passed: false, error: err.message });
  }

  // Check 2: Hits /api/overview through the Vite dev proxy on 5173 and verifies 200, valid JSON, killSwitch false, dryRun true.
  try {
    const res = await fetchFn(`${dashboardUrl}/api/overview`);
    if (!res.ok) {
      throw new Error(`Expected HTTP 200 from Vite dev proxy /api/overview, got ${res.status}`);
    }
    const data = await res.json();
    if (typeof data !== 'object' || data === null) {
      throw new Error('Expected JSON object body from /api/overview');
    }
    if (data.killSwitch !== false) {
      throw new Error(`Expected killSwitch === false, got ${data.killSwitch}`);
    }
    if (data.dryRun !== true) {
      throw new Error(`Expected dryRun === true, got ${data.dryRun}`);
    }
    results.push({
      name: 'Vite dev proxy /api/overview (port 5173)',
      passed: true,
      detail: `200 OK (killSwitch: ${data.killSwitch}, dryRun: ${data.dryRun})`,
    });
  } catch (err) {
    results.push({
      name: 'Vite dev proxy /api/overview (port 5173)',
      passed: false,
      error: err.message,
    });
  }

  // Check 3: Verifies the kill switch can be read from KV
  try {
    const res = await fetchFn(`${dashboardUrl}/api/settings`);
    if (!res.ok) {
      throw new Error(`Expected HTTP 200 from /api/settings, got ${res.status}`);
    }
    const data = await res.json();
    if (typeof data.killSwitch !== 'boolean') {
      throw new Error(
        `Expected boolean killSwitch in settings from KV, got ${typeof data.killSwitch}`,
      );
    }
    results.push({
      name: 'Kill switch KV readability via /api/settings',
      passed: true,
      detail: `killSwitch: ${data.killSwitch}`,
    });
  } catch (err) {
    results.push({
      name: 'Kill switch KV readability via /api/settings',
      passed: false,
      error: err.message,
    });
  }

  // Check 4: Verifies that unauthenticated calls to /api/overview succeed when ALLOW_INSECURE_DEV_AUTH=true and ENV=dev.
  try {
    // Explicitly make an unauthenticated request with no headers
    const res = await fetchFn(`${dashboardUrl}/api/overview`, {
      method: 'GET',
      headers: {},
    });
    if (!res.ok) {
      throw new Error(
        `Expected HTTP 200 for unauthenticated dev request with ALLOW_INSECURE_DEV_AUTH=true, got ${res.status}`,
      );
    }
    results.push({
      name: 'Unauthenticated dev auth bypass (/api/overview)',
      passed: true,
      detail: '200 OK without JWT or session token',
    });
  } catch (err) {
    results.push({
      name: 'Unauthenticated dev auth bypass (/api/overview)',
      passed: false,
      error: err.message,
    });
  }

  return results;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log('[smoke:local] Running local end-to-end smoke checks...');
  runLocalSmokeTests()
    .then((results) => {
      let hasFailure = false;
      for (const r of results) {
        if (r.passed) {
          console.log(`[smoke:local] PASS: ${r.name} - ${r.detail}`);
        } else {
          console.error(`[smoke:local] FAIL: ${r.name} - ${r.error}`);
          hasFailure = true;
        }
      }
      if (hasFailure) {
        console.error('\n[smoke:local] Smoke tests failed.');
        process.exit(1);
      } else {
        console.log('\n[smoke:local] All local smoke checks passed successfully!');
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error('[smoke:local] Unexpected smoke test error:', err);
      process.exit(1);
    });
}
