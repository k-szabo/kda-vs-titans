export const KEYBIND_ACTIONS = Object.freeze([
  { id: 'card1', label: 'Play card slot 1' },
  { id: 'card2', label: 'Play card slot 2' },
  { id: 'card3', label: 'Play card slot 3' },
  { id: 'card4', label: 'Play card slot 4' },
  { id: 'card5', label: 'Play card slot 5' },
  { id: 'endTurn', label: 'End Turn' },
  { id: 'jointFinale', label: 'Joint Finale' },
  { id: 'leaderAbility', label: 'Leader Ability' }
]);

export function normalizeKeybind(value) {
  if (typeof value !== 'string') return null;
  if (value === ' ') return 'space';
  if (value.toLowerCase() === 'space') return 'space';
  return value.length === 1 && value !== ' '
    ? value.toLowerCase()
    : null;
}

export function isValidDefaultKeybinds(keybinds) {
  if (!keybinds || typeof keybinds !== 'object' || Array.isArray(keybinds)) return false;
  const actionIds = KEYBIND_ACTIONS.map(({ id }) => id);
  const bindings = actionIds.map((id) => keybinds[id]);
  return Object.keys(keybinds).length === actionIds.length &&
    actionIds.every((id) => Object.hasOwn(keybinds, id)) &&
    bindings.every((binding) => normalizeKeybind(binding) === binding) &&
    new Set(bindings).size === actionIds.length;
}

export function normalizeKeybinds(keybinds, defaultKeybinds) {
  if (!isValidDefaultKeybinds(defaultKeybinds)) {
    throw new Error('The default keyboard bindings are invalid.');
  }
  const normalized = {};
  const usedKeys = new Set();
  const fallbackKeys = Object.values(defaultKeybinds);

  KEYBIND_ACTIONS.forEach(({ id }) => {
    const requested = normalizeKeybind(keybinds?.[id]);
    const candidates = [requested, defaultKeybinds[id], ...fallbackKeys];
    const binding = candidates.find((candidate) => candidate && !usedKeys.has(candidate));
    normalized[id] = binding;
    usedKeys.add(binding);
  });

  return normalized;
}

export function getActionForKey(key, keybinds) {
  const pressedKey = normalizeKeybind(key);
  if (!pressedKey) return null;
  return KEYBIND_ACTIONS.find(({ id }) => keybinds[id] === pressedKey)?.id || null;
}

export function rebindKey(keybinds, action, key, defaultKeybinds) {
  if (!KEYBIND_ACTIONS.some(({ id }) => id === action)) {
    throw new Error(`Unknown keybind action: ${action}`);
  }
  const binding = normalizeKeybind(key);
  if (!binding) return null;

  const normalized = normalizeKeybinds(keybinds, defaultKeybinds);
  const previous = normalized[action];
  const swappedAction = KEYBIND_ACTIONS.find(({ id }) =>
    id !== action && normalized[id] === binding
  )?.id || null;
  const next = { ...normalized, [action]: binding };
  if (swappedAction) next[swappedAction] = previous;
  return { keybinds: next, swappedAction };
}
