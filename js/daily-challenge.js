export const DAILY_MODIFIERS = Object.freeze([
  {
    id: 'acoustic_set',
    name: 'Acoustic Set',
    description: 'Start with 4 max Energy and no starter Relic.'
  },
  {
    id: 'encore_pressure',
    name: 'Encore Pressure',
    description: 'Bosses have +15% HP; start with a random Relic.'
  },
  {
    id: 'crowd_surf',
    name: 'Crowd Surf',
    description: 'Start each wave with +15% Crowd Cheer and a random Relic.'
  }
]);

function hashSeed(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0 || 1;
}

export function nextSeededRandom(generator) {
  let value = generator.rngState >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  generator.rngState = value >>> 0;
  return generator.rngState / 0x100000000;
}

export function createDailyChallenge(date, leaderIds, relicIds) {
  const parsedDate = typeof date === 'string' ? new Date(`${date}T00:00:00Z`) : null;
  if (
    !parsedDate ||
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== date ||
    leaderIds.length === 0 ||
    relicIds.length === 0
  ) {
    throw new Error('A daily challenge requires a valid date, leaders, and relics.');
  }

  const generator = { rngState: hashSeed(`encore-spire:${date}`) };
  const leader = leaderIds[Math.floor(nextSeededRandom(generator) * leaderIds.length)];
  const modifier = DAILY_MODIFIERS[
    Math.floor(nextSeededRandom(generator) * DAILY_MODIFIERS.length)
  ];
  const relicId = modifier.id === 'acoustic_set'
    ? null
    : relicIds[Math.floor(nextSeededRandom(generator) * relicIds.length)];

  return {
    date,
    seed: date,
    leader,
    relicId,
    modifier: modifier.id,
    rngState: generator.rngState
  };
}

// Daily one-attempt lock (pure, testable). Profile tracks
// `dailyLock: { date, finishes, lastWaves, lastVictory, w0RetriesUsed }`.
// Exactly one retry is granted, and only for a wave-0 defeat:
// 'open' (fresh day or no finish yet) | 'retry' (W0 wipe, retry unused) | 'locked'.
export function getDailyAttemptStatus(profile, date) {
  const lock = profile?.dailyLock;
  if (!lock || lock.date !== date) return 'open';
  if (!Number.isInteger(lock.finishes) || lock.finishes <= 0) return 'open';
  const w0Wipe = (lock.lastWaves ?? 0) === 0 && lock.lastVictory === false;
  if (lock.finishes === 1 && w0Wipe && (lock.w0RetriesUsed ?? 0) === 0) return 'retry';
  return 'locked';
}
