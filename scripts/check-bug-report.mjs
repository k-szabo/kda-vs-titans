// K/DA bug-report link check: exact hidden-field contract, live run/menu
// context, browser parsing, bounded URL, and no storage/session export.
// Run: node scripts/check-bug-report.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

const root = path.join(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Z]:)/, '$1'), '..');
const source = fs.readFileSync(path.join(root, 'js', 'bug-report.js'), 'utf8')
  .replace(/^export\s+/gm, '');

// Privacy: reporting must not touch saves, storage, location, or raw session.
const forbidden = new Proxy({}, { get() { throw new Error('Bug reporting must not access private/session data'); } });
const links = ['menu', 'run'].map((origin) => ({
  dataset: { bugReport: origin },
  listeners: {},
  attributes: {},
  href: '',
  addEventListener(event, callback) { this.listeners[event] = callback; },
  setAttribute(key, value) { this.attributes[key] = value; }
}));
const context = vm.createContext({
  URL, Set, Map, Math, Number, Array, Object, String,
  navigator: { userAgent: 'Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36 SecretSession/DO_NOT_EXPORT' },
  document: { querySelectorAll: () => links },
  localStorage: forbidden, sessionStorage: forbidden, indexedDB: forbidden, location: forbidden,
  saved: forbidden, player: forbidden, state: forbidden, profileStats: forbidden
});
vm.runInContext(`${source}\nglobalThis.BugReport = { createBugReportURL, initBugReportLinks, BUG_REPORT_ENDPOINT };`, context);
const report = vm.runInContext('BugReport', context);

const view = { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 2 };
const runCtx = {
  version: 'v1.23.0_60bc9b94_test',
  leader: 'akali', waveIndex: 4, encoreLevel: 2,
  userAgent: 'Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36 SecretSession/DO_NOT_EXPORT',
  view
};

function checkForm(url, expected) {
  const form = new URL(url);
  const fields = form.searchParams;
  assert.equal(form.origin, 'https://tally.so');
  assert.ok(form.pathname.startsWith('/r/'), 'tally form path');
  assert.deepEqual([...fields.keys()].sort(), ['browser', 'encore', 'leader', 'pixel_ratio', 'version', 'viewport', 'wave']);
  for (const [key, value] of Object.entries(expected)) assert.equal(fields.get(key), value, key);
  assert.ok(!url.includes('DO_NOT_EXPORT'), 'no session marker leaks');
  assert.ok(!url.includes('Mozilla'), 'no raw user agent leaks');
  assert.ok(url.length < 2000, 'keep the form URL bounded');
  return fields;
}

// Full run context.
checkForm(report.createBugReportURL(runCtx), {
  version: 'v1.23.0_60bc9b94_test',
  leader: 'akali', wave: 'W5', encore: 'E2',
  browser: 'Chrome 140', viewport: '1280 × 720', pixel_ratio: '2.00'
});
// Menu context falls back cleanly.
checkForm(report.createBugReportURL({ version: 'v9', view }), {
  version: 'v9', leader: 'menu', wave: 'menu', encore: 'menu',
  browser: 'Unknown', viewport: '1280 × 720', pixel_ratio: '2.00'
});
// Browser families.
for (const [ua, expected] of [
  ['Edg/143.1 Chrome/142.0', 'Edge 143'],
  ['FxiOS/144.0 Safari/604.1', 'Firefox 144'],
  ['Version/26.0 Mobile/15E148 Safari/604.1', 'Safari 26'],
  ['unrecognized SecretSession/DO_NOT_EXPORT', 'Unknown']
]) {
  assert.equal(new URL(report.createBugReportURL({ userAgent: ua, view })).searchParams.get('browser'), expected, ua);
}
// Live link refresh through init().
let live = { ...runCtx };
report.initBugReportLinks(() => live);
assert.ok(links[0].href.includes('wave=W5'), 'menu link carries live run context');
assert.equal(links[0].attributes['aria-label'], 'Open the bug report form in a new tab');
live = { version: 'v9', view };
report.initBugReportLinks(() => live);
links[1].listeners.click();
assert.ok(new URL(links[1].href).searchParams.get('leader') === 'menu', 'click refreshes to menu context');
view.innerWidth = 1920; view.innerHeight = 1080;
links[1].listeners.focus();
assert.equal(new URL(links[1].href).searchParams.get('viewport'), '1920 × 1080', 'focus refreshes viewport');

// Endpoint must be a real form ID before release (placeholder fails here).
assert.ok(
  !report.BUG_REPORT_ENDPOINT.includes('KDA-REPORT-FORM'),
  'BUG_REPORT_ENDPOINT still holds the placeholder form ID — paste the real Tally URL first'
);

console.log('PASS: exact hidden-field contract, live run/menu context, browser parsing, bounded URL, no storage/session export.');
