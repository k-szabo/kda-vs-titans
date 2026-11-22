import { createTurnMemberState, KDA_MEMBER_IDS, MAX_HAND_SIZE, MAX_HAND_LIMIT, MAX_BUFF_SLOTS } from './combat-rules.js';
import { InvalidSavedRunError, RUN_SAVE_VERSION } from './run-storage.js';
import { LEADERS } from './leader-data.js';
import { DAILY_MODIFIERS } from './daily-challenge.js';
import { TOUR_ROUTES } from './tour-routes.js';
import { TOUR_EVENTS } from './tour-events.js';

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const isDateString = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

function normalizeTurnMemberState(state) {
  const savedMembers = Array.isArray(state.turnMembersPlayed)
    ? state.turnMembersPlayed.filter((member) => KDA_MEMBER_IDS.includes(member))
    : [];
  const chain = isRecord(state.memberPlayChain) &&
      KDA_MEMBER_IDS.includes(state.memberPlayChain.member) &&
      Number.isInteger(state.memberPlayChain.count) &&
      state.memberPlayChain.count >= 0 &&
      state.memberPlayChain.count < 3
    ? { member: state.memberPlayChain.member, count: state.memberPlayChain.count }
    : createTurnMemberState().memberPlayChain;
  return {
    turnMembersPlayed: [...new Set(savedMembers)],
    memberPlayChain: chain,
    harmonyTriggered: state.harmonyTriggered === true
  };
}

function normalizeHandLimit(state) {
  return Number.isInteger(state.handLimit) &&
    state.handLimit >= MAX_HAND_SIZE &&
    state.handLimit <= MAX_HAND_LIMIT
    ? state.handLimit
    : MAX_HAND_SIZE;
}

function normalizeHandSize(state, handLimit) {
  const hand = Array.isArray(state.hand) ? [...state.hand] : [];
  const drawPile = Array.isArray(state.drawPile) ? [...state.drawPile] : [];
  if (hand.length > handLimit) {
    drawPile.push(...hand.splice(handLimit).reverse());
  }
  return { hand, drawPile };
}

function normalizeKeptCard(state, hand) {
  const keptId = state.keptCardInstanceId;
  return Number.isInteger(keptId) &&
    keptId > 0 &&
    hand.some((instance) => instance?.instanceId === keptId)
    ? keptId
    : null;
}

const TOUR_ROUTE_IDS = new Set(TOUR_ROUTES.map((route) => route.id));
const TOUR_EVENT_IDS = new Set(TOUR_EVENTS.map((event) => event.id));
const REWARD_MODES = new Set(['cards', 'relics', 'upgrades', 'cuts', 'rest']);

export const STAGE_HAZARDS = Object.freeze(['overcharge_grid', 'thermonuclear_heat', 'luminous_spores']);
const MODIFIER_IDS = Object.freeze(['chaosDraft', 'limitedRemovals', 'doubleHazards']);

function normalizeModifiers(state) {
  const raw = isRecord(state.modifiers) ? state.modifiers : {};
  return {
    modifiers: Object.fromEntries(MODIFIER_IDS.map((id) => [id, raw[id] === true])),
    secondHazard: typeof state.secondHazard === 'string' && STAGE_HAZARDS.includes(state.secondHazard)
      ? state.secondHazard
      : null
  };
}

function normalizeTourRouting(state) {
  return {
    routeChoices: Array.isArray(state.routeChoices)
      ? [...new Set(state.routeChoices.filter((id) => TOUR_ROUTE_IDS.has(id)))]
      : [],
    rewardMode: REWARD_MODES.has(state.rewardMode) ? state.rewardMode : null,
    tourEventId: typeof state.tourEventId === 'string' && TOUR_EVENT_IDS.has(state.tourEventId)
      ? state.tourEventId
      : null,
    encounterOrder: Array.isArray(state.encounterOrder) &&
      state.encounterOrder.length > 0 &&
      state.encounterOrder.every((id) => typeof id === 'string')
      ? [...state.encounterOrder] : null
  };
}

