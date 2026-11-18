export const PROFILE_VERSION = 1;
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

export function createDefaultProfileStats() {
  return {
    version: PROFILE_VERSION,
    highestWaveCleared: 0,
    fastestWinMs: null,
    unlockedKaiju: []
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

  if (
    !profile ||
    profile.version !== PROFILE_VERSION ||
    !Number.isInteger(profile.highestWaveCleared) ||
    profile.highestWaveCleared < 0 ||
    !(profile.fastestWinMs === null || (Number.isFinite(profile.fastestWinMs) && profile.fastestWinMs >= 0)) ||
    !Array.isArray(profile.unlockedKaiju) ||
    profile.unlockedKaiju.some((id) => typeof id !== 'string')
  ) {
    throw new InvalidProfileStatsError('Saved profile stats have an unsupported shape.');
  }

  return {
    version: PROFILE_VERSION,
    highestWaveCleared: profile.highestWaveCleared,
    fastestWinMs: profile.fastestWinMs,
    unlockedKaiju: [...new Set(profile.unlockedKaiju)]
  };
}

export function saveProfileStats(profile) {
  try {
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch (error) {
    throw new ProfileStorageError('Unable to save profile stats to browser storage.', error);
  }
}
