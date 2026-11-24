// Run-history profile checks: defaults, round-trip, garbage tolerance.
// Run: node scripts/check-run-history.mjs
import assert from 'node:assert/strict';

const store = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
  }
};
const { createDefaultProfileStats, loadProfileStats, saveProfileStats } =
  await import('../js/profile-storage.js');
const keys = { card1: '1', card2: '2', card3: '3', card4: '4', card5: '5', endTurn: 'e', jointFinale: 'q', leaderAbility: 'r' };

// Defaults carry an empty history; missing field on old profiles is valid.
const fresh = createDefaultProfileStats(keys);
assert.deepEqual(fresh.runHistory, []);
store.set('encore-spire.profile', JSON.stringify({ ...fresh }));
delete JSON.parse(store.get('encore-spire.profile')).runHistory;
const legacy = loadProfileStats(keys);
assert.deepEqual(legacy.runHistory, []);

// Round-trip keeps entries; garbage entries are filtered, profile survives.
const good = { date: '2026-11-23', mode: 'daily', leader: 'ahri', encore: 2, victory: true, waves: 10, durationMs: 123456, receipt: 'K/DA // RECEIPT' };
saveProfileStats({ ...fresh, runHistory: [good, null, 'junk', { date: '2026-11-23', victory: false }, { ...good, waves: 99 }, { ...good, leader: 'nope' }] });
const loaded = loadProfileStats(keys);
assert.equal(loaded.runHistory.length, 2, 'keeps good + normalized-partial, drops null/junk/out-of-range');
assert.equal(loaded.runHistory[0].waves, 10);
assert.equal(loaded.runHistory[1].waves, 0, 'partial entry defaults waves to 0');
// Cap enforced at normalize (writer also caps).
const many = Array.from({ length: 15 }, (_, i) => ({ ...good, receipt: `r${i}` }));
saveProfileStats({ ...fresh, runHistory: many });
assert.equal(loadProfileStats(keys).runHistory.length, 10);

console.log('PASS: run-history defaults, round-trip, garbage tolerance, cap.');
