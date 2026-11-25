// Single entry point for every repository check script.
// Run: node scripts/check-all.mjs
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const checks = fs.readdirSync(here)
  .filter((file) => file.startsWith('check-') && file.endsWith('.mjs') && file !== 'check-all.mjs')
  .sort();
let failures = 0;
for (const check of checks) {
  const result = spawnSync(process.execPath, [path.join(here, check)], { encoding: 'utf8' });
  const ok = result.status === 0;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${check}`);
  if (!ok) console.log((result.stdout + result.stderr).split('\n').slice(0, 12).join('\n'));
}
console.log(failures === 0 ? `ALL GREEN (${checks.length} suites)` : `${failures} SUITE(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
