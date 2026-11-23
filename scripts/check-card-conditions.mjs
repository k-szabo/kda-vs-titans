// Conditional `when` gating checks (preview honesty + bonus glow).
// Run: node scripts/check-card-conditions.mjs
import assert from 'node:assert/strict';
import { isWhenConditionMet } from '../js/combat-rules.js';

const enemy = { charm: 2, marked: 0 };
const player = { encore: 1, weak: 0 };

// No condition always fires; unknown targets fail closed.
assert.equal(isWhenConditionMet(enemy, player, null), true);
assert.equal(isWhenConditionMet(enemy, player, undefined), true);
assert.equal(isWhenConditionMet(enemy, player, { target: 'boss', status: 'charm' }), false);

// Enemy-targeted conditions read enemy statuses only.
assert.equal(isWhenConditionMet(enemy, player, { target: 'enemy', status: 'charm' }), true);
assert.equal(isWhenConditionMet(enemy, player, { target: 'enemy', status: 'marked' }), false);
assert.equal(isWhenConditionMet({}, player, { target: 'enemy', status: 'charm' }), false);
assert.equal(isWhenConditionMet(null, player, { target: 'enemy', status: 'charm' }), false);

// Player-targeted conditions read player statuses only.
assert.equal(isWhenConditionMet(enemy, player, { target: 'player', status: 'encore' }), true);
assert.equal(isWhenConditionMet(enemy, player, { target: 'player', status: 'weak' }), false);
assert.equal(isWhenConditionMet(enemy, {}, { target: 'player', status: 'encore' }), false);
// A player-side encore must NOT satisfy an enemy-side check (no cross-talk).
assert.equal(isWhenConditionMet({}, { encore: 3 }, { target: 'enemy', status: 'encore' }), false);

console.log('PASS: when-gating matrix (null/unknown/enemy/player/null-maps, no cross-talk).');
