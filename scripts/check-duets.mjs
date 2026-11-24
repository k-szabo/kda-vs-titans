// Duet discount rules (costReductionIf) + new card contracts.
// Run: node scripts/check-duets.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getEffectiveCardCost } from '../js/card-effects.js';

const here = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Z]:)/, '$1');
const cards = JSON.parse(fs.readFileSync(path.join(here, '..', 'assets', 'cards.json'), 'utf8')).cards;
const byId = Object.fromEntries(cards.map((c) => [c.id, c]));

// Pure rule matrix (back-compat: omitted turnMembers behaves as before).
const base = { cost: 2 };
assert.equal(getEffectiveCardCost(base, 0), 2);
assert.equal(getEffectiveCardCost({ cost: 2, upgrade: { costReduction: 1 } }, 1), 1);
const duet = { cost: 2, costReductionIf: { member: 'akali', amount: 1 } };
assert.equal(getEffectiveCardCost(duet, 0), 2, 'no partner, full price');
assert.equal(getEffectiveCardCost(duet, 0, []), 2);
assert.equal(getEffectiveCardCost(duet, 0, ['ahri']), 2, 'wrong partner, full price');
assert.equal(getEffectiveCardCost(duet, 0, ['ahri', 'akali']), 1, 'partner played, discount');
assert.equal(getEffectiveCardCost(duet, 0, ['akali', 'ahri']), 1, 'order does not matter');
assert.equal(getEffectiveCardCost({ cost: 1, costReductionIf: { member: 'akali', amount: 5 } }, 0, ['akali']), 0, 'floors at zero');
assert.equal(getEffectiveCardCost({ cost: 2, costReductionIf: { member: 'sona', amount: 1 } }, 0, ['sona']), 2, 'non-K/DA member fails closed');
assert.equal(getEffectiveCardCost({ cost: 2, costReductionIf: { member: 'akali' } }, 0, ['akali']), 2, 'missing amount fails closed');
assert.equal(getEffectiveCardCost({ cost: 3, upgrade: { costReduction: 1 }, costReductionIf: { member: 'akali', amount: 1 } }, 1, ['akali']), 1, 'upgrade then duet');

// New cards exist with the exact contracted shape.
for (const [id, member, partner] of [
  ['ahri_duet_crossover', 'ahri', 'akali'],
  ['evelynn_duet_ambush', 'evelynn', 'kaisa']
]) {
  const card = byId[id];
  assert.ok(card, id + ' exists');
  assert.equal(card.member, member);
  assert.deepEqual(card.costReductionIf, { member: partner, amount: 1 });
  assert.equal(card.cost, 2);
  assert.equal(card.starter, false);
  assert.equal(card.draftable, true);
  assert.ok(card.upgrade && typeof card.upgrade.description === 'string');
  assert.ok(card.desc.includes(partner === 'akali' ? 'Akali' : "Kai'Sa"), 'desc names the partner');
}

// Draft pool picks them up for every leader.
const pool = cards.filter((c) => !c.starter && c.draftable !== false).map((c) => c.id);
assert.ok(pool.includes('ahri_duet_crossover') && pool.includes('evelynn_duet_ambush'));

console.log('PASS: duet discount matrix + new card contracts + draft availability.');