function normalizeShop(state, cardDatabase, relicDatabase) {
  const tokens = Number.isInteger(state.merchTokens) && state.merchTokens >= 0
    ? Math.min(state.merchTokens, 9999)
    : 0;
  const raw = isRecord(state.shop) ? state.shop : null;
  if (!raw) return { merchTokens: tokens, shop: null };
  const cards = Array.isArray(raw.cards)
    ? [...new Set(raw.cards.filter((id) =>
      typeof id === 'string' &&
      Object.hasOwn(cardDatabase, id) &&
      !cardDatabase[id].starter &&
      cardDatabase[id].draftable !== false
    ))].slice(0, 2)
    : [];
  const relic = typeof raw.relic === 'string' &&
    Object.hasOwn(relicDatabase, raw.relic) &&
    !relicDatabase[raw.relic].leaderId
    ? raw.relic
    : null;
  return {
    merchTokens: tokens,
    shop: {
      cards,
      relic,
      removalUsed: raw.removalUsed === true,
      healUsed: raw.healUsed === true
    }
  };
}

function normalizeBuffs(state, cardDatabase) {  const raw = Array.isArray(state.buffs) ? state.buffs : [];
  const buffs = [];
  const orphans = [];
  const seen = new Set();
  for (const entry of raw) {
    const card = isRecord(entry) ? cardDatabase[entry.cardId] : null;
    const usable = isRecord(entry) &&
      Number.isInteger(entry.instanceId) &&
      entry.instanceId > 0 &&
      !seen.has(entry.instanceId) &&
      Boolean(card) &&
      card.type === 'BUFF' &&
      Number.isInteger(entry.upgradeLevel) &&
      entry.upgradeLevel >= 0 &&
      entry.upgradeLevel <= 1;
    if (!usable || buffs.length >= MAX_BUFF_SLOTS) {
      if (isRecord(entry) &&
        Number.isInteger(entry.instanceId) &&
        Number.isInteger(entry.upgradeLevel) &&
        typeof entry.cardId === 'string' &&
        Object.hasOwn(cardDatabase, entry.cardId)) {
        orphans.push({
          instanceId: entry.instanceId,
          cardId: entry.cardId,
          upgradeLevel: entry.upgradeLevel
        });
      }
      continue;
    }
    const duration = card.buff?.duration;
    const remaining = entry.remaining === null
      ? null
      : Number.isInteger(entry.remaining) && entry.remaining > 0
        ? entry.remaining
        : Number.isInteger(duration)
          ? duration
          : null;
    buffs.push({
      instanceId: entry.instanceId,
      cardId: entry.cardId,
      upgradeLevel: entry.upgradeLevel,
      remaining
    });
    seen.add(entry.instanceId);
  }
  return { buffs, orphans };
}

function normalizeRunTracking(state, cardDatabase, encounterCount, relicDatabase) {
  const stageIndex = Number.isInteger(state.stageIndex) ? state.stageIndex : 0;
  const clearedCurrentStage = ['draft', 'victory'].includes(state.runStatus);
  const inferredWavesCleared = Math.min(encounterCount, stageIndex + Number(clearedCurrentStage));
  const cardPlayCounts = isRecord(state.cardPlayCounts)
    ? Object.fromEntries(Object.entries(state.cardPlayCounts).filter(([cardId, count]) =>
      Object.hasOwn(cardDatabase, cardId) && Number.isInteger(count) && count >= 0
    ))
    : {};
  return {
    wavesCleared: Number.isInteger(state.wavesCleared) &&
      state.wavesCleared >= 0 &&
      state.wavesCleared <= encounterCount
      ? state.wavesCleared
      : inferredWavesCleared,
    peakSingleTurnDamage: isFiniteNumber(state.peakSingleTurnDamage) && state.peakSingleTurnDamage >= 0
      ? state.peakSingleTurnDamage
      : Math.max(0, isFiniteNumber(state.damageDealtThisTurn) ? state.damageDealtThisTurn : 0),
    cardPlayCounts,
    dailyChallenge: state.dailyChallenge && isRecord(state.dailyChallenge)
      ? {
          ...state.dailyChallenge,
          relicId: state.dailyChallenge.relicId &&
            relicDatabase[state.dailyChallenge.relicId]?.leaderId
            ? null
            : state.dailyChallenge.relicId ?? null
        }
      : state.dailyChallenge ?? null,
    rngState: Number.isInteger(state.rngState) &&
      state.rngState >= 0 &&
      state.rngState <= 0xffffffff
      ? state.rngState
      : null
  };
}

