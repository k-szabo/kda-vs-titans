import { getUnlockedArtStyles, LEADERS, LEADER_ART_STYLES } from './leader-data.js';

export const PROFILE_VERSION = 3;
const PROFILE_KEY = 'encore-spire.profile';

export class ProfileStorageError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = 'ProfileStorageError';
  }
}

export class InvalidProfileStatsError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = 'InvalidProfileStatsError';
  }
}

export class OutdatedProfileStatsError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OutdatedProfileStatsError';
  }
}

export function createDefaultProfileStats() {
  const leaderWins = Object.fromEntries(LEADERS.map(({ id }) => [id, 0]));
  const selectedArts = Object.fromEntries(LEADERS.map(({ id }) => [id, 'popstars']));
  const artWaveClears = Object.fromEntries(LEADERS.map(({ id }) => [
    id,
    Object.fromEntries(LEADER_ART_STYLES.map(({ id: artId }) => [artId, 0]))
  ]));
  return {
    version: PROFILE_VERSION,
    highestWaveCleared: 0,
    maxEncoreLevel: 0,
    fastestWinMs: null,
    dailyWinStreak: 0,
    dailyBestWinStreak: 0,
    lastDailyWinDate: null,
    unlockedKaiju: [],
    leaderWins,
    selectedArts,
    artWaveClears
  };
}

export function loadProfileStats() {
  let serialized;
  try {
    serialized = window.localStorage.getItem(PROFILE_KEY);
  } catch (error) {
    throw new ProfileStorageError('Unable to access browser storage for profile stats.', error);
  }

  if (serialized === null) return createDefaultProfileStats();

  let profile;
  try {
    profile = JSON.parse(serialized);
  } catch (error) {
    throw new InvalidProfileStatsError('Saved profile stats are not valid JSON.', error);
  }

  if (Number.isInteger(profile?.version) && profile.version < PROFILE_VERSION) {
    throw new OutdatedProfileStatsError('Saved profile progress was reset by this update.');
  }

  const isNonNegativeInteger = (value) => Number.isInteger(value) && value >= 0;
  const isDailyDate = (value) => {
    if (value === null) return true;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsedDate = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === value;
  };
  const hasLeaderProgress = LEADERS.every(({ id }) =>
    isNonNegativeInteger(profile?.leaderWins?.[id]) &&
    getUnlockedArtStyles(profile.leaderWins[id]).some((style) =>
      style.id === profile.selectedArts?.[id]
    ) &&
    LEADER_ART_STYLES.every(({ id: artId }) =>
      isNonNegativeInteger(profile.artWaveClears?.[id]?.[artId])
    )
  );
  if (
    !profile ||
    profile.version !== PROFILE_VERSION ||
    !Number.isInteger(profile.highestWaveCleared) ||
    profile.highestWaveCleared < 0 ||
    (profile.maxEncoreLevel !== undefined &&
      (!Number.isInteger(profile.maxEncoreLevel) || profile.maxEncoreLevel < 0 || profile.maxEncoreLevel > 5)) ||
    !(profile.fastestWinMs === null || (Number.isFinite(profile.fastestWinMs) && profile.fastestWinMs >= 0)) ||
    profile.dailyWinStreak !== undefined && !isNonNegativeInteger(profile.dailyWinStreak) ||
    profile.dailyBestWinStreak !== undefined && !isNonNegativeInteger(profile.dailyBestWinStreak) ||
    profile.lastDailyWinDate !== undefined && !isDailyDate(profile.lastDailyWinDate) ||
    !Array.isArray(profile.unlockedKaiju) ||
    profile.unlockedKaiju.some((id) => typeof id !== 'string') ||
    !profile.leaderWins ||
    !profile.selectedArts ||
    !profile.artWaveClears ||
    !hasLeaderProgress
  ) {
    throw new InvalidProfileStatsError('Saved profile stats have an unsupported shape.');
  }

  return {
    version: PROFILE_VERSION,
    highestWaveCleared: profile.highestWaveCleared,
    maxEncoreLevel: Math.min(5, Math.max(
      Number.isInteger(profile.maxEncoreLevel) ? profile.maxEncoreLevel : 0,
      Object.values(profile.leaderWins).reduce((sum, wins) => sum + (Number.isInteger(wins) ? wins : 0), 0)
    )),
    fastestWinMs: profile.fastestWinMs,
    dailyWinStreak: profile.dailyWinStreak ?? 0,
    dailyBestWinStreak: profile.dailyBestWinStreak ?? 0,
    lastDailyWinDate: profile.lastDailyWinDate ?? null,
    unlockedKaiju: [...new Set(profile.unlockedKaiju)],
    leaderWins: Object.fromEntries(LEADERS.map(({ id }) => [id, profile.leaderWins[id]])),
    selectedArts: Object.fromEntries(LEADERS.map(({ id }) => [id, profile.selectedArts[id]])),
    artWaveClears: Object.fromEntries(LEADERS.map(({ id }) => [
      id,
      Object.fromEntries(LEADER_ART_STYLES.map(({ id: artId }) => [
        artId,
        profile.artWaveClears[id][artId]
      ]))
    ]))
  };
}

export function saveProfileStats(profile) {
  try {
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch (error) {
    throw new ProfileStorageError('Unable to save profile stats to browser storage.', error);
  }
}
