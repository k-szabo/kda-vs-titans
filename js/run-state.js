import { InvalidSavedRunError, RUN_SAVE_VERSION } from './run-storage.js';
import { LEADERS } from './leader-data.js';

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

export function migrateSavedRun(savedRun, { cardDatabase, relicDatabase, shuffle }) {
  if (savedRun?.version === RUN_SAVE_VERSION) return savedRun;
  if (savedRun?.version !== 1 || !isRecord(savedRun.state)) return savedRun;

  const oldState = savedRun.state;
  const cardIdPiles = ['drawPile', 'hand', 'discardPile', 'exhaustPile'];
  if (!Array.isArray(oldState.masterDeck) || !cardIdPiles.every((key) => Array.isArray(oldState[key]))) {
    throw new InvalidSavedRunError('The saved run does not contain valid card piles.');
  }

  let nextCardInstanceId = 1;
  const instancesByCard = new Map();
  const masterDeck = oldState.masterDeck.map((cardId) => {
    if (typeof cardId !== 'string' || !Object.hasOwn(cardDatabase, cardId)) {
      throw new InvalidSavedRunError('The saved run contains an unknown card.');
    }
    const instance = { instanceId: nextCardInstanceId++, cardId, upgradeLevel: 0 };
    if (!instancesByCard.has(cardId)) instancesByCard.set(cardId, []);
    instancesByCard.get(cardId).push(instance);
    return instance;
  });

  const usedInstances = new Set();
  const migratePile = (pile) => pile.map((cardId) => {
    const instance = instancesByCard.get(cardId)?.find((card) => !usedInstances.has(card.instanceId));
    if (!instance) throw new InvalidSavedRunError('The saved run card piles do not match its deck.');
    usedInstances.add(instance.instanceId);
    return instance;
  });
  const piles = Object.fromEntries(cardIdPiles.map((key) => [key, migratePile(oldState[key])]));
  if (usedInstances.size !== masterDeck.length) {
    throw new InvalidSavedRunError('The saved run deck contains cards outside its active piles.');
  }

  const relics = Array.isArray(oldState.relics) ? oldState.relics : [];
  const relicChoices = Array.isArray(oldState.relicChoices)
    ? oldState.relicChoices
    : oldState.runStatus === 'draft'
      ? shuffle(Object.keys(relicDatabase).filter((id) => !relics.includes(id))).slice(0, 3)
      : [];
  return {
    version: RUN_SAVE_VERSION,
    state: {
      ...oldState,
      ...piles,
      masterDeck,
      nextCardInstanceId,
      startedAt: Number.isFinite(oldState.startedAt) ? oldState.startedAt : Date.now(),
      draftChoices: Array.isArray(oldState.draftChoices) ? oldState.draftChoices : [],
      relics,
      relicChoices
    }
  };
}

