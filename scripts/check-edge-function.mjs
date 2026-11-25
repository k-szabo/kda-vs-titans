// Edge Function parse check: every functions/*/index.ts must at least parse
// (catches boot-killing SyntaxErrors like duplicate declarations, which no
// browser harness can reach). Uses esbuild as a parser only — no typecheck.
// Run: node scripts/check-edge-function.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Z]:)/, '$1');
const functionsDir = path.join(here, '..', 'supabase', 'functions');
const entries = fs.readdirSync(functionsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(functionsDir, entry.name, 'index.ts'))
  .filter((file) => fs.existsSync(file));
assert.ok(entries.length > 0, 'no edge functions found');

for (const file of entries) {
  try {
    execFileSync('npx', ['--yes', 'esbuild', file, '--bundle', '--platform=neutral', '--outfile=NUL'], { stdio: 'pipe', timeout: 120000 });
    console.log('PARSE OK: ' + path.relative(path.join(here, '..'), file));
  } catch (error) {
    const detail = String(error.stdout || error.stderr || error.message).split('\n').slice(0, 8).join('\n');
    assert.fail(`Edge function fails to parse: ${file}\n${detail}`);
  }
}
console.log('PASS: all edge functions parse.');
