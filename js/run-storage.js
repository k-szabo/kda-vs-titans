export const RUN_SAVE_VERSION = 4;
const RUN_SAVE_KEY = 'encore-spire.run';

export class RunStorageError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = 'RunStorageError';
  }
}

export class InvalidSavedRunError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = 'InvalidSavedRunError';
  }
}

export function loadSavedRun() {
  let serialized;
  try {
    serialized = window.localStorage.getItem(RUN_SAVE_KEY);
  } catch (error) {
    throw new RunStorageError('Unable to access browser storage.', error);
  }

  if (serialized === null) return null;

  try {
    return JSON.parse(serialized);
  } catch (error) {
    throw new InvalidSavedRunError('The saved run is not valid JSON.', error);
  }
}

export function clearSavedRun() {
  try {
    window.localStorage.removeItem(RUN_SAVE_KEY);
  } catch (error) {
    throw new RunStorageError('Unable to reset the saved run.', error);
  }
}

export function saveRun(state) {
  try {
    window.localStorage.setItem(RUN_SAVE_KEY, JSON.stringify({
      version: RUN_SAVE_VERSION,
      state
    }));
  } catch (error) {
    throw new RunStorageError('Unable to save the current run to browser storage.', error);
  }
}
