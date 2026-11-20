// Missions are declarative data (assets/missions.json). This module reads stat
// values and evaluates the requiresAll / requiresAny condition DSL.

const RUN_STATS = Object.freeze({
  wavesCleared: (state) => state?.wavesCleared ?? 0,
  peakDamage: (state) => state?.peakSingleTurnDamage ?? 0,
  deckSize: (state) => state?.masterDeck?.length ?? 0,
  relicCount: (state) => state?.relics?.length ?? 0,
  isVictory: (state) => (state?.runStatus === 'victory' ? 1 : 0),
  encoreLevel: (state) => state?.encoreLevel ?? 0
});

const PROFILE_STATS = Object.freeze({
  bestWave: (profile) => profile?.highestWaveCleared ?? 0,
  maxEncore: (profile) => profile?.maxEncoreLevel ?? 0,
  totalWins: (profile) => Object.values(profile?.leaderWins ?? {}).reduce((sum, wins) => sum + (wins || 0), 0),
  winsAhri: (profile) => profile?.leaderWins?.ahri ?? 0,
  winsAkali: (profile) => profile?.leaderWins?.akali ?? 0,
  winsEvelynn: (profile) => profile?.leaderWins?.evelynn ?? 0,
  winsKaisa: (profile) => profile?.leaderWins?.kaisa ?? 0
});

const SOURCES = Object.freeze({ run: RUN_STATS, profile: PROFILE_STATS });

function testClause(clause, state, profile) {
  const reader = SOURCES[clause?.scope]?.[clause?.stat];
  if (typeof reader !== 'function' || !Number.isFinite(clause?.value)) return false;
  const actual = clause.scope === 'run' ? reader(state) : reader(profile);
  if (!Number.isFinite(actual)) return false;
  switch (clause.op) {
    case 'gte': return actual >= clause.value;
    case 'lte': return actual <= clause.value;
    case 'eq': return actual === clause.value;
    default: return false;
  }
}

export function testMission(mission, state, profile) {
  if (!mission || typeof mission !== 'object') return false;
  const all = Array.isArray(mission.requiresAll) ? mission.requiresAll : [];
  const any = Array.isArray(mission.requiresAny) ? mission.requiresAny : [];
  if (all.length === 0 && any.length === 0) return false;
  return all.every((clause) => testClause(clause, state, profile)) &&
    (any.length === 0 || any.some((clause) => testClause(clause, state, profile)));
}
