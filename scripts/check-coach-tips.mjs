// Defeat-coach rules: each rule fires, priority wins, garbage-proof.
// Run: node scripts/check-coach-tips.mjs
import assert from 'node:assert/strict';
import { pickDefeatTip, COACH_TIP_RULE_IDS } from '../js/coach-tips.js';

const base = { wavesCleared: 5, energyLeft: 0, leaderAbilityUsed: true, peakDamage: 30, cheer: 10, distinctMembers: 4, totalPlays: 40, upgradesTaken: 2 };
assert.equal(pickDefeatTip({ ...base, wavesCleared: 1 }).id, 'early-block');
assert.equal(pickDefeatTip({ ...base, energyLeft: 3 }).id, 'spend-energy');
assert.equal(pickDefeatTip({ ...base, leaderAbilityUsed: false }).id, 'leader-ability');
assert.equal(pickDefeatTip({ ...base, cheer: 80 }).id, 'hoarded-cheer');
assert.equal(pickDefeatTip({ ...base, peakDamage: 5 }).id, 'low-damage');
assert.equal(pickDefeatTip({ ...base, distinctMembers: 1, totalPlays: 10 }).id, 'one-member');
assert.equal(pickDefeatTip({ ...base, upgradesTaken: 0 }).id, 'no-upgrades');
assert.equal(pickDefeatTip(base).id, 'fallback');
// Priority: first match wins when several match.
assert.equal(pickDefeatTip({ ...base, wavesCleared: 0, energyLeft: 3, cheer: 90 }).id, 'early-block');
assert.equal(pickDefeatTip({ ...base, energyLeft: 2, leaderAbilityUsed: false }).id, 'spend-energy');
// Garbage in, fallback out — never throws, always a tip.
assert.equal(pickDefeatTip({}).id, 'fallback');
assert.equal(pickDefeatTip(null).id, 'fallback');
assert.equal(pickDefeatTip(undefined).id, 'fallback');
assert.equal(pickDefeatTip({ wavesCleared: 'x', energyLeft: -1 }).id, 'fallback');
for (const id of COACH_TIP_RULE_IDS) {
  const tip = pickDefeatTip({ ...base, wavesCleared: id === 'early-block' ? 0 : 5 });
  assert.ok(tip && typeof tip.text === 'string' && tip.text.length > 20);
}
assert.deepEqual([...COACH_TIP_RULE_IDS].sort(), [...new Set(COACH_TIP_RULE_IDS)].sort(), 'rule ids unique');

console.log('PASS: coach rules fire, priority holds, garbage-proof.');