export function isValidSavedRun(savedRun, { cardDatabase, relicDatabase, encounters }) {
  if (!savedRun || savedRun.version !== RUN_SAVE_VERSION || !isRecord(savedRun.state)) return false;
  const saved = savedRun.state;
  const piles = [saved.drawPile, saved.hand, saved.discardPile, saved.exhaustPile];
  if (!Array.isArray(saved.masterDeck) || saved.masterDeck.length === 0 || !piles.every(Array.isArray)) return false;

  const allInstances = piles.flat();
  const isCardInstance = (instance) =>
    isRecord(instance) &&
    Number.isInteger(instance.instanceId) &&
    instance.instanceId > 0 &&
    typeof instance.cardId === 'string' &&
    Object.hasOwn(cardDatabase, instance.cardId) &&
    Number.isInteger(instance.upgradeLevel) &&
    instance.upgradeLevel >= 0 &&
    instance.upgradeLevel <= 1 &&
    (instance.upgradeLevel === 0 || cardDatabase[instance.cardId].upgrade);
  const masterIds = new Set(saved.masterDeck.map((instance) => instance?.instanceId));
  const activeIds = new Set(allInstances.map((instance) => instance?.instanceId));
  const masterById = new Map(saved.masterDeck.map((instance) => [instance?.instanceId, instance]));

  if (
    !Array.isArray(saved.draftChoices) ||
    !Array.isArray(saved.relics) ||
    !Array.isArray(saved.relicChoices) ||
    !saved.masterDeck.every(isCardInstance) ||
    !allInstances.every(isCardInstance) ||
    !allInstances.every((instance) => {
      const masterInstance = masterById.get(instance.instanceId);
      return masterInstance &&
        masterInstance.cardId === instance.cardId &&
        masterInstance.upgradeLevel === instance.upgradeLevel;
    }) ||
    masterIds.size !== saved.masterDeck.length ||
    activeIds.size !== allInstances.length ||
    activeIds.size !== masterIds.size ||
    [...masterIds].some((id) => !activeIds.has(id)) ||
    !saved.draftChoices.every((id) => typeof id === 'string' && Object.hasOwn(cardDatabase, id) && !cardDatabase[id].starter) ||
    !saved.relics.every((id) => typeof id === 'string' && Object.hasOwn(relicDatabase, id)) ||
    new Set(saved.relics).size !== saved.relics.length ||
    !saved.relicChoices.every((id) => typeof id === 'string' && Object.hasOwn(relicDatabase, id) && !saved.relics.includes(id)) ||
    new Set(saved.relicChoices).size !== saved.relicChoices.length ||
    !Number.isInteger(saved.stageIndex) ||
    saved.stageIndex < 0 ||
    saved.stageIndex >= encounters.length ||
    !Number.isInteger(saved.turn) ||
    saved.turn < 1 ||
    !isFiniteNumber(saved.startedAt) ||
    saved.startedAt < 0 ||
    !Number.isInteger(saved.nextCardInstanceId) ||
    saved.nextCardInstanceId <= Math.max(0, ...saved.masterDeck.map((instance) => instance.instanceId)) ||
    !['playing', 'draft', 'victory', 'defeat'].includes(saved.runStatus) ||
    typeof saved.isPlayerTurn !== 'boolean' ||
    !LEADERS.some(({ id }) => id === saved.leader) ||
    typeof saved.leaderAbilityUsed !== 'boolean' ||
    !Array.isArray(saved.logs) ||
    !isRecord(saved.player) ||
    !isRecord(saved.player.statuses) ||
    !isRecord(saved.enemy) ||
    !isRecord(saved.enemy.statuses) ||
    !Array.isArray(saved.enemy.patterns) ||
    saved.enemy.patterns.length === 0 ||
    !isRecord(saved.enemy.assets) ||
    !isRecord(saved.enemy.visuals) ||
    typeof saved.enemy.assets.backdrop !== 'string' ||
    typeof saved.enemy.assets.illustration !== 'string' ||
    typeof saved.enemy.visuals.background !== 'string' ||
    !['hp', 'maxHp', 'block', 'energy', 'maxEnergy', 'cheer'].every((key) => isFiniteNumber(saved.player[key])) ||
    !['encore', 'weak'].every((key) => isFiniteNumber(saved.player.statuses[key])) ||
    !['hp', 'maxHp', 'block', 'patternStep'].every((key) => isFiniteNumber(saved.enemy[key])) ||
    !['charm', 'marked'].every((key) => isFiniteNumber(saved.enemy.statuses[key])) ||
    !saved.logs.every((entry) => isRecord(entry) && typeof entry.text === 'string' && typeof entry.colorClass === 'string' && Number.isInteger(entry.turn))
  ) {
    return false;
  }

  if (saved.enemy.id !== encounters[saved.stageIndex].id) return false;
  if (
    saved.player.maxHp <= 0 ||
    saved.player.hp < 0 ||
    saved.player.hp > saved.player.maxHp ||
    saved.enemy.maxHp <= 0 ||
    saved.enemy.hp < 0 ||
    saved.enemy.hp > saved.enemy.maxHp
  ) {
    return false;
  }
  if (saved.runStatus === 'draft') {
    return !saved.isPlayerTurn &&
      (saved.draftChoices.length > 0 || saved.relicChoices.length > 0) &&
      saved.enemy.hp === 0;
  }
  if (saved.runStatus === 'victory') {
    return !saved.isPlayerTurn && saved.stageIndex === encounters.length - 1 && saved.enemy.hp === 0;
  }
  if (saved.runStatus === 'defeat') return !saved.isPlayerTurn && saved.player.hp === 0;
  return saved.isPlayerTurn && saved.enemy.hp > 0 && saved.player.hp > 0;
}
