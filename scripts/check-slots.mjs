// Slots paytable boundaries + pull integration (seeded, pile-safe).
// Run: node scripts/check-slots.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createShop, resolveSlotsOutcome, SLOT_PRICE } from '../js/shop.js';

const here = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Z]:)/, '$1');
const root = path.join(here, '..');
const cards = JSON.parse(fs.readFileSync(path.join(root, 'assets', 'cards.json'), 'utf8'));
const relics = JSON.parse(fs.readFileSync(path.join(root, 'assets', 'relics.json'), 'utf8'));
const cardDatabase = Object.fromEntries(cards.cards.map((c) => [c.id, c]));
const relicDatabase = Object.fromEntries(relics.relics.map((r) => [r.id, r]));

// Paytable edges (roll, hasRelic) -> outcome.
const edges = [
  [0.0, true, 'card'], [0.4499, true, 'card'], [0.45, true, 'heal'],
  [0.6999, false, 'heal'], [0.70, true, 'relic'], [0.70, false, 'heal'],
  [0.8999, true, 'relic'], [0.90, true, 'jackpot'], [0.9999, false, 'jackpot']
];
for (const [roll, hasRelic, expected] of edges) {
  assert.equal(resolveSlotsOutcome(roll, hasRelic), expected, `roll=${roll} relic=${hasRelic}`);
}

// Integration with stubbed app deps and a seeded roll queue.
function makeShop(rolls, { tokens, ownedRelics, hp, maxHp } = {}) {
  const rollsLeft = [...rolls];
  let nextId = 1;
  const state = {
    runStatus: 'draft', stageIndex: 2, encoreLevel: 0, merchTokens: tokens ?? 50,
    modifiers: {}, relics: [...(ownedRelics || [])],
    masterDeck: [], drawPile: [], hand: [], discardPile: [], exhaustPile: [],
    buffs: [], player: { hp: hp ?? 60, maxHp: maxHp ?? 80 },
    shop: { cards: [], relic: null, removalUsed: false, healUsed: false },
    nextCardInstanceId: 1
  };
  const logs = [];
  const shop = createShop({
    getState: () => state,
    getCardDatabase: () => cardDatabase,
    getRelicDatabase: () => relicDatabase,
    shuffle: (arr) => [...arr].reverse(),
    nextRandom: () => rollsLeft.shift() ?? 0.99,
    addLog: (text) => logs.push(text),
    saveRunState: () => {},
    renderAll: () => {},
    showRouting: () => {},
    getUnownedRelicIds: () => Object.keys(relicDatabase).filter((id) => !relicDatabase[id].leaderId && !state.relics.includes(id)),
    pruneStaleRelicChoices: () => {}
  });
  return { shop, state, logs };
}

{
  const { shop, state, logs } = makeShop([0.1]);
  const before = state.masterDeck.length;
  shop.pullSlots();
  assert.equal(state.merchTokens, 50 - SLOT_PRICE);
  assert.equal(state.masterDeck.length, before + 1, 'card win lands in master deck');
  assert.ok(state.discardPile.some((i) => state.masterDeck.some((m) => m.instanceId === i.instanceId)), 'coverage valid');
  assert.ok(state.slotsLast.length > 0 && logs.some((l) => l.includes('🎰')));
}
{
  const { shop, state } = makeShop([0.5], { hp: 70 });
  shop.pullSlots();
  assert.equal(state.player.hp, 80, 'heal win capped at maxHp');
  assert.ok(state.slotsLast.includes('HP'));
}
{
  const { shop, state } = makeShop([0.8]);
  const before = state.relics.length;
  shop.pullSlots();
  assert.equal(state.relics.length, before + 1, 'relic win equipped');
}
{
  const { shop, state } = makeShop([0.95], { hp: 80 });
  const relicsBefore = state.relics.length;
  const deckBefore = state.masterDeck.length;
  shop.pullSlots();
  assert.equal(state.relics.length, relicsBefore + 1, 'jackpot relic');
  assert.equal(state.masterDeck.length, deckBefore + 1, 'jackpot card');
}
{
  // No unowned relics left -> relic outcome falls back to a heal.
  const allGeneral = Object.keys(relicDatabase).filter((id) => !relicDatabase[id].leaderId);
  const { shop, state } = makeShop([0.8], { ownedRelics: allGeneral, hp: 40 });
  shop.pullSlots();
  assert.equal(state.player.hp, 60, 'relic fallback heals when collection complete');
}
{
  // Broke players cannot pull.
  const { shop, state } = makeShop([0.1], { tokens: 3 });
  shop.pullSlots();
  assert.equal(state.merchTokens, 3, 'no charge below price');
  assert.equal(state.masterDeck.length, 0);
}

console.log('PASS: slots paytable edges, prizes, fallbacks, pile coverage, price gate.');
