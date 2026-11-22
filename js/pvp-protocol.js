// PvP protocol core: pure functions with zero dependencies (no DOM, no
// network). Both clients run these independently on the same inputs and must
// arrive at identical results — this is what keeps the duel in sync without
// a server. Network (Realtime Broadcast) lives in js/pvp-net.js.

export const PVP_ROOM_CODE_LENGTH = 4;
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

// 4-char codes from an unambiguous alphabet (no I/L/O/0/1).
export function generateRoomCode(random = Math.random) {
  let code = '';
  for (let i = 0; i < PVP_ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[Math.floor(random() * ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

export function isValidRoomCode(code) {
  return typeof code === 'string' &&
    code.length === PVP_ROOM_CODE_LENGTH &&
    [...code].every((ch) => ROOM_CODE_ALPHABET.includes(ch));
}

// FNV-1a string hash: deterministic across browsers, no crypto needed.
export function hashRoomSeed(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

// Mulberry32 seeded PRNG: identical streams on both clients.
export function createSeededRandom(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

// Coin flip for first player: host=heads, guest=tails. Both clients compute
// it from (roomCode, roundIndex) so neither side can rig or dispute it.
export function pvpCoinFlip(roomCode, roundIndex) {
  const bit = hashRoomSeed(`${roomCode}#${roundIndex}`) & 1;
  return bit === 0 ? 'host' : 'guest';
}

// 20-card duel deck: the leader's 10-card starter plus 10 seeded picks from
// the draftable pool (non-starter, draftable). Pure from cardDatabase.
export function buildPvpDeck(roomCode, roundIndex, leader, cardDatabase, deckSize = 20) {
  const starter = (cardDatabase.starterDecks?.[leader] || []).slice();
  const pool = Object.values(cardDatabase.cards || {})
    .filter((card) => card && !card.starter && card.draftable !== false)
    .map((card) => card.id)
    .sort();
  const random = createSeededRandom(hashRoomSeed(`${roomCode}#${roundIndex}#${leader}#deck`));
  const extra = [];
  const want = Math.max(0, deckSize - starter.length);
  for (let i = 0; i < want && pool.length > 0; i++) {
    extra.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
  }
  return [...starter, ...extra];
}

// 3 general-relic options; the player keeps 2. Seeded identically so a
// spectator/reconnecting client can rebuild the offer.
export function pickPvpRelicOptions(roomCode, roundIndex, leader, relicDatabase) {
  const pool = Object.values(relicDatabase || {})
    .filter((relic) => relic && !relic.leaderId)
    .map((relic) => relic.id)
    .sort();
  const random = createSeededRandom(hashRoomSeed(`${roomCode}#${roundIndex}#${leader}#relics`));
  const options = [];
  for (let i = 0; i < 3 && pool.length > 0; i++) {
    options.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
  }
  return options;
}

// Action envelope for Broadcast events. seq is per-sender monotonic; a gap
// on receipt means packets were lost and triggers a snapshot resync.
export function createPvpActionLog() {
  return { nextSeq: 1 };
}

export function nextPvpAction(log, type, payload = {}) {
  const action = { seq: log.nextSeq, type, payload };
  log.nextSeq += 1;
  return action;
}

const PVP_ACTION_TYPES = new Set(['cardPlayed', 'turnEnded', 'roundReady', 'snapshotRequest', 'snapshotState']);

export function isValidPvpAction(action) {
  return Boolean(action) && typeof action === 'object' &&
    Number.isInteger(action.seq) && action.seq > 0 &&
    PVP_ACTION_TYPES.has(action.type) &&
    Boolean(action.payload) && typeof action.payload === 'object';
}
