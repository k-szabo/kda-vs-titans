function matchesCondition(condition, ctx) {
  if (!condition) return true;
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

export function executeCardEffects(card, ctx) {
  const values = { damage: 0 };

  card.effects.forEach((effect) => {
    if (!matchesCondition(effect.when, ctx)) return;

    switch (effect.type) {
      case 'damage':
        for (let hit = 0; hit < (effect.hits || 1); hit++) {
          const damage = ctx.calcDmg(effect.amount);
          ctx.dealEnemyDmg(damage);
          values.damage += damage;
        }
        break;
      case 'gainBlock':
        ctx.gainBlock(effect.amount);
        break;
      case 'healPlayer':
        ctx.healPlayer(effect.amount);
        break;
      case 'applyEnemyStatus':
        ctx.applyEnemyStatus(effect.status, effect.turns);
        break;
      case 'addPlayerStatus':
        ctx.addPlayerStatus(effect.status, effect.amount);
        break;
      case 'clearPlayerStatus':
        ctx.clearPlayerStatus(effect.status);
        break;
      case 'addCheer':
        ctx.addCheer(effect.amount);
        break;
      case 'draw':
        ctx.draw(effect.count);
        break;
      case 'gainEnergy':
        ctx.gainEnergy(effect.amount);
        break;
      default:
        throw new Error(`Unsupported card effect type: ${effect.type}`);
    }
  });

  const alternative = (card.log.alternatives || []).find((entry) => matchesCondition(entry.when, ctx));
  const log = alternative ? { ...card.log, ...alternative } : card.log;
  ctx.log(formatLog(log.template, values), log.colorClass);
}
