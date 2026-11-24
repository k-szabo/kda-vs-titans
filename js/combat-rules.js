export const KDA_MEMBER_IDS = Object.freeze(['ahri', 'akali', 'evelynn', 'kaisa']);
export const MAX_HAND_SIZE = 5;
// Hard ceiling for effects that temporarily raise the hand limit.
export const MAX_HAND_LIMIT = 10;
// Fixed number of buff slots on stage.
export const MAX_BUFF_SLOTS = 3;

// Single source of truth for wave scaling. HP handled at the call site;
// this is the bonus Strength bosses start with. Endless waves (index 10+)
// keep ramping: +1 per extra wave on top of the E5/E8 thresholds.
export function getWaveStrengthBonus(stageIndex, encoreLevel) {
  return (encoreLevel >= 3 ? 1 : 0) +
    (stageIndex >= 4 ? 1 : 0) +
    (stageIndex >= 7 ? 1 : 0) +
    (stageIndex >= 10 ? stageIndex - 9 : 0);
}

// Single source of truth for member synergy numbers. The engine, the combat
// legend, and How to Play all read from here so text cannot drift from effects.
export const MEMBER_SYNERGY = Object.freeze({
  quartet: Object.freeze({ energy: 1, block: 6, cheer: 10 }),
  spotlight: Object.freeze({
    ahri: Object.freeze({ charm: 1, heal: 3 }),
    akali: Object.freeze({ damage: 6, pierce: 1, draw: 1 }),
    evelynn: Object.freeze({ marked: 1, stealBlock: 3 }),
    kaisa: Object.freeze({ block: 8, encore: 1 })
  })
});

export function getDeathLogEntries(logs, limit = 8) {
  if (!Array.isArray(logs) || logs.length === 0) return [];
  return logs.slice(0, limit).reverse();
}

// Sequencing gate for finisher cards (`requires`): firstCard means no card
// played yet this turn; lastEnergy means the cost spends your last energy.
// Pure so the play path and the card preview share one rule.
export function isPlayRequirementMet(requires, { cardsPlayedThisTurn = 0, energy = 0, cost = 0 } = {}) {
  if (!requires) return true;
  if (requires.firstCard === true && cardsPlayedThisTurn !== 0) return false;
  if (requires.lastEnergy === true && cost !== energy) return false;
  return true;
}

// Single source of truth for `when` gating: a conditional effect (or its
// preview) fires only while the named status is active on its target.
// enemyStatuses/playerStatuses are plain {status: turns} maps; unknown targets
// never match so a typo fails closed instead of buffing everything.
export function isWhenConditionMet(enemyStatuses, playerStatuses, when) {
  if (!when) return true;
  if (when.target === 'enemy') return (enemyStatuses?.[when.status] || 0) > 0;
  if (when.target === 'player') return (playerStatuses?.[when.status] || 0) > 0;
  return false;
}

export function createTurnMemberState() {
  return {
    turnMembersPlayed: [],
    memberPlayChain: { member: null, count: 0 },
    harmonyTriggered: false
  };
}

export function recordMemberPlay(state, member) {
  if (!Array.isArray(state.turnMembersPlayed)) state.turnMembersPlayed = [];
  if (!state.memberPlayChain || typeof state.memberPlayChain !== 'object') {
    state.memberPlayChain = { member: null, count: 0 };
  }
  if (typeof state.harmonyTriggered !== 'boolean') state.harmonyTriggered = false;

  if (!KDA_MEMBER_IDS.includes(member)) {
    state.memberPlayChain = { member: null, count: 0 };
    return { harmonyTriggered: false, spotlightTriggered: false };
  }

  if (!state.turnMembersPlayed.includes(member)) state.turnMembersPlayed.push(member);
  const chain = state.memberPlayChain;
  chain.count = chain.member === member ? chain.count + 1 : 1;
  chain.member = member;

  const harmonyTriggered = !state.harmonyTriggered &&
    KDA_MEMBER_IDS.every((memberId) => state.turnMembersPlayed.includes(memberId));
  if (harmonyTriggered) state.harmonyTriggered = true;

  const spotlightTriggered = chain.count >= 3;
  if (spotlightTriggered) chain.count = 0;

  return { harmonyTriggered, spotlightTriggered };
}

export function applyPlayerDamage(player, rawDamage, pierce = 0) {
  const pierceRatio = Number.isFinite(pierce) ? Math.min(1, Math.max(0, pierce)) : 0;
  const shieldableDamage = Math.ceil(rawDamage * (1 - pierceRatio));
  const blocked = Math.min(player.block, shieldableDamage);
  player.block -= blocked;
  const damageAfterBlock = rawDamage - blocked;
  const hpLost = Math.min(player.hp, damageAfterBlock);
  player.hp -= hpLost;
  const cheerLost = Math.min(player.cheer, hpLost);
  player.cheer -= cheerLost;
  return { blocked, damageAfterBlock, hpLost, cheerLost };
}

export function calculateEnemyAttackDamage(enemy, baseDamage) {
  const strength = Number.isFinite(enemy.strength) ? enemy.strength : 0;
  return Math.max(0, baseDamage + strength);
}

export function shouldInterruptChargedIntent(intent, damageDealtThisTurn) {
  return Boolean(
    intent.charged &&
    Number.isFinite(intent.interruptThreshold) &&
    Number.isFinite(damageDealtThisTurn) &&
    damageDealtThisTurn >= intent.interruptThreshold
  );
}

export function getEncoreBossMaxHp(baseMaxHp, encoreLevel) {
  if (!Number.isFinite(baseMaxHp) || encoreLevel < 1) return baseMaxHp;
  return Math.ceil(baseMaxHp * 1.15);
}

export function getEncoreInterruptThreshold(baseThreshold, encoreLevel) {
  if (!Number.isFinite(baseThreshold)) return baseThreshold;
  return baseThreshold + (encoreLevel >= 5 ? 4 : 0);
}

export function getEncorePhase2Ratio(encoreLevel) {
  return encoreLevel >= 5 ? 0.6 : 0.5;
}
