import { executeCardEffects, getEffectiveCardCost } from './card-effects.js';
import {
  isSoundEnabled,
  isSoundSupported,
  playCardSfx,
  playJointFinaleSfx,
  playKaijuRoarSfx,
  playBossEnrageSfx,
  playDorsalInterruptSfx,
  setSoundEnabled
} from './audio.js';
import {
  applyPlayerDamage,
  calculateEnemyAttackDamage,
  getEncoreBossMaxHp,
  getEncoreInterruptThreshold,
  getEncorePhase2Ratio,
  shouldInterruptChargedIntent
} from './combat-rules.js';
import { loadGameData } from './game-data.js';
import {
  createDefaultProfileStats,
  InvalidProfileStatsError,
  loadProfileStats,
  ProfileStorageError,
  saveProfileStats
} from './profile-storage.js';
import {
  InvalidSavedRunError,
  loadSavedRun,
  RunStorageError,
  saveRun
} from './run-storage.js';
import { isValidSavedRun, migrateSavedRun } from './run-state.js';
import { createGameUI } from './ui.js';
import { getUnlockedArtStyles, LEADERS } from './leader-data.js';

(function () {
  'use strict';

  let ART_ASSETS = null;
  let CARD_DB = {};
  let RELIC_DB = {};
  let ENCOUNTERS = [];
  let STARTER_DECK = [];
  let profileStats = createDefaultProfileStats();
  let ui = null;
  let state = null;
  let storageAvailable = true;
  let profileStorageAvailable = true;

      function shuffle(arr) {
        const copy = [...arr];
        for (let i = copy.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy;
      }

      function createNewRunState(leader, encoreLevel = 0) {
        let nextCardInstanceId = 1;
        const masterDeck = STARTER_DECK.map((cardId) => ({
          instanceId: nextCardInstanceId++,
          cardId,
          upgradeLevel: 0
        }));
        if (encoreLevel >= 4) {
          masterDeck.push({
            instanceId: nextCardInstanceId++,
            cardId: 'stage_fright',
            upgradeLevel: 0
          });
        }
        const starterRelics = {
          ahri: 'nine_tail_mic',
          akali: 'neon_kunai',
          evelynn: 'velvet_shades',
          kaisa: 'void_core'
        };
        return {
          stageIndex: 0,
          damageDealtThisTurn: 0,
          skillsPlayedThisTurn: 0,
          leader,
          encoreLevel,
          leaderAbilityUsed: false,
          turn: 1,
          startedAt: Date.now(),
          nextCardInstanceId,
          runStatus: 'playing',
          draftChoices: [],
          relicChoices: [],
          relics: starterRelics[leader] ? [starterRelics[leader]] : [],
          isPlayerTurn: true,
          masterDeck,
          drawPile: [],
          hand: [],
          discardPile: [],
          exhaustPile: [],
          player: {
            hp: 80,
            maxHp: 80,
            block: 0,
            energy: 3,
            maxEnergy: 3,
            cheer: 0,
            statuses: {
              encore: 0,
              weak: 0
            }
          },
          enemy: null,
          logs: []
        };
      }

      function startStage(stageIdx) {
        const enc = ENCOUNTERS[stageIdx];
        if (!enc) return;

        state.stageIndex = stageIdx;
        state.turn = 1;
        state.damageDealtThisTurn = 0;
        state.skillsPlayedThisTurn = 0;
        state.runStatus = 'playing';
        state.draftChoices = [];
        state.relicChoices = [];
        state.isPlayerTurn = true;
        state.drawPile = shuffle(state.masterDeck);
        state.hand = [];
        state.discardPile = [];
        state.exhaustPile = [];
        state.player.block = 0;
        state.player.energy = state.player.maxEnergy;
        state.player.statuses = { encore: 0, weak: 0 };

        state.enemy = {
          ...enc,
          hp: getEncoreBossMaxHp(enc.maxHp, state.encoreLevel),
          maxHp: getEncoreBossMaxHp(enc.maxHp, state.encoreLevel),
          block: 0,
          strength: (enc.strength || 0) + (state.encoreLevel >= 3 ? 1 : 0),
          enrageTriggered: false,
          patternStep: 0,
          statuses: { charm: 0, marked: 0 }
        };

        applyRelicEffects('stageStart');
        addLog(`🚨 WAVE ${stageIdx + 1}: ${enc.name} entered the stadium!`, 'text-sky-300 font-bold');
        drawCards(5);
        renderAll();
      }

      function drawCards(count) {
        for (let i = 0; i < count; i++) {
          if (state.hand.length >= 8) break;
          if (state.drawPile.length === 0) {
            if (state.discardPile.length === 0) break;
            state.drawPile = shuffle(state.discardPile);
            state.discardPile = [];
          }
          const nextCard = state.drawPile.pop();
          if (nextCard) state.hand.push(nextCard);
        }
      }

      function computeCardAttackDamage(baseDmg) {
        let dmg = baseDmg + (state.player.statuses.encore || 0);
        if (state.player.statuses.weak > 0) {
          dmg = Math.floor(dmg * 0.75);
        }
        if (state.enemy && state.enemy.statuses.marked > 0) {
          dmg = Math.ceil(dmg * 1.5);
        }
        return Math.max(0, dmg);
      }

      function getCurrentEnemyIntent() {
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
            ? ` // ${intent.interruptThreshold} DMG TO STUN`
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

      function playCardAtIndex(handIdx) {
        if (!state.isPlayerTurn) return;
        const cardInstance = state.hand[handIdx];
        const card = CARD_DB[cardInstance?.cardId];
        if (!card) return;
        const cost = getEffectiveCardCost(card, cardInstance.upgradeLevel);

        if (state.player.energy < cost) {
          addLog(`⚠️ Not enough Hype Energy for ${card.name}!`, 'text-amber-300');
          renderAll();
          return;
        }

        playSoundEffect(playCardSfx);
        state.player.energy -= cost;
        state.player.cheer = Math.min(100, state.player.cheer + 5 + cost * 3);
        applyRelicEffects('cardPlayed', card, cost);

        // Move card from hand to discard/exhaust
        state.hand.splice(handIdx, 1);
        if (card.exhaust) {
          state.exhaustPile.push(cardInstance);
        } else {
          state.discardPile.push(cardInstance);
        }

        // Execute Card Effect
        const ctx = createEffectContext();
        executeCardEffects(card, ctx, cardInstance.upgradeLevel);
        applyRelicEffects('attackPlayed', card, cost);
        if (card.type === 'ATTACK') triggerEnemyPassives('onPlayerAttack');
        if (card.type === 'SKILL') {
          state.skillsPlayedThisTurn += 1;
          triggerEnemyPassives('onSkillPlayed');
          applyRelicEffects('skillPlayed', card, cost);
        }

        // Check if Kaiju was defeated mid-turn
        if (state.enemy.hp <= 0) {
          state.enemy.hp = 0;
          renderAll();
          handleKaijuDefeated();
          return;
        }

        renderAll();
      }

      function createEffectContext() {
        return {
          calcDmg: (base) => computeCardAttackDamage(base),
          dealEnemyDmg: (amount) => {
            let remaining = amount;
            if (state.enemy.block > 0) {
              const absorbed = Math.min(state.enemy.block, remaining);
              state.enemy.block -= absorbed;
              remaining -= absorbed;
            }
            if (remaining > 0) {
              state.enemy.hp = Math.max(0, state.enemy.hp - remaining);
              state.damageDealtThisTurn += remaining;
              ui.triggerKaijuHitAnim();
              ui.spawnPopup('enemyArenaCard', `-${remaining}`, 'text-amber-300 font-display font-black text-xl');
              triggerEnemyPassives('onHpBelowHalf');
            } else {
              ui.spawnPopup('enemyArenaCard', 'BLOCKED', 'text-cyan-300 font-display font-bold text-sm');
            }
          },
          gainBlock: (amount) => {
            state.player.block += amount;
            ui.spawnPopup('playerArenaCard', `+${amount} 🛡️`, 'text-cyan-300 font-display font-black text-lg');
          },
          healPlayer: (amount) => {
            const actual = Math.min(state.player.maxHp - state.player.hp, amount);
            state.player.hp += actual;
            if (actual > 0) {
              ui.spawnPopup('playerArenaCard', `+${actual} ❤️`, 'text-emerald-300 font-display font-black text-lg');
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
          log: (msg, cls) => addLog(msg, cls)
        };
      }

      // Trigger K/DA 4-Member Joint Finale when Crowd Cheer hits 100%
      function triggerJointAttack() {
        if (!state.isPlayerTurn || state.player.cheer < 100) return;

        playSoundEffect(playJointFinaleSfx);
        state.player.cheer = 0;
        const ctx = createEffectContext();
        const finaleDmg = ctx.calcDmg(28);

        ctx.dealEnemyDmg(finaleDmg);
        ctx.gainBlock(10);
        ctx.applyEnemyStatus('charm', 2);
        state.player.energy += 1;

        ui.triggerScreenShake();
        addLog(
          `🌟 K/DA WORLD TOUR FINALE! All 4 members struck for ${finaleDmg} DMG, +10 Shield, +1 Energy & 2 Charm!`,
          'text-amber-300 font-bold'
        );

        if (state.enemy.hp <= 0) {
          state.enemy.hp = 0;
          renderAll();
          handleKaijuDefeated();
          return;
        }

        renderAll();
      }

      function useLeaderAbility() {
        if (!state.isPlayerTurn || state.leaderAbilityUsed) return;

        state.leaderAbilityUsed = true;
        playSoundEffect(playCardSfx);
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
            ctx.draw(3);
            ctx.gainEnergy(2);
            ctx.addCheer(15);
            addLog("✨ Kai'Sa used Killer Instinct: drew 3 cards, gained 2 Hype Energy and 15% Crowd Cheer!", 'text-indigo-300 font-bold');
            break;
          default:
            throw new Error(`Unknown run leader: ${state.leader}`);
        }

        if (state.enemy.hp <= 0) {
          state.enemy.hp = 0;
          renderAll();
          handleKaijuDefeated();
          return;
        }
        renderAll();
      }

      function endPlayerTurn() {
        if (!state.isPlayerTurn) return;
        state.isPlayerTurn = false;

        // Ethereal hazards resolve before ordinary cards leave the hand.
        for (let index = state.hand.length - 1; index >= 0; index--) {
          const cardInstance = state.hand[index];
          const card = CARD_DB[cardInstance.cardId];
          if (!card?.endTurnDamage) continue;
          applyDamageToPlayer(card.endTurnDamage, 1);
          state.exhaustPile.push(...state.hand.splice(index, 1));
          addLog(card.log.template, card.log.colorClass);
        }

        const retainedCards = [];
        while (state.hand.length > 0) {
          const cardInstance = state.hand.pop();
          const card = CARD_DB[cardInstance.cardId];
          if (card?.retainInHand) {
            retainedCards.unshift(cardInstance);
          } else {
            state.discardPile.push(cardInstance);
          }
        }
        state.hand.push(...retainedCards);

        if (state.player.hp <= 0) {
          finishPlayerDefeat();
          return;
        }

        const e = state.enemy;
        e.block = 0; // Enemy block resets at start of its turn
        triggerEnemyPassives('onTurnEnd');
        const intent = getCurrentEnemyIntent();

        addLog(`--- ${e.name} executes ${intent.displayText} ---`, 'text-sky-300 font-bold');

        if (typeof intent.effectiveDmg === 'number') playSoundEffect(playKaijuRoarSfx);
        const interrupted = shouldInterruptChargedIntent(intent, state.damageDealtThisTurn);
        if (interrupted) {
          addLog(`💥 K/DA dealt ${state.damageDealtThisTurn} damage and interrupted ${e.name}'s charged attack!`, 'text-cyan-300 font-bold');
          playSoundEffect(playDorsalInterruptSfx);
        } else if (intent.type === 'charge') {
          e.block += intent.block;
          ui.spawnPopup('enemyArenaCard', `+${intent.block} 🛡️`, 'text-sky-300 font-display font-black text-lg');
        } else if (intent.type === 'injectStatus') {
          if (intent.block) {
            e.block += intent.block;
            ui.spawnPopup('enemyArenaCard', `+${intent.block} 🛡️`, 'text-sky-300 font-display font-black text-lg');
          }
          for (let count = 0; count < intent.count; count++) {
            state.discardPile.push({
              instanceId: state.nextCardInstanceId++,
              cardId: intent.cardId,
              upgradeLevel: 0
            });
          }
          addLog(`⚠️ ${e.name} added ${intent.count} ${CARD_DB[intent.cardId].name} card${intent.count === 1 ? '' : 's'} to your discard pile!`, 'text-rose-300');
        } else if (intent.type === 'attack' || intent.type === 'atomic' || intent.type === 'debuff_atk') {
          const damage = intent.uninterruptedDmg ?? intent.effectiveDmg;
          if (!interrupted && intent.interruptThreshold) {
            addLog(`⚠️ The charged attack hit harder because K/DA missed the ${intent.interruptThreshold}-damage interrupt!`, 'text-rose-300');
          }
          applyDamageToPlayer(damage, intent.pierce || 0);
          if (intent.weak) {
            state.player.statuses.weak += intent.weak;
            addLog(`⚠️ K/DA afflicted with ${intent.weak} Weak (-25% Attack DMG)!`, 'text-rose-300');
          }
        } else if (intent.type === 'multi') {
          const damage = intent.uninterruptedDmg ?? intent.effectiveDmg;
          if (!interrupted && intent.interruptThreshold) {
            addLog(`⚠️ The charged attack hit harder because K/DA missed the ${intent.interruptThreshold}-damage interrupt!`, 'text-rose-300');
          }
          for (let h = 0; h < intent.hits; h++) {
            applyDamageToPlayer(damage, intent.pierce || 0);
          }
        }

        // Advance enemy pattern & decrement statuses
        e.patternStep += 1;
        if (e.statuses.charm > 0) e.statuses.charm -= 1;
        if (e.statuses.marked > 0) e.statuses.marked -= 1;
        if (state.player.statuses.weak > 0) state.player.statuses.weak -= 1;

        if (state.player.hp <= 0) {
          finishPlayerDefeat();
          return;
        }

        // Carry remaining Holo Shield forward into the next player turn.
        state.turn += 1;
        state.damageDealtThisTurn = 0;
        state.skillsPlayedThisTurn = 0;
        state.player.energy = state.player.maxEnergy;
        state.isPlayerTurn = true;
        drawCards(5);
        renderAll();
      }

      function applyDamageToPlayer(rawDmg, pierce = 0) {
        const { damageAfterBlock, hpLost, cheerLost } = applyPlayerDamage(state.player, rawDmg, pierce);
        if (damageAfterBlock > 0) {
          ui.triggerScreenShake();
          ui.spawnPopup('playerArenaCard', `-${hpLost} HP`, 'text-rose-400 font-display font-black text-xl');
          addLog(`💥 K/DA took ${hpLost} damage! (${state.player.hp}/${state.player.maxHp} HP)`, 'text-rose-400');
          if (cheerLost > 0) addLog(`📣 Crowd Cheer fell by ${cheerLost}% from damage.`, 'text-amber-300');
        } else {
          ui.spawnPopup('playerArenaCard', 'SHIELDED!', 'text-cyan-300 font-display font-bold text-sm');
          addLog(`🛡️ Holo Shield completely absorbed ${rawDmg} damage!`, 'text-cyan-300');
        }
      }

      function finishPlayerDefeat() {
        state.player.hp = 0;
        state.runStatus = 'defeat';
        renderAll();
        ui.showRunEndModal(false);
      }

      function triggerEnemyPassives(trigger) {
        const e = state.enemy;
        if (e.hp <= 0) return;
        for (const passive of e.passives || []) {
          if (passive.trigger !== trigger) continue;

          if (passive.effect === 'gainBlock') {
            e.block += passive.value;
            ui.spawnPopup('enemyArenaCard', `+${passive.value} 🛡️`, 'text-sky-300 font-display font-black text-lg');
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
            playSoundEffect(playBossEnrageSfx);
          }
        }
      }

      function handleKaijuDefeated() {
        state.isPlayerTurn = false;
        addLog(`🏆 ${state.enemy.name} CONTAINED!`, 'text-emerald-300 font-bold');
        recordStageClear();

        if (state.stageIndex >= ENCOUNTERS.length - 1) {
          state.runStatus = 'victory';
          saveRunState();
          ui.showRunEndModal(true);
          return;
        }

        const draftPool = Object.values(CARD_DB).filter((c) => !c.starter && c.draftable !== false);
        state.runStatus = 'draft';
        state.draftChoices = shuffle(draftPool).slice(0, 3).map((card) => card.id);
        const ownedRelics = new Set(state.relics);
        state.relicChoices = shuffle(Object.keys(RELIC_DB).filter((relicId) => !ownedRelics.has(relicId))).slice(0, 3);
        saveRunState();
        ui.openDraftModal(state.draftChoices, state.relicChoices, state.masterDeck);
      }

      function recordStageClear() {
        profileStats.highestWaveCleared = Math.max(profileStats.highestWaveCleared, state.stageIndex + 1);
        LEADERS.forEach(({ id }) => {
          const artId = profileStats.selectedArts[id];
          profileStats.artWaveClears[id][artId] += 1;
        });
        if (!profileStats.unlockedKaiju.includes(state.enemy.id)) {
          profileStats.unlockedKaiju.push(state.enemy.id);
        }
        if (state.stageIndex === ENCOUNTERS.length - 1) {
          profileStats.leaderWins[state.leader] += 1;
          const totalFullClears = Object.values(profileStats.leaderWins).reduce((sum, wins) => sum + wins, 0);
          profileStats.maxEncoreLevel = Math.min(5, totalFullClears);
          const duration = Math.max(0, Date.now() - state.startedAt);
          if (profileStats.fastestWinMs === null || duration < profileStats.fastestWinMs) {
            profileStats.fastestWinMs = duration;
          }
        }
        persistProfileStats();
      }

      function persistProfileStats() {
        if (!profileStorageAvailable) return;
        try {
          saveProfileStats(profileStats);
        } catch (error) {
          if (!(error instanceof ProfileStorageError)) throw error;
          profileStorageAvailable = false;
          console.error('Unable to save player profile stats.', error);
          ui.showSaveNotice('Run statistics could not be saved in this browser.');
        }
      }

      function applyRelicEffects(trigger, playedCard = null, effectiveCardCost = null) {
        state.relics.forEach((relicId) => {
          const relic = RELIC_DB[relicId];
          if (!relic) throw new Error(`Unknown owned relic: ${relicId}`);
          relic.effects.filter((effect) => effect.trigger === trigger).forEach((effect) => {
            if (trigger === 'attackPlayed' && playedCard?.type !== 'ATTACK') return;
            switch (effect.type) {
              case 'startingEnergy':
                state.player.energy += effect.amount;
                addLog(`✦ ${relic.name}: +${effect.amount} starting Hype Energy.`, 'text-amber-300');
                break;
              case 'gainBlock':
                state.player.block += effect.amount;
                ui.spawnPopup('playerArenaCard', `+${effect.amount} 🛡️`, 'text-cyan-300 font-display font-black text-lg');
                addLog(`✦ ${relic.name}: gained +${effect.amount} Holo Shield.`, 'text-cyan-300');
                break;
              case 'cheerGainPercent':
                if (trigger !== 'cardPlayed' || effectiveCardCost === null) break;
                const baseGain = 5 + effectiveCardCost * 3;
                const bonusCheer = Math.ceil(baseGain * effect.amount / 100);
                state.player.cheer = Math.min(100, state.player.cheer + bonusCheer);
                addLog(`✦ ${relic.name}: +${bonusCheer}% bonus Crowd Cheer.`, 'text-pink-300');
                break;
              case 'zeroCostAttackDamage':
                if (trigger !== 'attackPlayed' || playedCard?.type !== 'ATTACK' || effectiveCardCost !== 0 || !state.enemy) break;
                let remaining = effect.amount;
                const blocked = Math.min(state.enemy.block, remaining);
                state.enemy.block -= blocked;
                remaining -= blocked;
                if (remaining > 0) {
                  state.enemy.hp = Math.max(0, state.enemy.hp - remaining);
                  state.damageDealtThisTurn += remaining;
                  ui.spawnPopup('enemyArenaCard', `-${remaining}`, 'text-amber-300 font-display font-black text-xl');
                  triggerEnemyPassives('onHpBelowHalf');
                }
                addLog(`✦ ${relic.name}: +${effect.amount} damage to 0-cost Attack.`, 'text-fuchsia-300');
                break;
              case 'skillGainBlock':
                if (trigger !== 'skillPlayed' || playedCard?.type !== 'SKILL') break;
                state.player.block += effect.amount;
                ui.spawnPopup('playerArenaCard', `+${effect.amount} 🛡️`, 'text-cyan-300 font-display font-black text-lg');
                addLog(`✦ ${relic.name}: +${effect.amount} Holo Shield for playing a Skill.`, 'text-cyan-300');
                break;
              case 'charmDuration':
                if (trigger !== 'skillPlayed' || playedCard?.type !== 'SKILL') break;
                if ((state.enemy.statuses.charm || 0) > 0) {
                  state.enemy.statuses.charm += effect.amount;
                  addLog(`✦ ${relic.name}: +${effect.amount} Charm duration.`, 'text-purple-300');
                }
                break;
              default:
                throw new Error(`Unsupported relic effect type: ${effect.type}`);
            }
          });
        });
      }

      // =========================================================================
      // Combat logging and UI render coordination
      // =========================================================================
      function addLog(text, colorClass = 'text-slate-300') {
        state.logs.unshift({ text, colorClass, turn: state.turn });
        if (state.logs.length > 35) state.logs.pop();
      }

      function renderAll() {
        ui.renderAll();
        saveRunState();
      }

      function syncPage() {
        const devtoolsOpen = window.location.hash === '#devtools' && state !== null;
        document.getElementById('gamePage').classList.toggle('hidden', devtoolsOpen);
        document.getElementById('devtoolsPage').classList.toggle('hidden', !devtoolsOpen);
        if (ui && state) ui.renderAll();
      }

      function playSoundEffect(play) {
        if (!isSoundEnabled()) return;
        try {
          play();
        } catch (error) {
          setSoundEnabled(false);
          ui.updateSoundButton(false, isSoundSupported());
          console.error('A sound effect failed; sound has been disabled.', error);
          ui.showSaveNotice('A sound effect failed to play and has been disabled. Gameplay can continue normally.');
        }
      }

      // =========================================================================
      // Run flow and event wiring
      // =========================================================================
      function startNewRun(leader, encoreLevel = 0) {
        if (!LEADERS.some(({ id }) => id === leader)) {
          throw new Error(`Unknown run leader: ${leader}`);
        }
        encoreLevel = Number.isInteger(encoreLevel) ? Math.min(5, Math.max(0, encoreLevel)) : 0;
        if (encoreLevel > (profileStats.maxEncoreLevel ?? 0)) return;
        ui.hideRunModals();
        state = createNewRunState(leader, encoreLevel);
        startStage(0);
        syncPage();
      }

      function selectLeaderArt(leader, artId) {
        const leaderWins = profileStats.leaderWins[leader];
        if (!Number.isInteger(leaderWins)) throw new Error(`Unknown art leader: ${leader}`);
        if (!getUnlockedArtStyles(leaderWins).some((style) => style.id === artId)) {
          throw new Error(`Art style ${artId} is not unlocked for ${leader}.`);
        }
        profileStats.selectedArts[leader] = artId;
        persistProfileStats();
        renderAll();
      }

      function openNewRunSelection() {
        ui.openLeaderSelection(Boolean(state), state?.leader);
      }

      function chooseDraftCard(cardId) {
        if (state.runStatus !== 'draft' || !state.draftChoices.includes(cardId)) return;
        const card = CARD_DB[cardId];
        state.masterDeck.push({
          instanceId: state.nextCardInstanceId++,
          cardId,
          upgradeLevel: 0
        });
        state.player.hp = Math.min(state.player.maxHp, state.player.hp + (state.encoreLevel >= 2 ? 12 : 18));
        state.runStatus = 'playing';
        state.draftChoices = [];
        state.relicChoices = [];
        document.getElementById('draftModal').classList.add('hidden');
        addLog(`✨ Drafted "${card.name}" & restored +${state.encoreLevel >= 2 ? 12 : 18} HP!`, 'text-amber-300');
        startStage(state.stageIndex + 1);
      }

      function chooseRelic(relicId) {
        if (state.runStatus !== 'draft' || !state.relicChoices.includes(relicId) || state.relics.includes(relicId)) return;
        const relic = RELIC_DB[relicId];
        state.relics.push(relicId);
        state.player.hp = Math.min(state.player.maxHp, state.player.hp + (state.encoreLevel >= 2 ? 12 : 18));
        state.runStatus = 'playing';
        state.draftChoices = [];
        state.relicChoices = [];
        document.getElementById('draftModal').classList.add('hidden');
        addLog(`✦ Equipped ${relic.name} & restored +${state.encoreLevel >= 2 ? 12 : 18} HP!`, 'text-amber-300');
        startStage(state.stageIndex + 1);
      }

      function upgradeCard(instanceId) {
        if (state.runStatus !== 'draft') return;
        const instance = state.masterDeck.find((card) => card.instanceId === instanceId);
        if (!instance || instance.upgradeLevel !== 0 || !CARD_DB[instance.cardId]?.upgrade) return;
        instance.upgradeLevel = 1;
        state.runStatus = 'playing';
        state.draftChoices = [];
        state.relicChoices = [];
        document.getElementById('draftModal').classList.add('hidden');
        addLog(`⬆️ Upgraded "${CARD_DB[instance.cardId].name}" for the rest of the run.`, 'text-amber-300');
        startStage(state.stageIndex + 1);
      }

      function skipDraft() {
        if (state.runStatus !== 'draft') return;
        state.player.hp = Math.min(state.player.maxHp, state.player.hp + 25);
        state.runStatus = 'playing';
        state.draftChoices = [];
        state.relicChoices = [];
        document.getElementById('draftModal').classList.add('hidden');
        addLog('💖 Skipped draft & rested backstage (+25 HP).', 'text-emerald-300');
        startStage(state.stageIndex + 1);
      }

      function wireEvents() {
        document.getElementById('btnEndTurn').addEventListener('click', endPlayerTurn);
        document.getElementById('btnJointAttack').addEventListener('click', triggerJointAttack);
        document.getElementById('btnLeaderAbility').addEventListener('click', useLeaderAbility);
        document.getElementById('btnNewRun').addEventListener('click', openNewRunSelection);
        document.getElementById('btnRestartRunEnd').addEventListener('click', openNewRunSelection);
        document.getElementById('btnStartNewRun').addEventListener('click', () => {
          startNewRun(ui.getSelectedLeader(), ui.getSelectedEncoreLevel());
        });
        document.getElementById('btnStats').addEventListener('click', () => ui.showStatsModal());
        document.getElementById('btnCloseStats').addEventListener('click', () => {
          document.getElementById('statsModal').classList.add('hidden');
        });
        document.getElementById('btnSound').addEventListener('click', () => {
          const enabled = setSoundEnabled(!isSoundEnabled());
          ui.updateSoundButton(enabled, isSoundSupported());
        });

        document.getElementById('btnSkipDraft').addEventListener('click', skipDraft);

        document.getElementById('btnViewDraw').addEventListener('click', () => {
          ui.openPileModal('DRAW PILE', state.drawPile);
        });
        document.getElementById('btnViewDiscard').addEventListener('click', () => {
          ui.openPileModal('DISCARD PILE', state.discardPile);
        });
        document.getElementById('btnClosePileModal').addEventListener('click', () => {
          document.getElementById('pileModal').classList.add('hidden');
        });

        window.addEventListener('keydown', (e) => {
          if (!state || !state.isPlayerTurn) return;
          if (e.key >= '1' && e.key <= '5') {
            const idx = parseInt(e.key, 10) - 1;
            if (idx < state.hand.length) playCardAtIndex(idx);
          } else if (e.key.toLowerCase() === 'e') {
            endPlayerTurn();
          }
        });
      }

      function saveRunState() {
        if (!state || !storageAvailable) return;
        try {
          saveRun(state);
        } catch (error) {
          if (!(error instanceof RunStorageError)) throw error;
          storageAvailable = false;
          console.error('Unable to autosave the current run.', error);
          ui.showSaveNotice('Autosave is unavailable in this browser. Your current run will not survive a reload.');
        }
      }

      function restoreRunModal() {
        if (state.runStatus === 'draft') {
          ui.openDraftModal(state.draftChoices, state.relicChoices, state.masterDeck);
        } else if (state.runStatus === 'victory' || state.runStatus === 'defeat') {
          ui.showRunEndModal(state.runStatus === 'victory');
        }
      }

      async function initializeGame() {
        try {
          const gameData = await loadGameData();
          ART_ASSETS = gameData.artAssets;
          CARD_DB = gameData.cardDatabase;
          RELIC_DB = gameData.relicDatabase;
          ENCOUNTERS = gameData.encounters;
          STARTER_DECK = gameData.starterDeck;
          ui = createGameUI({
            getState: () => state,
            getArtAssets: () => ({
              ...ART_ASSETS,
              ...Object.fromEntries(LEADERS.map(({ id }) => [
                id,
                ART_ASSETS.leaderArts[id][profileStats.selectedArts[id]]
              ]))
            }),
            getLeaderArts: () => ART_ASSETS.leaderArts,
            getCardDatabase: () => CARD_DB,
            getRelicDatabase: () => RELIC_DB,
            getProfileStats: () => profileStats,
            getEncounters: () => ENCOUNTERS,
            getCurrentEnemyIntent,
            onPlayCard: playCardAtIndex,
            onJumpToStage: startStage,
            onChooseDraftCard: chooseDraftCard,
            onChooseRelic: chooseRelic,
            onUpgradeCard: upgradeCard,
            onSelectLeaderArt: selectLeaderArt
          });
          ui.setChangelog(gameData.changelog);
          wireEvents();
          ui.updateSoundButton(isSoundEnabled(), isSoundSupported());

          try {
            profileStats = loadProfileStats();
          } catch (error) {
            if (error instanceof ProfileStorageError) {
              profileStorageAvailable = false;
              console.error('Unable to read player profile stats.', error);
              ui.showSaveNotice('Profile statistics are unavailable in this browser.');
            } else if (error instanceof InvalidProfileStatsError) {
              console.error('Saved profile stats could not be restored.', error);
              ui.showSaveNotice('Saved profile statistics could not be restored and have been reset.');
              profileStats = createDefaultProfileStats();
              try {
                saveProfileStats(profileStats);
              } catch (saveError) {
                if (!(saveError instanceof ProfileStorageError)) throw saveError;
                profileStorageAvailable = false;
                console.error('Unable to reset invalid profile stats.', saveError);
                ui.showSaveNotice('Saved profile stats were invalid and could not be reset in this browser.');
              }
            } else {
              throw error;
            }
          }

          let savedRun = null;
          try {
            savedRun = loadSavedRun();
            if (savedRun !== null) {
              savedRun = migrateSavedRun(savedRun, {
                cardDatabase: CARD_DB,
                relicDatabase: RELIC_DB,
                encounters: ENCOUNTERS,
                shuffle
              });
            }
          } catch (error) {
            if (error instanceof RunStorageError) {
              storageAvailable = false;
              console.error('Unable to read the saved run.', error);
              ui.showSaveNotice('Browser storage is unavailable. This run cannot be saved between visits.');
            } else if (error instanceof InvalidSavedRunError) {
              console.error('The saved run could not be restored.', error);
              ui.showSaveNotice('The previous saved run could not be restored. Choose a leader to start a new run.');
              savedRun = null;
            } else {
              throw error;
            }
          }

          if (savedRun !== null && !isValidSavedRun(savedRun, {
            cardDatabase: CARD_DB,
            relicDatabase: RELIC_DB,
            encounters: ENCOUNTERS
          })) {
            ui.showSaveNotice('The previous saved run could not be restored. Choose a leader to start a new run.');
            savedRun = null;
          }

          if (savedRun) {
            state = savedRun.state;
            renderAll();
            restoreRunModal();
            syncPage();
          } else {
            ui.openLeaderSelection(false, null);
          }
        } catch (error) {
          console.error('Unable to load game data and assets.', error);
          const errorElement = document.getElementById('loadError');
          errorElement.textContent = `Unable to load game data. Serve the project with a web server, then reload. ${error.message}`;
          errorElement.classList.remove('hidden');
        }
      }

      window.addEventListener('hashchange', syncPage);
      syncPage();
      initializeGame();
    })();
