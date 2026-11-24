import { getUnlockedArtStyles, LEADERS, LEADER_ART_STYLES } from './leader-data.js';
import { normalizeKeybinds } from './keybinds.js';

export const PROFILE_VERSION = 3;
const PROFILE_KEY = 'encore-spire.profile';

export function createDefaultSettings(defaultKeybinds) {
  return {
    soundEnabled: true,
    shareScores: true,
    keybinds: normalizeKeybinds(defaultKeybinds, defaultKeybinds)
  };
}

function normalizeSettings(settings, defaultKeybinds) {
  return {
    soundEnabled: typeof settings?.soundEnabled === 'boolean' ? settings.soundEnabled : true,
    shareScores: typeof settings?.shareScores === 'boolean' ? settings.shareScores : true,
    keybinds: normalizeKeybinds(settings?.keybinds, defaultKeybinds)
  };
}

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

export function createDefaultProfileStats(defaultKeybinds) {
  const leaderWins = Object.fromEntries(LEADERS.map(({ id }) => [id, 0]));
  const maxEncoreWins = Object.fromEntries(LEADERS.map(({ id }) => [id, 0]));
  const selectedArts = Object.fromEntries(LEADERS.map(({ id }) => [id, 'popstars']));
  const artWaveClears = Object.fromEntries(LEADERS.map(({ id }) => [
    id,
    Object.fromEntries(LEADER_ART_STYLES.map(({ id: artId }) => [artId, 0]))
  ]));
  return {
    version: PROFILE_VERSION,
    settings: createDefaultSettings(defaultKeybinds),
    highestWaveCleared: 0,
    maxEncoreLevel: 0,
    fastestWinMs: null,
    dailyWinStreak: 0,
    dailyBestWinStreak: 0,
    lastDailyWinDate: null,
    unlockedKaiju: [],
    leaderWins,
    maxEncoreWins,
    selectedArts,
    artWaveClears,
    finishTokens: 0,
    cardFinishes: {},
    completedMissions: [],
    runHistory: [],
    playerName: null,
    lastCrownCheck: null
  };
}

