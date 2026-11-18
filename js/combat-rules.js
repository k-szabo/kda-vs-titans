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
