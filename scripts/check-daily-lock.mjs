// Daily one-attempt lock: one finished run per day, exactly one retry
// granted only for a wave-0 defeat. Run: node scripts/check-daily-lock.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Z]:)/, '$1');
const root = path.join(here, '..');

const { getDailyAttemptStatus } = await import('../js/daily-challenge.js');

const DATE = '2026-11-27';
const lock = (overrides = {}) => ({ date: DATE, finishes: 0, lastWaves: 0, lastVictory: false, w0RetriesUsed: 0, ...overrides });

assert.equal(getDailyAttemptStatus({}, DATE), 'open', 'no lock yet: open');
assert.equal(getDailyAttemptStatus({ dailyLock: null }, DATE), 'open', 'null lock: open');
assert.equal(getDailyAttemptStatus({ dailyLock: { ...lock(), date: '2026-11-26' } }, DATE), 'open', 'yesterday lock: open');
assert.equal(getDailyAttemptStatus({ dailyLock: lock() }, DATE), 'open', 'no finishes: open');
assert.equal(getDailyAttemptStatus({ dailyLock: lock({ finishes: 1 }) }, DATE), 'retry', 'W0 defeat grants one retry');
assert.equal(getDailyAttemptStatus({ dailyLock: lock({ finishes: 1, lastWaves: 3 }) }, DATE), 'locked', 'W3 defeat locks');
assert.equal(getDailyAttemptStatus({ dailyLock: lock({ finishes: 1, lastVictory: true, lastWaves: 10 }) }, DATE), 'locked', 'victory locks');
assert.equal(getDailyAttemptStatus({ dailyLock: lock({ finishes: 1, w0RetriesUsed: 1 }) }, DATE), 'locked', 'used retry locks');
assert.equal(getDailyAttemptStatus({ dailyLock: lock({ finishes: 2 }) }, DATE), 'locked', 'second finish locks');
assert.equal(getDailyAttemptStatus({ dailyLock: lock({ finishes: 1, lastWaves: 0, lastVictory: true }) }, DATE), 'locked', 'W0 victory (impossible) is not a retry');

// Storage round-trip with a stubbed localStorage (profile v3, no reset).
const store = new Map();
globalThis.window = { localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) } };
const storage = await import('../js/profile-storage.js');
const keybinds = JSON.parse(fs.readFileSync(path.join(root, 'assets', 'keybinds.json'), 'utf8'));

const fresh = storage.createDefaultProfileStats(keybinds);
assert.equal(fresh.dailyLock, null, 'new profiles start unlocked');
storage.saveProfileStats({ ...fresh, dailyLock: lock({ finishes: 1 }) });
const loaded = storage.loadProfileStats(keybinds);
assert.deepEqual(loaded.dailyLock, lock({ finishes: 1 }), 'lock survives save/load');

storage.saveProfileStats({ ...fresh, dailyLock: { date: DATE, finishes: -1 } });
assert.throws(() => storage.loadProfileStats(keybinds), /unsupported shape/, 'negative finishes rejected');

const legacy = { ...fresh };
delete legacy.dailyLock;
storage.saveProfileStats(legacy);
assert.equal(storage.loadProfileStats(keybinds).dailyLock, null, 'pre-lock profiles load without reset');

// Wiring: finishes update at run end, resume-guard + notice + menu state.
const appSrc = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
assert.match(appSrc, /finishes: \(profileStats\.dailyLock\?\.date === date \?/, 'run end consumes the attempt');
assert.match(appSrc, /w0RetriesUsed: 1/, 'retry claim persisted');
assert.match(appSrc, /already played today/, 'locked players get a notice, not a run');
const menuSrc = fs.readFileSync(path.join(root, 'js', 'progression-ui.js'), 'utf8');
assert.match(menuSrc, /getDailyAttemptStatus\(profileStats, dailyChallenge\.date\)/, 'menu reflects the lock');

console.log('PASS: daily one-attempt lock with a single W0 retry.');
