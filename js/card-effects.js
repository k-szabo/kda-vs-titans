import { KDA_MEMBER_IDS } from './combat-rules.js';

function matchesCondition(condition, ctx) {
  if (!condition) return true;
  if (condition.target !== 'enemy' && condition.target !== 'player') return false;
  return ctx.hasStatus(condition.target, condition.status);
}

function formatLog(template, values) {
  return template.replace(/\{([a-zA-Z]+)\}/g, (placeholder, key) => {
    if (!Object.hasOwn(values, key)) {
      throw new Error(`Unknown card log placeholder: ${placeholder}`);
    }
    return values[key];
  });
}

export function getEffectiveCardCost(card, upgradeLevel = 0, turnMembers = []) {
  const reduction = (card.upgrade?.costReduction || 0) * upgradeLevel;
  let cost = Math.max(0, card.cost - reduction);
  // Duet discount: cheaper when the partner member already played this turn.
  // Unknown members fail closed (validated in game-data, enforced here too).
  const duet = card.costReductionIf;
  if (duet && typeof duet === 'object' && !Array.isArray(duet) &&
    KDA_MEMBER_IDS.includes(duet.member) && Number.isInteger(duet.amount) && duet.amount > 0 &&
    Array.isArray(turnMembers) && turnMembers.includes(duet.member)) {
    cost = Math.max(0, cost - duet.amount);
  }
  return cost;
}

export function executeCardEffects(card, ctx, upgradeLevel = 0) {
  const values = { damage: 0, block: 0, heal: 0, encore: 0, stolen: 0 };

  card.effects.forEach((effect) => {
    if (!matchesCondition(effect.when, ctx)) return;
    const amount = effect.amount === undefined
      ? undefined
      : effect.amount + (effect.upgradeAmount || 0) * upgradeLevel;

    switch (effect.type) {
      case 'damage': {
        const pierce = Number.isFinite(effect.pierce) ? Math.min(1, Math.max(0, effect.pierce)) : 0;
        for (let hit = 0; hit < (effect.hits || 1); hit++) {
          const damage = ctx.calcDmg(amount);
          ctx.dealEnemyDmg(damage, pierce);
          values.damage += damage;
        }
        break;
      }
      case 'gainBlock':
        ctx.gainBlock(amount);
        values.block += amount;
        break;
      case 'stealBlock': {
        const stolen = ctx.stealEnemyBlock(amount);
        values.stolen += stolen;
        values.block += stolen;
        break;
      }
      case 'healPlayer':
        ctx.healPlayer(amount);
        values.heal += amount;
        break;
      case 'applyEnemyStatus':
        ctx.applyEnemyStatus(effect.status, effect.turns);
        break;
      case 'addPlayerStatus':
        ctx.addPlayerStatus(effect.status, amount);
        if (effect.status === 'encore') values.encore += amount;
        break;
      case 'clearPlayerStatus':
        ctx.clearPlayerStatus(effect.status);
        break;
      case 'addCheer':
        ctx.addCheer(amount);
        break;
      case 'draw':
        ctx.draw(effect.count);
        break;
      case 'gainEnergy':
        ctx.gainEnergy(amount);
        break;
      case 'raiseHandLimit':
        ctx.raiseHandLimit(amount);
        break;
      default:
        throw new Error(`Unsupported card effect type: ${effect.type}`);
    }
  });

  const alternative = (card.log.alternatives || []).find((entry) => matchesCondition(entry.when, ctx));
  const log = alternative ? { ...card.log, ...alternative } : card.log;
  ctx.log(formatLog(log.template, values), log.colorClass);
}