export function migrateSavedRun(savedRun, { cardDatabase, relicDatabase, encounters, shuffle }) {
  if (savedRun?.version === RUN_SAVE_VERSION) {
    const state = savedRun.state;
    const encounter = encounters?.[state?.stageIndex];
    if (!isRecord(state) || !isRecord(state.enemy) || !encounter || state.enemy.id !== encounter.id) return savedRun;
    const encoreLevel = Number.isInteger(state.encoreLevel)
      ? Math.min(5, Math.max(0, state.encoreLevel))
      : 0;
    const phase2Ratio = encoreLevel >= 5 ? 0.6 : 0.5;

    const enragePassive = encounter.passives?.find((passive) =>
      passive.trigger === 'onHpBelowHalf' && passive.effect === 'enrage'
    );
    const applySavedEnrage = state.enemy.enrageTriggered !== true &&
      state.runStatus === 'playing' &&
      enragePassive &&
      isFiniteNumber(state.enemy.hp) &&
      isFiniteNumber(state.enemy.maxHp) &&
      state.enemy.hp > 0 &&
      state.enemy.hp <= state.enemy.maxHp * phase2Ratio;
    const enrageTriggered = state.enemy.enrageTriggered === true || Boolean(applySavedEnrage);
    const enemyStrength = isFiniteNumber(state.enemy.strength)
      ? state.enemy.strength
      : encounter.strength || 0;
    const patterns = enrageTriggered && encounter.phase2Patterns?.length
      ? encounter.phase2Patterns
      : encounter.patterns;
    const handLimit = normalizeHandLimit(state);
    const { buffs, orphans } = normalizeBuffs(state, cardDatabase);
    const buffIds = new Set(buffs.map((buff) => buff.instanceId));
    const keepNonBuff = (instance) => !buffIds.has(instance?.instanceId);
    const { hand: rawHand, drawPile: rawDrawPile } = normalizeHandSize(state, handLimit);
    const hand = rawHand.filter(keepNonBuff);
    const drawPile = rawDrawPile.filter(keepNonBuff);
    const discardPile = (Array.isArray(state.discardPile) ? state.discardPile : []).filter(keepNonBuff);
    const exhaustPile = (Array.isArray(state.exhaustPile) ? state.exhaustPile : []).filter(keepNonBuff);
    if (orphans.length > 0) {
      const masterIds = new Set((Array.isArray(state.masterDeck) ? state.masterDeck : [])
        .map((instance) => instance?.instanceId));
      const placedIds = new Set([...hand, ...drawPile, ...discardPile, ...exhaustPile, ...buffs]
        .map((instance) => instance.instanceId));
      orphans.forEach((orphan) => {
        if (masterIds.has(orphan.instanceId) && !placedIds.has(orphan.instanceId)) {
          discardPile.push(orphan);
          placedIds.add(orphan.instanceId);
        }
      });
    }
    const relics = Array.isArray(state.relics)
      ? state.relics.filter((id) =>
        !relicDatabase[id]?.leaderId || relicDatabase[id].leaderId === state.leader
      )
      : state.relics;
    const relicChoices = Array.isArray(state.relicChoices)
      ? state.relicChoices.filter((id) => !relicDatabase[id]?.leaderId)
      : state.relicChoices;
    const activeInstances = [
      ...drawPile,
      ...hand,
      ...discardPile,
      ...exhaustPile,
      ...buffs
    ];
    const highestCardInstanceId = Math.max(
      0,
      ...activeInstances.map((instance) => Number.isInteger(instance?.instanceId) ? instance.instanceId : 0),
      ...(Array.isArray(state.masterDeck)
        ? state.masterDeck.map((instance) => Number.isInteger(instance?.instanceId) ? instance.instanceId : 0)
        : [])
    );

    return {
      ...savedRun,
      state: {
        ...state,
        hand,
        drawPile,
        discardPile,
        exhaustPile,
        buffs,
        relics,
        relicChoices,
        ...normalizeTurnMemberState(state),
        ...normalizeRunTracking(state, cardDatabase, encounters.length, relicDatabase),
        ...normalizeTourRouting(state),
        ...normalizeShop(state, cardDatabase, relicDatabase),
        ...normalizeModifiers(state),
        encoreLevel,
        damageDealtThisTurn: isFiniteNumber(state.damageDealtThisTurn) ? state.damageDealtThisTurn : 0,
        handLimit,
        keptCardInstanceId: normalizeKeptCard(state, hand),
        skillsPlayedThisTurn: Number.isInteger(state.skillsPlayedThisTurn) && state.skillsPlayedThisTurn >= 0
          ? state.skillsPlayedThisTurn
          : 0,
        energyPenalty: Number.isInteger(state.energyPenalty) && state.energyPenalty >= 0 && state.energyPenalty <= 3
          ? state.energyPenalty
          : 0,
        nextCardInstanceId: Number.isInteger(state.nextCardInstanceId) && state.nextCardInstanceId > highestCardInstanceId
          ? state.nextCardInstanceId
          : highestCardInstanceId + 1,
        enemy: {
          ...state.enemy,
          strength: enemyStrength + (applySavedEnrage ? enragePassive.strength : 0),
          block: (isFiniteNumber(state.enemy.block) ? state.enemy.block : 0) +
            (applySavedEnrage ? enragePassive.block : 0),
          statuses: applySavedEnrage
            ? { ...state.enemy.statuses, charm: 0, marked: 0 }
            : state.enemy.statuses,
          enrageTriggered,
          passives: encounter.passives || [],
          stageEffect: encounter.stageEffect,
          phase2Patterns: encounter.phase2Patterns || [],
          patterns
        }
      }
    };
  }
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

  const leader = LEADERS.some(({ id }) => id === oldState.leader) ? oldState.leader : LEADERS[0].id;
  const relics = Array.isArray(oldState.relics)
    ? oldState.relics.filter((id) =>
      !relicDatabase[id]?.leaderId || relicDatabase[id].leaderId === leader
    )
    : [];
  const relicChoices = Array.isArray(oldState.relicChoices)
    ? oldState.relicChoices.filter((id) => !relicDatabase[id]?.leaderId)
    : oldState.runStatus === 'draft'
      ? shuffle(Object.keys(relicDatabase).filter((id) =>
        !relics.includes(id) && !relicDatabase[id].leaderId
      )).slice(0, 3)
      : [];
  const migratedState = {
    ...oldState,
    ...piles,
    ...normalizeTurnMemberState(oldState),
    ...normalizeRunTracking(oldState, cardDatabase, encounters.length, relicDatabase),
    masterDeck,
    nextCardInstanceId,
    encoreLevel: Number.isInteger(oldState.encoreLevel)
      ? Math.min(5, Math.max(0, oldState.encoreLevel))
      : 0,
    stageIndex: Number.isInteger(oldState.stageIndex) ? oldState.stageIndex : 0,
    leader,
    leaderAbilityUsed: oldState.leaderAbilityUsed === true,
    damageDealtThisTurn: 0,
    skillsPlayedThisTurn: 0,
    startedAt: Number.isFinite(oldState.startedAt) ? oldState.startedAt : Date.now(),
    draftChoices: Array.isArray(oldState.draftChoices) ? oldState.draftChoices : [],
    relics,
    relicChoices
  };
  return migrateSavedRun({
    version: RUN_SAVE_VERSION,
    state: migratedState
  }, { cardDatabase, relicDatabase, encounters, shuffle });
}

