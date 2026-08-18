import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const root = process.cwd();
const cli = resolve(root, 'node_modules', 'wrangler', 'wrangler-dist', 'cli.js');
const done = '--dry-run: exiting now.';
let finished = false;

function finish(code) {
  if (finished) return;
  finished = true;
  process.exit(code);
}

const child = spawn(process.execPath, [cli, 'deploy', '--dry-run'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    WRANGLER_SEND_METRICS: 'false',
    WRANGLER_SEND_ERROR_REPORTS: 'false',
    CI: 'true',
  },
});

let stdout = '';
child.stdout.on('data', (chunk) => {
  process.stdout.write(chunk);
  stdout += chunk.toString();
  if (stdout.includes(done)) {
    child.kill();
    finish(0);
  }
});
child.stderr.on('data', (chunk) => process.stderr.write(chunk));
child.on('error', (err) => {
  console.error('[wrangler-dry-run]', err.message);
  finish(1);
});
child.on('exit', (code) => finish(code ?? 0));
