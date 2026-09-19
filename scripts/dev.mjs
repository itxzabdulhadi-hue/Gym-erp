#!/usr/bin/env node
/**
 * Run the API and the web dev server together with prefixed, interleaved logs.
 * Both are killed when this process exits, so Ctrl-C does not leave orphans.
 */
import { spawn } from 'node:child_process';

const targets = [
  { name: 'api', color: '\x1b[36m', cmd: 'npm', args: ['run', 'dev:server'] },
  { name: 'web', color: '\x1b[35m', cmd: 'npm', args: ['run', 'dev:web'] },
];

const reset = '\x1b[0m';
const children = [];
let shuttingDown = false;

function prefix(name, color, chunk) {
  const tag = `${color}[${name}]${reset} `;
  process.stdout.write(chunk.toString().split('\n').map((l) => (l ? tag + l : l)).join('\n'));
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 200).unref();
}

for (const { name, color, cmd, args } of targets) {
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  children.push(child);
  child.stdout.on('data', (c) => prefix(name, color, c));
  child.stderr.on('data', (c) => prefix(name, color, c));
  child.on('exit', (code) => {
    if (shuttingDown) return;
    process.stdout.write(`${color}[${name}]${reset} exited with ${code}\n`);
    shutdown(code ?? 0);
  });
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