export function isValidSavedRun(savedRun, { cardDatabase, relicDatabase, encounters, encounterPools = [] }) {
  if (!savedRun || savedRun.version !== RUN_SAVE_VERSION || !isRecord(savedRun.state)) return false;
  const saved = savedRun.state;
  const piles = [saved.drawPile, saved.hand, saved.discardPile, saved.exhaustPile];
  if (!Array.isArray(saved.masterDeck) || saved.masterDeck.length === 0 || !piles.every(Array.isArray)) return false;
  if (!Array.isArray(saved.buffs) || saved.buffs.length > MAX_BUFF_SLOTS) return false;

  const buffInstances = saved.buffs.map((buff) => ({
    instanceId: buff?.instanceId,
    cardId: buff?.cardId,
    upgradeLevel: buff?.upgradeLevel
  }));
  const allInstances = [...piles.flat(), ...buffInstances];
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
    !Array.isArray(saved.routeChoices) ||
    saved.routeChoices.some((id) => typeof id !== 'string' || !TOUR_ROUTE_IDS.has(id)) ||
    new Set(saved.routeChoices).size !== saved.routeChoices.length ||
    !(saved.rewardMode === null || REWARD_MODES.has(saved.rewardMode)) ||
    !(saved.tourEventId === null || saved.tourEventId === undefined || (typeof saved.tourEventId === 'string' && TOUR_EVENT_IDS.has(saved.tourEventId))) ||
    !Array.isArray(saved.encounterOrder) ||
    saved.encounterOrder.length !== encounters.length ||
    saved.encounterOrder.some((id, index) => {
      if (typeof id !== 'string') return true;
      const slot = encounterPools[index];
      return !Array.isArray(slot) || !slot.includes(id);
    }) ||
    !Number.isInteger(saved.merchTokens) ||
    saved.merchTokens < 0 ||
    saved.merchTokens > 9999 ||
    !(saved.shop === null || saved.shop === undefined || (
      isRecord(saved.shop) &&
      Array.isArray(saved.shop.cards) &&
      saved.shop.cards.length <= 2 &&
      saved.shop.cards.every((id) =>
        typeof id === 'string' &&
        Object.hasOwn(cardDatabase, id) &&
        (saved.modifiers?.chaosDraft === true || !cardDatabase[id].starter) &&
        cardDatabase[id].draftable !== false) &&
      new Set(saved.shop.cards).size === saved.shop.cards.length &&
      (saved.shop.relic === null ||
        (typeof saved.shop.relic === 'string' &&
          Object.hasOwn(relicDatabase, saved.shop.relic) &&
          (saved.modifiers?.chaosDraft === true || !relicDatabase[saved.shop.relic].leaderId) &&
          !saved.relics.includes(saved.shop.relic))) &&
      typeof saved.shop.removalUsed === 'boolean' &&
      typeof saved.shop.healUsed === 'boolean'
    )) ||
    !isRecord(saved.modifiers) ||
    !MODIFIER_IDS.every((id) => saved.modifiers[id] === true || saved.modifiers[id] === false) ||
    !(saved.secondHazard === null || (typeof saved.secondHazard === 'string' && STAGE_HAZARDS.includes(saved.secondHazard))) ||
    saved.hand.length > (Number.isInteger(saved.handLimit) ? saved.handLimit : MAX_HAND_SIZE) ||
    !saved.masterDeck.every(isCardInstance) ||
    !allInstances.every(isCardInstance) ||
    !allInstances.every((instance) => {
      const masterInstance = masterById.get(instance.instanceId);
      if (masterInstance) {
        return masterInstance.cardId === instance.cardId &&
          masterInstance.upgradeLevel === instance.upgradeLevel;
      }
      const card = cardDatabase[instance.cardId];
      return card.type === 'STATUS' && card.draftable === false && instance.upgradeLevel === 0;
    }) ||
    masterIds.size !== saved.masterDeck.length ||
    activeIds.size !== allInstances.length ||
    [...masterIds].some((id) => !activeIds.has(id)) ||
    !saved.draftChoices.every((id) => typeof id === 'string' && Object.hasOwn(cardDatabase, id) && (saved.modifiers?.chaosDraft === true || !cardDatabase[id].starter) && cardDatabase[id].draftable !== false) ||
    !saved.relics.every((id) =>
      typeof id === 'string' &&
      Object.hasOwn(relicDatabase, id) &&
      (saved.modifiers?.chaosDraft === true || !relicDatabase[id].leaderId || relicDatabase[id].leaderId === saved.leader)
    ) ||
    new Set(saved.relics).size !== saved.relics.length ||
    !saved.relicChoices.every((id) =>
      typeof id === 'string' &&
      Object.hasOwn(relicDatabase, id) &&
      (saved.modifiers?.chaosDraft === true || !relicDatabase[id].leaderId) &&
      !saved.relics.includes(id)
    ) ||
    new Set(saved.relicChoices).size !== saved.relicChoices.length ||
    !Number.isInteger(saved.stageIndex) ||
    saved.stageIndex < 0 ||
    saved.stageIndex >= encounters.length ||
    !Number.isInteger(saved.turn) ||
    saved.turn < 1 ||
    !isFiniteNumber(saved.startedAt) ||
    saved.startedAt < 0 ||
    !Number.isInteger(saved.nextCardInstanceId) ||
    saved.nextCardInstanceId <= Math.max(0, ...allInstances.map((instance) => instance?.instanceId || 0)) ||
    !['playing', 'draft', 'victory', 'defeat'].includes(saved.runStatus) ||
    typeof saved.isPlayerTurn !== 'boolean' ||
    !LEADERS.some(({ id }) => id === saved.leader) ||
    typeof saved.leaderAbilityUsed !== 'boolean' ||
    !Number.isInteger(saved.encoreLevel) ||
    saved.encoreLevel < 0 ||
    saved.encoreLevel > 5 ||
    !Array.isArray(saved.logs) ||
    !Number.isInteger(saved.wavesCleared) ||
    saved.wavesCleared < 0 ||
    saved.wavesCleared > encounters.length ||
    !isFiniteNumber(saved.peakSingleTurnDamage) ||
    saved.peakSingleTurnDamage < 0 ||
    !isRecord(saved.cardPlayCounts) ||
    Object.entries(saved.cardPlayCounts).some(([cardId, count]) =>
      !Object.hasOwn(cardDatabase, cardId) || !Number.isInteger(count) || count < 0
    ) ||
    !(saved.dailyChallenge === null || (
      isRecord(saved.dailyChallenge) &&
      isDateString(saved.dailyChallenge.date) &&
      saved.dailyChallenge.seed === saved.dailyChallenge.date &&
      LEADERS.some(({ id }) => id === saved.dailyChallenge.leader) &&
      saved.dailyChallenge.leader === saved.leader &&
      (saved.dailyChallenge.relicId === null ||
        typeof saved.dailyChallenge.relicId === 'string' &&
          Object.hasOwn(relicDatabase, saved.dailyChallenge.relicId) &&
          !relicDatabase[saved.dailyChallenge.relicId].leaderId &&
          saved.relics.includes(saved.dailyChallenge.relicId)) &&
      DAILY_MODIFIERS.some(({ id }) => id === saved.dailyChallenge.modifier) &&
      Number.isInteger(saved.rngState) &&
      saved.rngState > 0 &&
      saved.rngState <= 0xffffffff
    )) ||
    !isRecord(saved.player) ||
    !isRecord(saved.player.statuses) ||
    !isRecord(saved.enemy) ||
    !isRecord(saved.enemy.statuses) ||
    !Array.isArray(saved.enemy.patterns) ||
    saved.enemy.patterns.length === 0 ||
    !Array.isArray(saved.enemy.passives) ||
    !Array.isArray(saved.enemy.phase2Patterns) ||
    !isRecord(saved.enemy.assets) ||
    !isRecord(saved.enemy.visuals) ||
    typeof saved.enemy.assets.backdrop !== 'string' ||
    typeof saved.enemy.assets.illustration !== 'string' ||
    typeof saved.enemy.visuals.background !== 'string' ||
    !['hp', 'maxHp', 'block', 'energy', 'maxEnergy', 'cheer'].every((key) => isFiniteNumber(saved.player[key])) ||
    !['encore', 'weak'].every((key) => isFiniteNumber(saved.player.statuses[key])) ||
    !['hp', 'maxHp', 'block', 'patternStep'].every((key) => isFiniteNumber(saved.enemy[key])) ||
    !isFiniteNumber(saved.enemy.strength) ||
    typeof saved.enemy.enrageTriggered !== 'boolean' ||
    !isFiniteNumber(saved.damageDealtThisTurn) ||
    saved.damageDealtThisTurn < 0 ||
    !Number.isInteger(saved.skillsPlayedThisTurn) ||
    saved.skillsPlayedThisTurn < 0 ||
    !Number.isInteger(saved.energyPenalty) ||
    saved.energyPenalty < 0 ||
    saved.energyPenalty > 3 ||
    !Number.isInteger(saved.handLimit) ||
    saved.handLimit < MAX_HAND_SIZE ||
    saved.handLimit > MAX_HAND_LIMIT ||
    !saved.buffs.every((buff) =>
      isRecord(buff) &&
      Number.isInteger(buff.instanceId) &&
      buff.instanceId > 0 &&
      typeof buff.cardId === 'string' &&
      cardDatabase[buff.cardId]?.type === 'BUFF' &&
      Number.isInteger(buff.upgradeLevel) &&
      buff.upgradeLevel >= 0 &&
      buff.upgradeLevel <= 1 &&
      (buff.remaining === null ||
        Number.isInteger(buff.remaining) && buff.remaining > 0)
    ) ||
    new Set(saved.buffs.map((buff) => buff.instanceId)).size !== saved.buffs.length ||
    !(saved.keptCardInstanceId === null ||
      Number.isInteger(saved.keptCardInstanceId) &&
        saved.keptCardInstanceId > 0 &&
        saved.hand.some((instance) => instance?.instanceId === saved.keptCardInstanceId)) ||
    !Array.isArray(saved.turnMembersPlayed) ||
    saved.turnMembersPlayed.some((member) => !KDA_MEMBER_IDS.includes(member)) ||
    new Set(saved.turnMembersPlayed).size !== saved.turnMembersPlayed.length ||
    !isRecord(saved.memberPlayChain) ||
    !(saved.memberPlayChain.member === null || KDA_MEMBER_IDS.includes(saved.memberPlayChain.member)) ||
    !Number.isInteger(saved.memberPlayChain.count) ||
    saved.memberPlayChain.count < 0 ||
    saved.memberPlayChain.count >= 3 ||
    typeof saved.harmonyTriggered !== 'boolean' ||
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
