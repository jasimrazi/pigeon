import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const workerDir = path.join(rootDir, 'apps/worker');
const devVarsPath = path.join(workerDir, '.dev.vars');
const devVarsExamplePath = path.join(workerDir, '.dev.vars.example');

// 1. Copy .dev.vars if missing
if (!fs.existsSync(devVarsPath)) {
  if (fs.existsSync(devVarsExamplePath)) {
    fs.copyFileSync(devVarsExamplePath, devVarsPath);
    console.log('[dev:local] apps/worker/.dev.vars was missing. Copied from .dev.vars.example.');
  } else {
    console.warn('[dev:local] [WARNING] apps/worker/.dev.vars.example not found!');
  }
}

// Read .dev.vars for banner & configuration info
const devVarsContent = fs.existsSync(devVarsPath) ? fs.readFileSync(devVarsPath, 'utf8') : '';
function getVar(key, defaultVal = '') {
  const match = devVarsContent.match(new RegExp(`^\\s*${key}\\s*=\\s*"?([^"\\r\\n]+)"?`, 'm'));
  return match ? match[1].trim() : defaultVal;
}

const envVar = getVar('ENV', 'dev');
const llmProvider = getVar('LLM_PROVIDER', 'workers-ai');
const devRecipientAllowlist = getVar('DEV_RECIPIENT_ALLOWLIST', '');

// 2. Apply D1 migrations to the local database
console.log('[dev:local] Applying local D1 database migrations...');
try {
  execSync('pnpm --filter @pigeon/worker exec wrangler d1 migrations apply pigeon-db --local', {
    cwd: rootDir,
    stdio: 'inherit',
    shell: true,
  });
  console.log('[dev:local] D1 database migrations applied successfully.');
} catch (err) {
  console.error('[dev:local] [ERROR] Failed to apply D1 migrations:', err.message);
  process.exit(1);
}

// 3. Start wrangler dev and vite concurrently with prefixed output
console.log('[dev:local] Starting Worker (wrangler dev) and Dashboard (vite)...');

let isShuttingDown = false;
let workerProc = null;
let dashboardProc = null;

function killProcessTree(proc) {
  if (!proc || !proc.pid) return;
  if (process.platform === 'win32') {
    try {
      execSync(`taskkill /pid ${proc.pid} /T /F`, { stdio: 'ignore' });
    } catch {
      // process already dead
    }
  } else {
    try {
      proc.kill('SIGTERM');
    } catch {
      // process already terminated
    }
  }
}

function shutdown(exitCode = 0) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log('\n[dev:local] Shutting down development processes...');
  killProcessTree(workerProc);
  killProcessTree(dashboardProc);
  process.exit(exitCode);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

function prefixStream(stream, prefix, isWorker = false) {
  let buffer = '';
  stream.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      console.log(`${prefix} ${line}`);
      if (isWorker && line.includes('Binding AI needs to be run remotely')) {
        console.error(`
========================================================================
[dev:local] [WARNING] Cloudflare Workers AI local binding error:
"Binding AI needs to be run remotely"
Actionable solution:
  Option 1: Set LLM_PROVIDER=gemini and GEMINI_API_KEY=your_key in apps/worker/.dev.vars
  Option 2: Log in to Cloudflare with 'npx wrangler login' to use remote AI bindings
========================================================================
`);
      }
    }
  });
}

// Spawn Worker
workerProc = spawn(
  'pnpm',
  ['--filter', '@pigeon/worker', 'exec', 'wrangler', 'dev', '--port', '8787', '--test-scheduled'],
  {
    cwd: rootDir,
    shell: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  },
);
prefixStream(workerProc.stdout, '[worker]', true);
prefixStream(workerProc.stderr, '[worker]', true);

workerProc.on('exit', (code) => {
  if (!isShuttingDown) {
    console.error(`[dev:local] Worker process exited with code ${code}`);
    shutdown(code || 1);
  }
});

// Spawn Dashboard
dashboardProc = spawn('pnpm', ['--filter', '@pigeon/dashboard', 'exec', 'vite'], {
  cwd: rootDir,
  shell: true,
  stdio: ['pipe', 'pipe', 'pipe'],
});
prefixStream(dashboardProc.stdout, '[dashboard]', false);
prefixStream(dashboardProc.stderr, '[dashboard]', false);

dashboardProc.on('exit', (code) => {
  if (!isShuttingDown) {
    console.error(`[dev:local] Dashboard process exited with code ${code}`);
    shutdown(code || 1);
  }
});

// 4. Poll http://127.0.0.1:8787/health until ready and print banner
async function pollWorkerReady() {
  const maxAttempts = 60;
  for (let i = 0; i < maxAttempts; i++) {
    if (isShuttingDown) return;
    try {
      const res = await fetch('http://127.0.0.1:8787/health');
      if (res.ok) {
        // Fetch overview for real state if possible
        let dryRun = true;
        let killSwitch = false;
        let authHealth = 'unknown';
        try {
          const overviewRes = await fetch('http://127.0.0.1:8787/api/overview');
          if (overviewRes.ok) {
            const overview = await overviewRes.json();
            dryRun = Boolean(overview.dryRun);
            killSwitch = Boolean(overview.killSwitch);
            authHealth = overview.authHealth || 'unknown';
          }
        } catch {
          // overview fetch optional for banner
        }

        printBanner({
          env: envVar,
          dryRun,
          killSwitch: killSwitch ? 'On' : 'Off',
          authHealth,
          llmProvider,
          allowlist: devRecipientAllowlist,
        });
        return;
      }
    } catch {
      // worker not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.warn('[dev:local] Warning: Timed out waiting for Worker /health to respond.');
}

function printBanner(info) {
  const allowlistWarning =
    !info.allowlist || !info.allowlist.trim()
      ? `\n! [WARNING] DEV_RECIPIENT_ALLOWLIST is empty in .dev.vars.\n! Outbound email sends are disabled in dev until an address/domain is configured.`
      : '';

  console.log(`
╔═════════════════════════════════════════════════════════════════════════╗
║                         PIGEON DEV SERVER READY                         ║
╠═════════════════════════════════════════════════════════════════════════╣
║  ENV:                  ${info.env.padEnd(49)}║
║  Effective DRY_RUN:    ${String(info.dryRun).padEnd(49)}║
║  Kill Switch:          ${info.killSwitch.padEnd(49)}║
║  Google Auth Health:   ${info.authHealth.padEnd(49)}║
║  Active LLM Provider:  ${info.llmProvider.padEnd(49)}║
║  Dashboard URL:        http://localhost:5173                            ║
║  Worker API URL:       http://127.0.0.1:8787                            ║
╚═════════════════════════════════════════════════════════════════════════╝${allowlistWarning}
`);
}

pollWorkerReady();
