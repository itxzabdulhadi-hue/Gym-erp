#!/usr/bin/env node
/**
 * Import graph check.
 *
 * Loads every server module and reports link/runtime errors. This catches the
 * things a syntax check cannot: missing exports, circular imports that resolve
 * to undefined bindings, and environment level ESM linking quirks.
 *
 *   npm run check
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

function collect(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collect(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const files = collect(ROOT).sort();
const failures = [];

for (const file of files) {
  try {
    await import(pathToFileURL(file).href);
  } catch (err) {
    failures.push({ file: path.relative(process.cwd(), file), message: err.message.split('\n')[0] });
  }
}

if (failures.length) {
  console.error(`✗ ${failures.length} of ${files.length} modules failed to load:\n`);
  for (const f of failures) console.error(`  ${f.file}\n    ${f.message}\n`);
  process.exit(1);
}

console.log(`✓ all ${files.length} server modules load cleanly`);
process.exit(0);
