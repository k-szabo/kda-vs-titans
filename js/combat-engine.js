// Turn-based combat engine: playing cards, turns, intents, damage, synergies,
// buffs, Joint Finale, leader abilities, damage preview. Owns no run state:
// everything mutable comes through deps (same pattern as shop.js / pvp-duel.js).
// Pure math lives in combat-rules.js and card-effects.js; this is the
// stateful turn loop both PvE and PvP duels drive.
import { executeCardEffects, getEffectiveCardCost } from './card-effects.js';
import {
  applyPlayerDamage,
  calculateEnemyAttackDamage,
  createTurnMemberState,
  getEncoreInterruptThreshold,
  getEncorePhase2Ratio,
  isPlayRequirementMet,
  isWhenConditionMet,
  MAX_HAND_SIZE,
  MAX_HAND_LIMIT,
  MAX_BUFF_SLOTS,
  MEMBER_SYNERGY,
  recordMemberPlay,
  shouldInterruptChargedIntent
} from './combat-rules.js';
import { pickVoiceLine } from './voice-lines.js';
import {
  playBossEnrageSfx,
  playCardSfx,
  playDorsalInterruptSfx,
  playJointFinaleSfx,
  playKaijuRoarSfx
} from './audio.js';

export function createCombatEngine(deps) {
  const required = ['getState', 'getCardDB', 'applyRelicEffects', 'drawCards', 'getBuffAmount', 'discardBuffEntry', 'onEnemyDefeated', 'onPlayerDefeat', 'getPvp', 'showVoiceLine', 'popup', 'shake', 'kaijuHit', 'openBuffReplaceModal', 'closeBuffReplaceModal', 'addLog', 'renderAll'];
  for (const key of required) {
    if (typeof deps?.[key] !== 'function') throw new Error(`createCombatEngine: missing dependency "${key}"`);
  }
  const {
    getState,
    getCardDB,
    drawCards,
    getBuffAmount,
    discardBuffEntry,
    applyRelicEffects,
    onEnemyDefeated,
    onPlayerDefeat,
    getPvp,
    showVoiceLine,
    popup,
    shake,
    kaijuHit,
    openBuffReplaceModal,
    closeBuffReplaceModal,
    addLog,
    renderAll
  } = deps;

  let pendingBuffHandIndex = null;

  function playVoiceLine(category, memberId = null) {
    const line = pickVoiceLine(category, memberId);
    if (line) showVoiceLine(line.speaker, line.text);
  }

  function chooseBuffReplacement(slotIndex) {
    const state = getState();
    if (pendingBuffHandIndex === null) return;
    const handIndex = pendingBuffHandIndex;
    pendingBuffHandIndex = null;
    closeBuffReplaceModal();
    if (
      !state || !Number.isInteger(slotIndex) ||
      slotIndex < 0 ||
      slotIndex >= state.buffs.length
    ) {
      renderAll();
      return;
    }
    const cardInstance = state.hand[handIndex];
    const card = getCardDB()[cardInstance?.cardId];
    if (
      !card ||
      card.type !== 'BUFF' ||
      state.buffs.length < MAX_BUFF_SLOTS ||
      slotIndex < 0 ||
      slotIndex >= state.buffs.length
    ) {
      renderAll();
      return;
    }
    const cost = getEffectiveCardCost(card, cardInstance.upgradeLevel, state.turnMembersPlayed);
    if (state.player.energy < cost) {
      renderAll();
      return;
    }
    const [replaced] = state.buffs.splice(slotIndex, 1);
    if (replaced) {
      discardBuffEntry(replaced);
      addLog(`♻️ ${getCardDB()[replaced.cardId]?.name || 'Buff'} was replaced.`, 'text-slate-400');
    }
    playCardAtIndex(handIndex);
  }

  function cancelBuffReplacement() {
    pendingBuffHandIndex = null;
    closeBuffReplaceModal();
    renderAll();
  }

  function playCardAtIndex(handIdx) {
    const state = getState();
    if (!state || !state.isPlayerTurn) return;
    const cardInstance = state.hand[handIdx];
    const card = getCardDB()[cardInstance?.cardId];
    if (!card) return;
    const cost = getEffectiveCardCost(card, cardInstance.upgradeLevel, state.turnMembersPlayed);

    if (state.player.energy < cost) {
      addLog(`⚠️ Not enough Hype Energy for ${card.name}!`, 'text-amber-300');
      renderAll();
      return;
    }

    if (!isPlayRequirementMet(card.requires, { cardsPlayedThisTurn: state.cardsPlayedThisTurn ?? 0, energy: state.player.energy, cost })) {
      addLog(`⏳ ${card.name} can only be played ${card.requires?.firstCard ? 'as your first card this turn' : 'with your last Hype Energy'}!`, 'text-amber-300');
      renderAll();
      return;
    }

    if (card.type === 'BUFF' && state.buffs.length >= MAX_BUFF_SLOTS) {
      pendingBuffHandIndex = handIdx;
      openBuffReplaceModal(state.buffs.map((buff) => ({
        ...buff,
        name: getCardDB()[buff.cardId]?.name,
        art: getCardDB()[buff.cardId]?.art
      })));
      return;
    }

    playCardSfx();
    state.player.energy -= cost;
    state.cardPlayCounts[card.id] = (state.cardPlayCounts[card.id] || 0) + 1;
    state.cardsPlayedThisTurn = (state.cardsPlayedThisTurn ?? 0) + 1;
    if (card.costReductionIf && cost < getEffectiveCardCost(card, cardInstance.upgradeLevel)) {
      const fullCost = getEffectiveCardCost(card, cardInstance.upgradeLevel);
      addLog(`🎶 Duet harmony: ${card.name} cost ${cost} instead of ${fullCost}!`, 'text-amber-300');
    }
    state.player.cheer = Math.min(100, state.player.cheer + 5 + cost * 3);
    applyRelicEffects('cardPlayed', card, cost);

    // Move card from hand to discard/exhaust, or into a buff slot
    state.hand.splice(handIdx, 1);
    if (state.keptCardInstanceId === cardInstance.instanceId) state.keptCardInstanceId = null;
    if (card.type === 'BUFF') {
      state.buffs.push({
        instanceId: cardInstance.instanceId,
        cardId: card.id,
        upgradeLevel: cardInstance.upgradeLevel,
        remaining: Number.isInteger(card.buff?.duration) ? card.buff.duration : null
      });
      addLog(card.log.template, card.log.colorClass);
    } else if (card.exhaust) {
      state.exhaustPile.push(cardInstance);
    } else {
      state.discardPile.push(cardInstance);
    }

    // Execute Card Effect
    const ctx = createEffectContext();
    if (card.type !== 'BUFF') executeCardEffects(card, ctx, cardInstance.upgradeLevel);
    applyRelicEffects('attackPlayed', card, cost);
    if (card.type === 'ATTACK') triggerEnemyPassives('onPlayerAttack');
    if (card.type === 'SKILL') {
      state.skillsPlayedThisTurn += 1;
      triggerEnemyPassives('onSkillPlayed');
      applyRelicEffects('skillPlayed', card, cost);
      if (state.enemy.stageEffect === 'luminous_spores' || state.secondHazard === 'luminous_spores') {
        state.player.cheer = Math.min(100, state.player.cheer + 3);
        addLog('✨ Luminous Spores: Skills gained +3% extra Crowd Cheer.', 'text-amber-300');
      }
    }

    resolveMemberSynergy(recordMemberPlay(state, card.member));

    if (state.runStatus === 'pvp') getPvp().broadcastPlay(card, cardInstance.upgradeLevel);
    // Check if Kaiju was defeated mid-turn
    if (state.enemy.hp <= 0) {
      state.enemy.hp = 0;
      renderAll();
      if (state.runStatus === 'pvp') getPvp().onLocalKill();
      else onEnemyDefeated();
      return;
    }

    renderAll();
  }

  function createEffectContext() {
    const state = getState();
    return {
      calcDmg: (base) => computeCardAttackDamage(base),
      dealEnemyDmg: (amount, pierce = 0) => dealDamageToEnemy(amount, pierce),
      gainBlock: (amount) => {
        state.player.block += amount;
        popup('playerArenaCard', `+${amount} 🛡️`, 'text-cyan-300 font-display font-black text-lg');
      },
      healPlayer: (amount) => {
        const actual = Math.min(state.player.maxHp - state.player.hp, amount);
        state.player.hp += actual;
        if (actual > 0) {
          popup('playerArenaCard', `+${actual} ❤️`, 'text-emerald-300 font-display font-black text-lg');
        }
      },
      applyEnemyStatus: (statusKey, turns) => {
        state.enemy.statuses[statusKey] = (state.enemy.statuses[statusKey] || 0) + turns;
      },
      addPlayerStatus: (statusKey, amount) => {
        state.player.statuses[statusKey] = (state.player.statuses[statusKey] || 0) + amount;
      },
      clearPlayerStatus: (statusKey) => {
        state.player.statuses[statusKey] = 0;
      },
      hasStatus: (target, statusKey) => {
        const unit = target === 'enemy' ? state.enemy : target === 'player' ? state.player : null;
        return Boolean(unit && unit.statuses[statusKey] > 0);
      },
      gainEnergy: (amount) => {
        state.player.energy += amount;
      },
      addCheer: (pct) => {
        state.player.cheer = Math.min(100, state.player.cheer + pct);
      },
      draw: (count) => drawCards(count),
      raiseHandLimit: (amount) => {
        const ceiling = Math.max(MAX_HAND_SIZE, state.handLimit ?? MAX_HAND_SIZE) + amount;
        state.handLimit = Math.min(MAX_HAND_LIMIT, ceiling);
      },
      stealEnemyBlock: (amount) => {
        const stolen = Math.min(state.enemy.block, amount);
        state.enemy.block -= stolen;
        state.player.block += stolen;
        if (stolen > 0) {
          popup('enemyArenaCard', `-${stolen} 🛡️`, 'text-cyan-300 font-display font-black text-lg');
          popup('playerArenaCard', `+${stolen} 🛡️`, 'text-cyan-300 font-display font-black text-lg');
        }
        return stolen;
      },
      log: (msg, cls) => addLog(msg, cls)
    };
  }

  function dealDamageToEnemy(amount, pierce = 0) {
    const state = getState();
    const pierceRatio = Number.isFinite(pierce) ? Math.min(1, Math.max(0, pierce)) : 0;
    const blockableDamage = Math.ceil(amount * (1 - pierceRatio));
    const blocked = Math.min(state.enemy.block, blockableDamage);
    state.enemy.block -= blocked;
    const hpDamage = Math.max(0, amount - blocked);
    if (hpDamage > 0) {
      state.enemy.hp = Math.max(0, state.enemy.hp - hpDamage);
      state.damageDealtThisTurn += hpDamage;
      state.peakSingleTurnDamage = Math.max(
        state.peakSingleTurnDamage,
        state.damageDealtThisTurn
      );
      kaijuHit();
      popup('enemyArenaCard', `-${hpDamage}`, 'text-amber-300 font-display font-black text-xl');
      triggerEnemyPassives('onHpBelowHalf');
    } else {
      popup('enemyArenaCard', 'BLOCKED', 'text-cyan-300 font-display font-bold text-sm');
    }
    return hpDamage;
  }

  function resolveMemberSynergy({ harmonyTriggered, spotlightTriggered }) {
    const state = getState();
    const ctx = createEffectContext();
    const { quartet, spotlight } = MEMBER_SYNERGY;
    if (harmonyTriggered) {
      ctx.gainEnergy(quartet.energy);
      ctx.gainBlock(quartet.block);
      ctx.addCheer(quartet.cheer);
      addLog(
        `🎶 QUARTET HARMONY! +${quartet.energy} Energy, +${quartet.block} Shield, and +${quartet.cheer}% Crowd Cheer!`,
        'text-amber-300 font-bold'
      );
      playVoiceLine('quartet');
    }
    if (!spotlightTriggered) return;

    const member = state.memberPlayChain.member;
    switch (member) {
      case 'ahri': {
        const synergy = spotlight.ahri;
        ctx.applyEnemyStatus('charm', synergy.charm);
        ctx.healPlayer(synergy.heal);
        addLog(
          `🦊 Ahri Solo Spotlight: applied ${synergy.charm} Charm and healed ${synergy.heal} HP!`,
          'text-pink-300 font-bold'
        );
        break;
      }
      case 'akali': {
        const synergy = spotlight.akali;
        ctx.dealEnemyDmg(synergy.damage, synergy.pierce);
        ctx.draw(synergy.draw);
        addLog(
          `🥷 Akali Solo Spotlight: dealt ${synergy.damage} piercing damage and drew ${synergy.draw} card!`,
          'text-cyan-300 font-bold'
        );
        break;
      }
      case 'evelynn': {
        const synergy = spotlight.evelynn;
        ctx.applyEnemyStatus('marked', synergy.marked);
        const stolen = ctx.stealEnemyBlock(synergy.stealBlock);
        addLog(
          `💜 Evelynn Solo Spotlight: applied ${synergy.marked} Marked and stole ${stolen} Block!`,
          'text-purple-300 font-bold'
        );
        break;
      }
      case 'kaisa': {
        const synergy = spotlight.kaisa;
        ctx.gainBlock(synergy.block);
        ctx.addPlayerStatus('encore', synergy.encore);
        addLog(
          `✨ Kai'Sa Solo Spotlight: gained +${synergy.block} Shield and +${synergy.encore} turn of Encore!`,
          'text-indigo-300 font-bold'
        );
        break;
      }
      default:
        throw new Error(`Unknown member in Solo Spotlight chain: ${member}`);
    }
    playVoiceLine('spotlight', member);
  }

  function computeCardAttackDamage(baseDmg) {
    const state = getState();
    const cardDatabase = getCardDB();
    const buffBonus = state.buffs.reduce((sum, buff) => {
      const def = cardDatabase[buff.cardId]?.buff;
      return def?.trigger === 'passive' && def.effect === 'bonusAttackDamage'
        ? sum + getBuffAmount(buff)
        : sum;
    }, 0);
    let dmg = baseDmg + (state.player.statuses.encore || 0) + buffBonus;
    if (state.player.statuses.weak > 0) {
      dmg = Math.floor(dmg * 0.75);
    }
    // Charm on the attacker weakens their hits. Never set on the player
    // in PvE; set on duelists by rival Charm in PvP.
    if ((state.player.statuses.charm || 0) > 0) {
      dmg = Math.floor(dmg * 0.75);
    }
    if (state.enemy && state.enemy.statuses.marked > 0) {
      dmg = Math.ceil(dmg * 1.5);
    }
    return Math.max(0, dmg);
  }

  function getCardDamagePreview(cardInstance) {
    const state = getState();
    const cardDatabase = getCardDB();
    const card = cardDatabase[cardInstance?.cardId];
    if (!card) return null;
    const enemyStatuses = state.enemy?.statuses || {};
    const playerStatuses = state.player?.statuses || {};
    const bonusActive = (card.effects || []).some((effect) =>
      effect.when && isWhenConditionMet(enemyStatuses, playerStatuses, effect.when)
    );
    const damageEffects = (card.effects || []).filter((effect) =>
      effect.type === 'damage' &&
      isWhenConditionMet(enemyStatuses, playerStatuses, effect.when)
    );
    const upgradeLevel = cardInstance.upgradeLevel || 0;
    const parts = damageEffects.map((effect) => ({
      perHit: computeCardAttackDamage(effect.amount + (effect.upgradeAmount || 0) * upgradeLevel),
      hits: effect.hits || 1,
      pierce: Number.isFinite(effect.pierce) ? Math.min(1, Math.max(0, effect.pierce)) : 0
    }));
    const total = parts.reduce((sum, part) => sum + part.perHit * part.hits, 0);
    const single = parts.length === 1 ? parts[0] : null;
    const blockable = parts.reduce(
      (sum, part) => sum + Math.ceil(part.perHit * (1 - part.pierce)) * part.hits,
      0
    );
    const blocked = Math.min(state.enemy.block || 0, blockable);
    const hpDamage = Math.max(0, total - blocked);
    return {
      perHit: single ? single.perHit : null,
      hits: single ? single.hits : null,
      total,
      hpDamage,
      bonusActive,
      lethal: state.enemy.hp > 0 && hpDamage >= state.enemy.hp
    };
  }

  function getCurrentEnemyIntent() {
    const state = getState();
    const e = state.enemy;
    const raw = e.patterns[e.patternStep % e.patterns.length];
    const intent = { ...raw };

    if (Number.isFinite(intent.interruptThreshold)) {
      intent.interruptThreshold = getEncoreInterruptThreshold(intent.interruptThreshold, state.encoreLevel);
    }

    if (typeof intent.dmg === 'number') {
      let eff = calculateEnemyAttackDamage(e, intent.dmg);
      if (e.statuses.charm > 0) {
        eff = Math.floor(eff * 0.75);
      }
      intent.effectiveDmg = eff;
      if (Number.isFinite(intent.interruptThreshold)) {
        intent.uninterruptedDmg = Math.ceil(eff * (1 + (intent.interruptBonus ?? 0.35)));
      }
      const thresholdText = Number.isFinite(intent.interruptThreshold)
        ? ` // ${intent.interruptThreshold} HP DMG TO STUN`
        : '';
      if (intent.type === 'multi') {
        intent.displayText = `${intent.label.split(':')[0]}: ${eff}x${intent.hits} DMG${thresholdText}`;
      } else if (intent.type === 'debuff_atk') {
        intent.displayText = `${intent.label.split(':')[0]}: ${eff} DMG + WEAK${thresholdText}`;
      } else {
        intent.displayText = `${intent.label.split(':')[0]}: ${eff} DMG${thresholdText}`;
      }
    } else {
      intent.displayText = intent.label;
    }
    return intent;
  }

  function endPlayerTurn() {
    const state = getState();
    if (!state || !state.isPlayerTurn) return;
    if (state.runStatus === 'pvp') {
      getPvp().endTurn();
      return;
    }
    state.isPlayerTurn = false;

    // Ethereal hazards resolve before ordinary cards leave the hand.
    for (let index = state.hand.length - 1; index >= 0; index--) {
      const cardInstance = state.hand[index];
      const card = getCardDB()[cardInstance.cardId];
      if (!card?.endTurnDamage) continue;
      applyDamageToPlayer(card.endTurnDamage, 1);
      state.exhaustPile.push(...state.hand.splice(index, 1));
      addLog(card.log.template, card.log.colorClass);
    }

    const retainedCards = [];
    const keptCardInstanceId = state.keptCardInstanceId ?? null;
    while (state.hand.length > 0) {
      const cardInstance = state.hand.pop();
      const card = getCardDB()[cardInstance.cardId];
      const isKept = keptCardInstanceId !== null && cardInstance.instanceId === keptCardInstanceId;
      if (card?.retain || card?.retainInHand || isKept) {
        retainedCards.unshift(cardInstance);
      } else {
        state.discardPile.push(cardInstance);
      }
    }
    state.hand.push(...retainedCards);
    state.keptCardInstanceId = null;

    applyStageHazard(state.enemy.stageEffect);
    if (state.secondHazard) applyStageHazard(state.secondHazard, true);

    if (state.player.hp <= 0 && onPlayerDefeat()) return;

    const e = state.enemy;
    e.block = 0; // Enemy block resets at start of its turn
    triggerEnemyPassives('onTurnEnd');
    const intent = getCurrentEnemyIntent();

    const interrupted = shouldInterruptChargedIntent(intent, state.damageDealtThisTurn);
    if (interrupted) {
      addLog(
        `🛑 ${e.name}'s ${intent.displayText} fizzles — K/DA's ${state.damageDealtThisTurn} HP damage interrupted it!`,
        'text-cyan-300 font-bold'
      );
      playDorsalInterruptSfx();
    } else {
      addLog(`--- ${e.name} executes ${intent.displayText} ---`, 'text-sky-300 font-bold');
      if (typeof intent.effectiveDmg === 'number') playKaijuRoarSfx();

      if (intent.type === 'charge') {
        e.block += intent.block;
        popup('enemyArenaCard', `+${intent.block} 🛡️`, 'text-sky-300 font-display font-black text-lg');
      } else if (intent.type === 'injectStatus') {
        if (intent.block) {
          e.block += intent.block;
          popup('enemyArenaCard', `+${intent.block} 🛡️`, 'text-sky-300 font-display font-black text-lg');
        }
        for (let count = 0; count < intent.count; count++) {
          state.discardPile.push({
            instanceId: state.nextCardInstanceId++,
            cardId: intent.cardId,
            upgradeLevel: 0
          });
        }
        addLog(`⚠️ ${e.name} added ${intent.count} ${getCardDB()[intent.cardId].name} card${intent.count === 1 ? '' : 's'} to your discard pile!`, 'text-rose-300');
      } else if (intent.type === 'steal_energy') {
        const drained = Math.min(3, intent.amount || 1);
        state.energyPenalty = Math.max(state.energyPenalty || 0, drained);
        addLog(`🔋 ${e.name} drained ${drained} Hype Energy from K/DA's next turn!`, 'text-rose-300');
      } else if (intent.type === 'attack' || intent.type === 'atomic' || intent.type === 'debuff_atk') {
        const damage = intent.uninterruptedDmg ?? intent.effectiveDmg;
        if (intent.interruptThreshold) {
          addLog(`⚠️ The charged attack hit harder because K/DA missed the ${intent.interruptThreshold} HP damage interrupt!`, 'text-rose-300');
        }
        applyDamageToPlayer(damage, intent.pierce || 0);
        if (intent.weak) {
          state.player.statuses.weak += intent.weak;
          addLog(`⚠️ K/DA afflicted with ${intent.weak} Weak (-25% Attack DMG)!`, 'text-rose-300');
        }
      } else if (intent.type === 'multi') {
        const damage = intent.uninterruptedDmg ?? intent.effectiveDmg;
        if (intent.interruptThreshold) {
          addLog(`⚠️ The charged attack hit harder because K/DA missed the ${intent.interruptThreshold} HP damage interrupt!`, 'text-rose-300');
        }
        for (let h = 0; h < intent.hits; h++) {
          applyDamageToPlayer(damage, intent.pierce || 0);
        }
      }
    }

    // Advance enemy pattern & decrement statuses
    e.patternStep += 1;
    if (e.statuses.charm > 0) e.statuses.charm -= 1;
    if (e.statuses.marked > 0) e.statuses.marked -= 1;
    if (state.player.statuses.weak > 0) state.player.statuses.weak -= 1;

    if (state.player.hp <= 0 && onPlayerDefeat()) return;

    // Unused Holo Shield decays by half (rounded down) instead of
    // carrying over in full, so surplus block cannot snowball all wave.
    const decayed = Math.floor(state.player.block / 2);
    if (decayed < state.player.block) {
      addLog(`🛡️ Unused Holo Shield decayed ${state.player.block} → ${decayed}.`, 'text-cyan-300');
    }
    state.player.block = decayed;
    state.turn += 1;
    state.damageDealtThisTurn = 0;
    state.skillsPlayedThisTurn = 0;
    state.cardsPlayedThisTurn = 0;
    state.relicTriggersThisTurn = {};
    state.handLimit = MAX_HAND_SIZE;
    state.enemy.reflectUsedThisTurn = false;
    Object.assign(state, createTurnMemberState());
    state.player.energy = Math.max(0, state.player.maxEnergy - (state.energyPenalty || 0));
    state.energyPenalty = 0;
    tickBuffsAtTurnStart();
    state.isPlayerTurn = true;
    drawCards(5);
    renderAll();
  }

  function applyStageHazard(hazard, isSecond = false) {
    const state = getState();
    const tag = isSecond ? ' (second hazard)' : '';
    if (hazard === 'overcharge_grid' && state.player.energy > 0) {
      const hazardDamage = state.player.energy * 3;
      applyDamageToPlayer(hazardDamage, 1);
      addLog(`⚡ Overcharge Grid${tag}: ${state.player.energy} unspent Energy dealt ${hazardDamage} direct HP damage!`, 'text-rose-300');
    } else if (hazard === 'thermonuclear_heat' && state.player.block === 0) {
      applyDamageToPlayer(3, 1);
      addLog(`🔥 Thermonuclear Heat${tag}: ending the turn with no Shield dealt 3 direct HP damage!`, 'text-rose-300');
    }
  }

  function describeBuffEffect(def, amount) {
    switch (def.effect) {
      case 'gainBlock': return `+${amount} Holo Shield`;
      case 'heal': return `heal ${amount} HP`;
      case 'gainEnergy': return `+${amount} Hype Energy`;
      default: return `+${amount}`;
    }
  }

  function tickBuffsAtTurnStart() {
    const state = getState();
    const cardDatabase = getCardDB();
    const surviving = [];
    state.buffs.forEach((buff) => {
      const card = cardDatabase[buff.cardId];
      const def = card?.buff;
      if (!def) return;

      if (def.trigger === 'turnStart') {
        const amount = getBuffAmount(buff);
        if (def.effect === 'gainBlock') {
          state.player.block += amount;
          popup('playerArenaCard', `+${amount} 🛡️`, 'text-cyan-300 font-display font-black text-lg');
        } else if (def.effect === 'heal') {
          const healed = Math.min(state.player.maxHp - state.player.hp, amount);
          state.player.hp += healed;
          if (healed > 0) {
            popup('playerArenaCard', `+${healed} ❤️`, 'text-emerald-300 font-display font-black text-lg');
          }
        } else if (def.effect === 'gainEnergy') {
          state.player.energy += amount;
        }
        addLog(`🎛️ ${card.name}: ${describeBuffEffect(def, amount)}.`, 'text-purple-300');
      }

      if (buff.remaining !== null) {
        buff.remaining -= 1;
        if (buff.remaining <= 0) {
          discardBuffEntry(buff);
          addLog(`⏳ ${card.name} expired.`, 'text-slate-400');
          return;
        }
      }
      surviving.push(buff);
    });
    state.buffs = surviving;
  }

  function applyDamageToPlayer(rawDmg, pierce = 0) {
    const state = getState();
    const negateIndex = state.buffs.findIndex((buff) =>
      getCardDB()[buff.cardId]?.buff?.effect === 'negateDamage'
    );
    if (negateIndex >= 0 && rawDmg > 0) {
      const [consumed] = state.buffs.splice(negateIndex, 1);
      discardBuffEntry(consumed);
      addLog(`⏳ ${getCardDB()[consumed.cardId]?.name || 'Buff'} negated ${rawDmg} damage and shattered.`, 'text-sky-300 font-bold');
      popup('playerArenaCard', 'NEGATED', 'text-sky-300 font-display font-black');
      return;
    }
    const { damageAfterBlock, hpLost, cheerLost } = applyPlayerDamage(state.player, rawDmg, pierce);
    if (damageAfterBlock > 0) {
      shake();
      popup('playerArenaCard', `-${hpLost} HP`, 'text-rose-400 font-display font-black text-xl');
      addLog(`💥 K/DA took ${hpLost} damage! (${state.player.hp}/${state.player.maxHp} HP)`, 'text-rose-400');
      if (cheerLost > 0) addLog(`📣 Crowd Cheer fell by ${cheerLost}% from damage.`, 'text-amber-300');
    } else {
      popup('playerArenaCard', 'SHIELDED!', 'text-cyan-300 font-display font-bold text-sm');
      addLog(`🛡️ Holo Shield completely absorbed ${rawDmg} damage!`, 'text-cyan-300');
    }
  }

  function triggerEnemyPassives(trigger) {
    const state = getState();
    const e = state.enemy;
    if (e.hp <= 0) return;
    for (const passive of e.passives || []) {
      if (passive.trigger !== trigger) continue;

      if (passive.effect === 'gainBlock') {
        e.block += passive.value;
        popup('enemyArenaCard', `+${passive.value} 🛡️`, 'text-sky-300 font-display font-black text-lg');
      } else if (passive.effect === 'reflect') {
        if (!e.reflectUsedThisTurn) {
          e.reflectUsedThisTurn = true;
          applyDamageToPlayer(passive.value, 1);
          addLog(`🪞 ${e.name}'s plating reflected ${passive.value} damage back at K/DA!`, 'text-rose-300');
        }
      } else if (passive.effect === 'gainStrength') {
        e.strength += passive.value;
        addLog(`⚠️ ${e.name} gained ${passive.value} Strength!`, 'text-rose-300');
      } else if (passive.effect === 'gainStrengthEvery') {
        if (state.skillsPlayedThisTurn > 0 && state.skillsPlayedThisTurn % passive.every === 0) {
          e.strength += passive.value;
          addLog(`⚠️ ${e.name} gained ${passive.value} Strength from K/DA's Skills!`, 'text-rose-300');
        }
      } else if (
        passive.effect === 'enrage' &&
        !e.enrageTriggered &&
        e.hp <= e.maxHp * getEncorePhase2Ratio(state.encoreLevel)
      ) {
        e.enrageTriggered = true;
        e.statuses.charm = 0;
        e.statuses.marked = 0;
        e.strength += passive.strength;
        e.block += passive.block;
        if (Array.isArray(e.phase2Patterns) && e.phase2Patterns.length > 0) {
          e.patterns = e.phase2Patterns;
          e.patternStep = 0;
        }
        addLog(`🔥 ${e.name} enraged: cleared debuffs, gained ${passive.strength} Strength and ${passive.block} Block!`, 'text-rose-300 font-bold');
        playBossEnrageSfx();
      }
    }
  }

  // Trigger K/DA 4-Member Joint Finale when Crowd Cheer hits 100%
  function triggerJointAttack() {
    const state = getState();
    if (!state || !state.isPlayerTurn || state.player.cheer < 100) return;

    playJointFinaleSfx();
    state.player.cheer = 0;
    const ctx = createEffectContext();
    const finaleDmg = ctx.calcDmg(28);

    ctx.dealEnemyDmg(finaleDmg);
    ctx.gainBlock(10);
    ctx.applyEnemyStatus('charm', 2);
    state.player.energy += 1;
    if (state.runStatus === 'pvp') getPvp().broadcastSpecial('__finale');

    shake();
    addLog(
      `🌟 K/DA WORLD TOUR FINALE! All 4 members struck for ${finaleDmg} DMG, +10 Shield, +1 Energy & 2 Charm!`,
      'text-amber-300 font-bold'
    );
    playVoiceLine('finale');

    if (state.enemy.hp <= 0) {
      state.enemy.hp = 0;
      renderAll();
      if (state.runStatus === 'pvp') getPvp().onLocalKill();
      else onEnemyDefeated();
      return;
    }

    renderAll();
  }

  function useLeaderAbility() {
    const state = getState();
    if (!state || !state.isPlayerTurn || state.leaderAbilityUsed) return;

    state.leaderAbilityUsed = true;
    playCardSfx();
    const ctx = createEffectContext();
    switch (state.leader) {
      case 'ahri':
        ctx.dealEnemyDmg(18);
        ctx.healPlayer(12);
        addLog('🦊 Ahri used Spirit Rush: 18 damage and restored up to 12 HP!', 'text-pink-300 font-bold');
        break;
      case 'akali':
        ctx.dealEnemyDmg(26);
        ctx.gainBlock(8);
        addLog('🥷 Akali used Shuriken Flip: 26 damage and gained 8 Holo Shield!', 'text-cyan-300 font-bold');
        break;
      case 'evelynn':
        ctx.applyEnemyStatus('charm', 3);
        ctx.addCheer(25);
        addLog('💜 Evelynn used Allure: charmed the enemy for 3 turns and gained 25% Crowd Cheer!', 'text-purple-300 font-bold');
        break;
      case 'kaisa':
        ctx.raiseHandLimit(3);
        ctx.draw(3);
        ctx.gainEnergy(2);
        ctx.addCheer(15);
        addLog("✨ Kai'Sa used Killer Instinct: 3 temporary hand slots, drew 3 cards, gained 2 Hype Energy and 15% Crowd Cheer!", 'text-indigo-300 font-bold');
        break;
      default:
        throw new Error(`Unknown run leader: ${state.leader}`);
    }
    playVoiceLine('spotlight', state.leader);
    if (state.runStatus === 'pvp') getPvp().broadcastSpecial('__leader');

    if (state.enemy.hp <= 0) {
      state.enemy.hp = 0;
      renderAll();
      if (state.runStatus === 'pvp') getPvp().onLocalKill();
      else onEnemyDefeated();
      return;
    }
    renderAll();
  }

  return {
    playCardAtIndex,
    endPlayerTurn,
    triggerJointAttack,
    useLeaderAbility,
    getCardDamagePreview,
    computeCardAttackDamage,
    chooseBuffReplacement,
    cancelBuffReplacement,
    dealDamageToEnemy,
    getCurrentEnemyIntent,
    tickBuffsAtTurnStart
  };
}
