export const KDA_MEMBER_IDS = Object.freeze(['ahri', 'akali', 'evelynn', 'kaisa']);

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
