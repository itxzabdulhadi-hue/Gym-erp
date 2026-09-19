#!/usr/bin/env node
/**
 * Lint pass for the JavaScript workspaces.
 *
 * There is no ESLint dependency, so this runs the checks that actually catch
 * problems in this codebase: syntax, and a set of guardrails that map to rules
 * this project has been burned by (hardcoded secrets, debug logging left in
 * production paths, SQL built by concatenating a variable).
 *
 * Exits non-zero on the first problem so CI can gate on it.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'storage', '.pgdata', 'coverage', 'migrations']);

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (entry.endsWith('.js') || entry.endsWith('.mjs')) yield full;
  }
}

const files = [
  ...walk(join(ROOT, 'server', 'src')),
  ...walk(join(ROOT, 'shared', 'src')),
  ...walk(join(ROOT, 'server', 'scripts')),
  ...walk(join(ROOT, 'scripts')),
];

const RULES = [
  {
    id: 'no-hardcoded-secret',
    test: /(secret|password|api[_-]?key)\s*[:=]\s*['"][A-Za-z0-9/+_-]{24,}['"]/i,
    message: 'looks like a hardcoded secret - read it from config instead',
    allow: [/\.example$/, /seed\.js$/, /change-me/, /dev-(access|refresh|reset)-secret/],
  },
  {
    id: 'no-console-in-src',
    test: /^\s*console\.(log|debug)\(/,
    message: 'use the structured logger instead of console',
    allow: [/utils\/logger\.js$/, /scripts\//],
  },
  {
    id: 'no-string-concat-sql',
    test: /['"`]\s*(SELECT|INSERT INTO|UPDATE|DELETE FROM)[\s\S]{0,60}['"`]\s*\+\s*\w/,
    message: 'SQL built by concatenating a variable - use a placeholder',
    allow: [/utils\/sql\.js$/, /\.repository\.js$/],
  },
  {
    id: 'no-floating-promise-audit',
    test: /^\s*logAudit\((?!await)/,
    message: 'logAudit returns a promise - await it or the row may never be written',
  },
];

const problems = [];
let checked = 0;

for (const file of files) {
  const rel = relative(ROOT, file);
  checked += 1;
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    problems.push(`${rel}: syntax error - ${String(err.stderr).split('\n').slice(0, 3).join(' ').trim()}`);
    continue;
  }

  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    for (const rule of RULES) {
      if (!rule.test.test(line)) continue;
      if (rule.allow?.some((re) => re.test(rel))) continue;
      problems.push(`${rel}:${i + 1}: [${rule.id}] ${rule.message}`);
    }
  });
}

if (problems.length) {
  console.error(`✗ lint found ${problems.length} problem(s) across ${checked} files\n`);
  for (const p of problems.slice(0, 40)) console.error('  ' + p);
  if (problems.length > 40) console.error(`  ... and ${problems.length - 40} more`);
  process.exit(1);
}

console.log(`✓ lint clean across ${checked} files (syntax + ${RULES.length} guardrail rules)`);