export function loadProfileStats(defaultKeybinds) {
  let serialized;
  try {
    serialized = window.localStorage.getItem(PROFILE_KEY);
  } catch (error) {
    throw new ProfileStorageError('Unable to access browser storage for profile stats.', error);
  }

  if (serialized === null) return createDefaultProfileStats(defaultKeybinds);

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
  const finishes = profile.cardFinishes;
  const hasCardFinishes = finishes === undefined || finishes === null || (
    typeof finishes === 'object' && !Array.isArray(finishes) &&
    Object.entries(finishes).every(([cardId, level]) =>
      typeof cardId === 'string' && Number.isInteger(level) && level >= 0 && level <= 3
    )
  );
  const encoreWins = profile.maxEncoreWins;
  const hasEncoreWins = encoreWins === undefined || encoreWins === null || (
    typeof encoreWins === 'object' && !Array.isArray(encoreWins) &&
    LEADERS.every(({ id }) =>
      encoreWins[id] === undefined ||
      (Number.isInteger(encoreWins[id]) && encoreWins[id] >= 0 && encoreWins[id] <= 5)
    )
  );
  const completed = profile.completedMissions;
  const history = profile.runHistory;
  // Append-only log: only the array shape is enforced here; malformed
  // entries are filtered out by normalizeRunHistory instead of resetting
  // the whole profile.
  const hasRunHistory = history === undefined || history === null || Array.isArray(history);
  const hasMissions = completed === undefined || completed === null || (
    Array.isArray(completed) &&
    completed.every((id) => typeof id === 'string') &&
    new Set(completed).size === completed.length
  );
  const hasLeaderProgress = LEADERS.every(({ id }) =>
    isNonNegativeInteger(profile?.leaderWins?.[id]) &&
    getUnlockedArtStyles(profile.leaderWins[id]).some((style) =>
      style.id === profile.selectedArts?.[id]
    ) &&
    LEADER_ART_STYLES.every(({ id: artId }) =>
      profile.artWaveClears?.[id]?.[artId] === undefined ||
      isNonNegativeInteger(profile.artWaveClears[id][artId])
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
    !hasLeaderProgress ||
    (profile.finishTokens !== undefined && !isNonNegativeInteger(profile.finishTokens)) ||
    !hasCardFinishes ||
    !hasEncoreWins ||
    !hasMissions ||
    !hasRunHistory ||
    (profile.playerName !== undefined && profile.playerName !== null && typeof profile.playerName !== 'string') ||
    (profile.lastCrownCheck !== undefined && profile.lastCrownCheck !== null &&
      (typeof profile.lastCrownCheck !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(profile.lastCrownCheck)))
  ) {
    throw new InvalidProfileStatsError('Saved profile stats have an unsupported shape.');
  }

  function normalizeRunHistory(raw) {
    if (!Array.isArray(raw)) return [];
    const leaders = new Set(LEADERS.map(({ id }) => id));
    return raw.filter((entry) =>
      entry !== null && typeof entry === 'object' && !Array.isArray(entry) &&
      (typeof entry.date !== 'string' || entry.date.length <= 10) &&
      (entry.mode === undefined || entry.mode === 'standard' || entry.mode === 'daily') &&
      (!entry.leader || leaders.has(entry.leader)) &&
      (entry.encore === undefined || (Number.isInteger(entry.encore) && entry.encore >= 0 && entry.encore <= 5)) &&
      (entry.victory === undefined || typeof entry.victory === 'boolean') &&
      (entry.waves === undefined || (Number.isInteger(entry.waves) && entry.waves >= 0 && entry.waves <= 10)) &&
      (entry.durationMs === undefined || (Number.isFinite(entry.durationMs) && entry.durationMs >= 0)) &&
      (entry.receipt === undefined || typeof entry.receipt === 'string')
    ).slice(0, 10).map((entry) => ({
      date: typeof entry.date === 'string' ? entry.date : '',
      mode: entry.mode === 'daily' ? 'daily' : 'standard',
      leader: leaders.has(entry.leader) ? entry.leader : '',
      encore: Number.isInteger(entry.encore) ? entry.encore : 0,
      victory: entry.victory === true,
      waves: Number.isInteger(entry.waves) ? entry.waves : 0,
      durationMs: Number.isFinite(entry.durationMs) && entry.durationMs >= 0 ? Math.round(entry.durationMs) : 0,
      receipt: typeof entry.receipt === 'string' ? entry.receipt.slice(0, 8000) : ''
    }));
  }

  return {
    version: PROFILE_VERSION,
    settings: normalizeSettings(profile.settings, defaultKeybinds),
    highestWaveCleared: profile.highestWaveCleared,
    maxEncoreLevel: Number.isInteger(profile.maxEncoreLevel)
      ? Math.min(5, Math.max(0, profile.maxEncoreLevel))
      : 0,
    fastestWinMs: profile.fastestWinMs,
    dailyWinStreak: profile.dailyWinStreak ?? 0,
    dailyBestWinStreak: profile.dailyBestWinStreak ?? 0,
    lastDailyWinDate: profile.lastDailyWinDate ?? null,
    unlockedKaiju: [...new Set(profile.unlockedKaiju)],
    leaderWins: Object.fromEntries(LEADERS.map(({ id }) => [id, profile.leaderWins[id]])),
    maxEncoreWins: Object.fromEntries(LEADERS.map(({ id }) => [id, profile.maxEncoreWins?.[id] ?? 0])),
    selectedArts: Object.fromEntries(LEADERS.map(({ id }) => [id, profile.selectedArts[id]])),
    artWaveClears: Object.fromEntries(LEADERS.map(({ id }) => [
      id,
      Object.fromEntries(LEADER_ART_STYLES.map(({ id: artId }) => [
        artId,
        profile.artWaveClears[id][artId] ?? 0
      ]))
    ])),
    finishTokens: profile.finishTokens ?? 0,
    cardFinishes: { ...(profile.cardFinishes ?? {}) },
    completedMissions: [...(profile.completedMissions ?? [])],
    runHistory: normalizeRunHistory(profile.runHistory),
    playerName: typeof profile.playerName === 'string' ? profile.playerName : null,
    lastCrownCheck: typeof profile.lastCrownCheck === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(profile.lastCrownCheck)
      ? profile.lastCrownCheck
      : null
  };
}

export function saveProfileStats(profile) {
  try {
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch (error) {
    throw new ProfileStorageError('Unable to save profile stats to browser storage.', error);
  }
}
