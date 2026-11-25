// Game-data validators: real assets pass, broken data fails naming the entry.
// Run: node scripts/check-game-data.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  validateManifest, validateCards, validateRelics, validateBosses,
  validateMissions, validateTourEvents, validateChangelog, validateLeaderArts
} from '../js/game-data.js';

const here = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Z]:)/, '$1');
const root = path.join(here, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));

const manifest = read('assets/data.json');
const cards = read('assets/cards.json');
const relics = { relics: read('assets/relics.json').relics };
const missions = read('assets/missions.json');
const changelog = read('assets/changelog.json');

// Real assets validate clean.
validateManifest(manifest);
validateLeaderArts(manifest);
validateCards(cards);
validateRelics(relics);
validateMissions(missions);
validateTourEvents();
validateChangelog(changelog, manifest.version);
const cardDb = Object.fromEntries(cards.cards.map((c) => [c.id, c]));
const bosses = manifest.encounterPools.flat().map((p) => read('assets/' + p.replace('./', '')));
validateBosses(bosses, cardDb);

// Each validator names the offending entry.
function fails(fn, fragment) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof Error, 'throws Error');
    assert.match(error.message, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `message names it: ${error.message.slice(0, 160)}`);
    return true;
  }, fragment);
}
fails(() => validateCards({ cards: [{ ...cards.cards[0], id: 'dup' }, { ...cards.cards[1], id: 'dup' }], starterDecks: cards.starterDecks }), 'dup');
fails(() => validateCards({ cards: [{ id: 'x', effects: [{ type: 'nope' }], log: {} }], starterDecks: cards.starterDecks }), '"x"');
fails(() => validateCards({ cards: cards.cards, starterDecks: { ahri: ['nope'] } }), 'starterDecks');
fails(() => validateRelics({ relics: [{ ...relics.relics[0], id: 'r2', effects: [{ trigger: 'x', type: 'y', amount: 1 }] }] }), 'r2');
fails(() => validateBosses([{ ...bosses[0], id: 'b2', patterns: [] }], cardDb), 'b2');
fails(() => validateMissions({ missions: [{ ...missions.missions[0], id: 'm2', requiresAll: [{ scope: 'run', stat: 'nope', op: 'gte', value: 1 }] }] }), 'm2');
fails(() => validateChangelog({ ...changelog, currentVersion: 'v0.0.0_00000000' }, manifest.version), 'currentVersion');
fails(() => validateManifest({ ...manifest, encounterPools: [[]] }), 'encounterPools');
fails(() => validateLeaderArts({ ...manifest, portraits: {} }), 'ahri');

console.log('PASS: real assets validate clean; broken data fails naming the entry.');
