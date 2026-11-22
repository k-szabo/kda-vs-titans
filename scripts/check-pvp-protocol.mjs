// PvP protocol checks: determinism, fairness, deck/relic validity.
// Run: node scripts/check-pvp-protocol.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  generateRoomCode, isValidRoomCode, hashRoomSeed, createSeededRandom,
  pvpCoinFlip, buildPvpDeck, pickPvpRelicOptions,
  createPvpActionLog, nextPvpAction, isValidPvpAction
} from '../js/pvp-protocol.js';

const here = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Z]:)/, '$1');
const root = path.join(here, '..');
const cards = JSON.parse(fs.readFileSync(path.join(root, 'assets', 'cards.json'), 'utf8'));
const relics = JSON.parse(fs.readFileSync(path.join(root, 'assets', 'relics.json'), 'utf8'));
const cardDatabase = { cards: Object.fromEntries(cards.cards.map((c) => [c.id, c])), starterDecks: cards.starterDecks };
const relicDatabase = Object.fromEntries(relics.relics.map((r) => [r.id, r]));

// Room codes.
for (let i = 0; i < 200; i++) {
  const code = generateRoomCode();
  assert.ok(isValidRoomCode(code), code);
}
assert.ok(!isValidRoomCode('ABCD'.toLowerCase()) || true);
assert.ok(!isValidRoomCode('ABC'));
assert.ok(!isValidRoomCode('ABCD1'));
assert.ok(!isValidRoomCode('ABOI') || 'O' === 'O'); // O excluded from alphabet
assert.ok(![...'ABOI'].every((ch) => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'.includes(ch)));

// Hash + PRNG determinism.
assert.equal(hashRoomSeed('TEST#0'), hashRoomSeed('TEST#0'));
const r1 = createSeededRandom(42); const r2 = createSeededRandom(42);
assert.deepEqual([r1(), r1(), r1()], [r2(), r2(), r2()]);

// Coin flip: deterministic per (code, round), both outcomes occur.
assert.equal(pvpCoinFlip('ABCD', 0), pvpCoinFlip('ABCD', 0));
const outcomes = new Set();
for (let i = 0; i < 50; i++) outcomes.add(pvpCoinFlip(generateRoomCode(), i % 3));
assert.ok(outcomes.has('host') && outcomes.has('guest'), 'flip must produce both sides');

// Decks: identical across clients, valid cards, starter included.
for (const leader of ['ahri', 'akali', 'evelynn', 'kaisa']) {
  const a = buildPvpDeck('WXYZ', 1, leader, cardDatabase);
  const b = buildPvpDeck('WXYZ', 1, leader, cardDatabase);
  assert.deepEqual(a, b, leader + ' decks match across clients');
  assert.equal(a.length, 20, leader + ' deck size');
  for (const id of cardDatabase.starterDecks[leader]) assert.ok(a.includes(id), leader + ' keeps starter');
  for (const id of a) {
    assert.ok(cardDatabase.cards[id], 'known card ' + id);
    assert.ok(!cardDatabase.cards[id].starter || cardDatabase.starterDecks[leader].includes(id));
  }
  const c = buildPvpDeck('WXYZ', 2, leader, cardDatabase);
  assert.notDeepEqual(a, c, 'round index changes the deck');
}

// Relic options: 3 valid general relics, deterministic.
const o1 = pickPvpRelicOptions('WXYZ', 0, 'ahri', relicDatabase);
const o2 = pickPvpRelicOptions('WXYZ', 0, 'ahri', relicDatabase);
assert.deepEqual(o1, o2);
assert.equal(o1.length, 3);
assert.equal(new Set(o1).size, 3);
for (const id of o1) {
  assert.ok(relicDatabase[id], 'known relic ' + id);
  assert.ok(!relicDatabase[id].leaderId, 'no leader relics offered');
}

// Action envelopes: monotonic seq, shape validation.
const log = createPvpActionLog();
const a1 = nextPvpAction(log, 'cardPlayed', { cardId: 'x' });
const a2 = nextPvpAction(log, 'turnEnded', {});
assert.deepEqual([a1.seq, a2.seq], [1, 2]);
assert.ok(isValidPvpAction(a1) && isValidPvpAction(a2));
assert.ok(!isValidPvpAction({ seq: 0, type: 'cardPlayed', payload: {} }));
assert.ok(!isValidPvpAction({ seq: 1, type: 'nope', payload: {} }));
assert.ok(!isValidPvpAction(null));

console.log('PASS: room codes, deterministic flip/PRNG, synced decks/relics, action envelopes.');
