export function applyPlayerDamage(player, rawDamage) {
  const blocked = Math.min(player.block, rawDamage);
  player.block -= blocked;
  const damageAfterBlock = rawDamage - blocked;
  const hpLost = Math.min(player.hp, damageAfterBlock);
  player.hp -= hpLost;
  const cheerLost = Math.min(player.cheer, hpLost);
  player.cheer -= cheerLost;
  return { blocked, damageAfterBlock, hpLost, cheerLost };
}
