// Permanent card finish track: basic -> shiny -> platinum -> holo.
// Finishes are per card ID, stored on the profile, and purely cosmetic.
// Costs are in Spotlight Shards (earned per wave cleared).

export const FINISH_LEVELS = Object.freeze([
  { level: 1, id: 'shiny', name: 'SHINY', cost: 2 },
  { level: 2, id: 'platinum', name: 'PLATINUM', cost: 3 },
  { level: 3, id: 'holo', name: 'HOLO', cost: 5 }
]);

export function getCardFinishLevel(cardFinishes, cardId) {
  const level = cardFinishes?.[cardId];
  return Number.isInteger(level) && level >= 0 && level <= 3 ? level : 0;
}

export function getNextFinishLevel(level) {
  return FINISH_LEVELS.find((finish) => finish.level === level + 1) || null;
}

export function getFinishClass(level) {
  return level >= 1 && level <= 3 ? `card-finish-${level}` : '';
}
