// Endless scaling: strength ramp keeps pre-endless waves identical.
// Run: node scripts/check-endless.mjs
import assert from 'node:assert/strict';
import { getWaveStrengthBonus } from '../js/combat-rules.js';

// Pre-endless behavior unchanged (encore 3, wave idx 0/4/7/9).
assert.equal(getWaveStrengthBonus(0, 0), 0);
assert.equal(getWaveStrengthBonus(4, 0), 1);
assert.equal(getWaveStrengthBonus(7, 0), 2);
assert.equal(getWaveStrengthBonus(9, 0), 2);
assert.equal(getWaveStrengthBonus(5, 3), 2, 'encore 3 still +1');
// Endless ramp: +1 per wave beyond 9 on top of the thresholds.
assert.equal(getWaveStrengthBonus(10, 0), 3);
assert.equal(getWaveStrengthBonus(11, 0), 4);
assert.equal(getWaveStrengthBonus(15, 0), 8);
assert.equal(getWaveStrengthBonus(12, 3), 6);
// Monotonic non-decreasing across a long tour.
let prev = -1;
for (let i = 0; i < 60; i++) {
  const v = getWaveStrengthBonus(i, 0);
  assert.ok(v >= prev, `wave ${i} never weaker`);
  prev = v;
}

console.log('PASS: endless strength ramp, pre-endless values unchanged.');
