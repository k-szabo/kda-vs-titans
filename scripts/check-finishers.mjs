// Finisher sequencing rules (requires firstCard / lastEnergy) + new cards.
// Run: node scripts/check-finishers.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isPlayRequirementMet } from '../js/combat-rules.js';

const here = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Z]:)/, '$1');
const cards = JSON.parse(fs.readFileSync(path.join(here, '..', 'assets', 'cards.json'), 'utf8')).cards;
const byId = Object.fromEntries(cards.map((c) => [c.id, c]));

// Pure rule matrix.
assert.equal(isPlayRequirementMet(undefined, {}), true, 'no requires always playable');
assert.equal(isPlayRequirementMet({ firstCard: true }, { cardsPlayedThisTurn: 0, energy: 3, cost: 1 }), true);
assert.equal(isPlayRequirementMet({ firstCard: true }, { cardsPlayedThisTurn: 2, energy: 3, cost: 1 }), false);
assert.equal(isPlayRequirementMet({ lastEnergy: true }, { cardsPlayedThisTurn: 3, energy: 2, cost: 2 }), true);
assert.equal(isPlayRequirementMet({ lastEnergy: true }, { cardsPlayedThisTurn: 0, energy: 3, cost: 1 }), false);
assert.equal(isPlayRequirementMet({ lastEnergy: true }, { energy: 0, cost: 0 }), true, '0-cost at 0 energy is last energy');
assert.equal(isPlayRequirementMet({ firstCard: true, lastEnergy: true }, { cardsPlayedThisTurn: 0, energy: 1, cost: 1 }), true);
assert.equal(isPlayRequirementMet({ firstCard: true, lastEnergy: true }, { cardsPlayedThisTurn: 0, energy: 2, cost: 1 }), false);

// New cards exist with the exact contracted shape.
for (const [id, member, requires, amount] of [
  ['akali_first_strike', 'akali', { firstCard: true }, 8],
  ['ahri_encore_hit', 'ahri', { lastEnergy: true }, 12]
]) {
  const card = byId[id];
  assert.ok(card, id + ' exists');
  assert.equal(card.member, member);
  assert.deepEqual(card.requires, requires);
  assert.equal(card.starter, false);
  assert.equal(card.draftable, true);
  assert.equal(card.type, 'ATTACK');
  assert.ok(card.desc.includes('first card') || card.desc.includes('last Hype Energy'), 'desc states the rule');
  assert.ok(card.upgrade && typeof card.upgrade.description === 'string');
  const dmg = card.effects.find((e) => e.type === 'damage');
  assert.equal(dmg.amount, amount);
}

// Draft pool picks them up for every leader (not starter, draftable).
const pool = cards.filter((c) => !c.starter && c.draftable !== false).map((c) => c.id);
assert.ok(pool.includes('akali_first_strike') && pool.includes('ahri_encore_hit'));

console.log('PASS: finisher rule matrix + new card contracts + draft availability.');
