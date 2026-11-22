import { executeCardEffects, getEffectiveCardCost } from './card-effects.js';
import {
  isSoundEnabled,
  isSoundSupported,
  playCardSfx,
  playJointFinaleSfx,
  playKaijuRoarSfx,
  playBossEnrageSfx,
  playDorsalInterruptSfx,
  playSettingsTestSfx,
  setSoundEnabled
} from './audio.js';
import {
  applyPlayerDamage,
  calculateEnemyAttackDamage,
  createTurnMemberState,
  getDeathLogEntries,
  getEncoreBossMaxHp,
  getEncoreInterruptThreshold,
  getEncorePhase2Ratio,
  MAX_HAND_SIZE,
  MAX_HAND_LIMIT,
  MAX_BUFF_SLOTS,
  MEMBER_SYNERGY,
  recordMemberPlay,
  shouldInterruptChargedIntent
} from './combat-rules.js';
import { pickVoiceLine } from './voice-lines.js';
import { loadGameData } from './game-data.js';
import { createDailyChallenge, nextSeededRandom } from './daily-challenge.js';
import {
  createDefaultProfileStats,
  InvalidProfileStatsError,
  loadProfileStats,
  OutdatedProfileStatsError,
  ProfileStorageError,
  saveProfileStats
} from './profile-storage.js';
import { getActionForKey, normalizeKeybinds } from './keybinds.js';
import { getTourRoute, TOUR_ROUTES } from './tour-routes.js';
import { createTourEvents, getTourEvent, rollTourEvent } from './tour-events.js';
import { createShop } from './shop.js';
import { createOptionsUI } from './options-ui.js';
import {
  clearSavedRun,
  InvalidSavedRunError,
  loadSavedRun,
  RUN_SAVE_VERSION,
  RunStorageError,
  saveRun
} from './run-storage.js';
import { isValidSavedRun, migrateSavedRun, STAGE_HAZARDS } from './run-state.js';
import { createGameUI } from './ui.js';
import { getUnlockedArtStyles, LEADERS } from './leader-data.js';
import { getCardFinishLevel, getNextFinishLevel } from './card-finishes.js';
import { testMission } from './missions.js';
import { initBugReportLinks } from './bug-report.js';
import { generateRoomCode, isValidRoomCode, pvpCoinFlip } from './pvp-protocol.js';
import { createPvpRoom, createSupabasePvpBus } from './pvp-net.js';
import { createPvpUI } from './pvp-ui.js';
import { getBoardConfig } from './leaderboard.js';
import { buildScorePayload, checkCrowns, getMostPlayedCard, submitDailyScore as submitLeaderboardScore } from './leaderboard.js';

(function () {
  'use strict';

  let ART_ASSETS = null;
  let MISSION_DEFS = [];
  let CARD_DB = {};
  let RELIC_DB = {};
  let GAME_VERSION = '';
  let ENCOUNTERS = [];
  let ENCOUNTERS_BY_ID = {};
  let ENCOUNTER_POOLS = [];
  let ALL_ENCOUNTERS = [];
  let STARTER_DECKS = {};
  let defaultKeybinds = null;
  let profileStats = null;
  let ui = null;
  let optionsUI = null;
  let state = null;
  let mainMenuOpen = true;
  let storageAvailable = true;
  let profileStorageAvailable = true;
  let pendingBuffHandIndex = null;
  let pvpUI = null;
  let pvp = null; // active duel session or null (ephemeral, never saved)

      function getUtcDateString(date = new Date()) {
        return date.toISOString().slice(0, 10);
      }

      function getTodayDailyChallenge() {
        return createDailyChallenge(
          getUtcDateString(),
          LEADERS.map(({ id }) => id),
          Object.keys(RELIC_DB).filter((id) => !RELIC_DB[id].leaderId)
        );
      }

      function hashDailySeed(text) {
        let hash = 2166136261;
        for (let i = 0; i < text.length; i++) {
          hash ^= text.charCodeAt(i);
          hash = Math.imul(hash, 16777619);
        }
        return hash >>> 0;
      }

      function rollEncounterOrder(rng) {
        return ENCOUNTER_POOLS.map((slot) => slot[Math.floor(rng() * slot.length) % slot.length]);
      }

      function rollDailyEncounterOrder(date) {
        return ENCOUNTER_POOLS.map((slot, index) =>
          slot[hashDailySeed(`${date}:${index}`) % slot.length]
        );
      }

      function buildEncountersFromOrder(order) {
        const picked = order.map((id) => {
          const encounter = ENCOUNTERS_BY_ID[id];
          if (!encounter) throw new InvalidSavedRunError('The saved run references an unknown encounter.');
          return encounter;
        });
        if (picked.length !== ENCOUNTER_POOLS.length) {
          throw new InvalidSavedRunError('The saved run has an incomplete encounter order.');
        }
        ENCOUNTERS = picked;
      }

      function nextRandom() {
        return state && Number.isInteger(state.rngState)
          ? nextSeededRandom(state)
          : Math.random();
      }

      function shuffle(arr) {
        const copy = [...arr];
        for (let i = copy.length - 1; i > 0; i--) {
          const j = Math.floor(nextRandom() * (i + 1));
          [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy;
      }

      function createNewRunState(leader, encoreLevel = 0, dailyChallenge = null, encounterOrder = [], modifiers = null) {
        let nextCardInstanceId = 1;
        const leaderDeck = STARTER_DECKS[leader];
        if (!Array.isArray(leaderDeck)) {
          throw new Error(`No starter deck is configured for leader ${leader}.`);
        }
        const masterDeck = leaderDeck.map((cardId) => ({
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
        const starterRelic = Object.values(RELIC_DB).find((relic) => relic.leaderId === leader);
        if (!dailyChallenge && !starterRelic) {
          throw new Error(`No starter relic is configured for leader ${leader}.`);
        }
        const dailyModifier = dailyChallenge?.modifier;
        const maxEnergy = dailyModifier === 'acoustic_set' ? 4 : 3;
        const initialRelics = dailyChallenge
          ? dailyChallenge.relicId ? [dailyChallenge.relicId] : []
          : [starterRelic.id];
        return {
          stageIndex: 0,
          wavesCleared: 0,
          damageDealtThisTurn: 0,
          peakSingleTurnDamage: 0,
          skillsPlayedThisTurn: 0,
          relicTriggersThisTurn: {},
          handLimit: MAX_HAND_SIZE,
          keptCardInstanceId: null,
          energyPenalty: 0,
          cardPlayCounts: {},
          ...createTurnMemberState(),
          leader,
          encoreLevel,
          dailyChallenge: dailyChallenge
            ? {
                date: dailyChallenge.date,
                seed: dailyChallenge.seed,
                leader: dailyChallenge.leader,
                relicId: dailyChallenge.relicId,
                modifier: dailyChallenge.modifier
              }
            : null,
          rngState: dailyChallenge?.rngState ?? null,
          leaderAbilityUsed: false,
          turn: 1,
          startedAt: Date.now(),
          nextCardInstanceId,
          runStatus: 'playing',
          draftChoices: [],
          relicChoices: [],
          routeChoices: [],
          rewardMode: null,
          tourEventId: null,
          encounterOrder: [...encounterOrder],
          modifiers: {
            chaosDraft: modifiers?.chaosDraft === true,
            limitedRemovals: modifiers?.limitedRemovals === true,
            doubleHazards: modifiers?.doubleHazards === true
          },
          secondHazard: null,
          merchTokens: 0,
          shop: null,
          relics: initialRelics,
          isPlayerTurn: true,
          masterDeck,
          drawPile: [],
          hand: [],
          discardPile: [],
          exhaustPile: [],
          buffs: [],
          player: {
            hp: 80,
            maxHp: 80,
            block: 0,
            energy: maxEnergy,
            maxEnergy,
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
        const encoreMaxHp = getEncoreBossMaxHp(enc.maxHp, state.encoreLevel);
        const waveMaxHp = Math.ceil(encoreMaxHp * (1 + 0.03 * stageIdx));
        const bossMaxHp = state.dailyChallenge?.modifier === 'encore_pressure'
          ? Math.ceil(waveMaxHp * 1.15)
          : waveMaxHp;

        state.stageIndex = stageIdx;
        state.turn = 1;
        state.damageDealtThisTurn = 0;
        state.skillsPlayedThisTurn = 0;
        state.relicTriggersThisTurn = {};
        state.handLimit = MAX_HAND_SIZE;
        state.keptCardInstanceId = null;
        state.energyPenalty = 0;
        Object.assign(state, createTurnMemberState());
        state.runStatus = 'playing';
        state.draftChoices = [];
        state.relicChoices = [];
        state.routeChoices = [];
        state.rewardMode = null;
        state.tourEventId = null;
        state.shop = null;
        state.secondHazard = null;
        if (state.modifiers?.doubleHazards) {
          const others = shuffle(STAGE_HAZARDS.filter((hazard) => hazard !== enc.stageEffect));
          state.secondHazard = others.length > 0 ? others[0] : null;
        }
        state.isPlayerTurn = true;
        expireTimedBuffsAtWaveEnd();
        const activeBuffIds = new Set(state.buffs.map((buff) => buff.instanceId));
        state.drawPile = shuffle(state.masterDeck.filter((instance) => !activeBuffIds.has(instance.instanceId)));
        state.hand = [];
        state.discardPile = [];
        state.exhaustPile = [];
        state.player.block = 0;
        state.player.energy = state.player.maxEnergy;
        if (state.dailyChallenge?.modifier === 'crowd_surf') {
          state.player.cheer = Math.min(100, state.player.cheer + 15);
        }
        state.player.statuses = { encore: 0, weak: 0 };

        state.enemy = {
          ...enc,
          hp: bossMaxHp,
          maxHp: bossMaxHp,
          block: 0,
          strength: (enc.strength || 0) + (state.encoreLevel >= 3 ? 1 : 0) + (stageIdx >= 4 ? 1 : 0) + (stageIdx >= 7 ? 1 : 0),
          stageEffect: enc.stageEffect,
          enrageTriggered: false,
          patternStep: 0,
          reflectUsedThisTurn: false,
          statuses: { charm: 0, marked: 0 }
        };

        applyRelicEffects('stageStart');
        addLog(`🚨 WAVE ${stageIdx + 1}: ${enc.name} entered the stadium!`, 'text-sky-300 font-bold');
        drawCards(5);
        renderAll();
      }

      function drawCards(count) {
        const limit = state.handLimit ?? MAX_HAND_SIZE;
        for (let i = 0; i < count; i++) {
          if (state.hand.length >= limit) break;
          if (state.drawPile.length === 0) {
            if (state.discardPile.length === 0) break;
            state.drawPile = shuffle(state.discardPile);
            state.discardPile = [];
          }
          const nextCard = state.drawPile.pop();
          if (nextCard) state.hand.push(nextCard);
        }
      }

      function getBuffAmount(buff) {
        const def = CARD_DB[buff.cardId]?.buff;
        if (!def) return 0;
        return def.amount + (buff.upgradeLevel > 0 ? (def.upgradeAmount || 0) : 0);
      }

      function getCardDamagePreview(cardInstance) {
        const card = CARD_DB[cardInstance?.cardId];
        if (!card) return null;
        const damageEffects = (card.effects || []).filter((effect) => effect.type === 'damage');
        if (damageEffects.length === 0) return null;
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
          lethal: state.enemy.hp > 0 && hpDamage >= state.enemy.hp
        };
      }

      function computeCardAttackDamage(baseDmg) {
        const buffBonus = state.buffs.reduce((sum, buff) => {
          const def = CARD_DB[buff.cardId]?.buff;
          return def?.trigger === 'passive' && def.effect === 'bonusAttackDamage'
            ? sum + getBuffAmount(buff)
            : sum;
        }, 0);
        let dmg = baseDmg + (state.player.statuses.encore || 0) + buffBonus;
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

      function toggleKeptCard(instanceId) {
        if (!state.isPlayerTurn) return;
        if (!Number.isInteger(instanceId)) return;
        if (!state.hand.some((cardInstance) => cardInstance.instanceId === instanceId)) return;
        state.keptCardInstanceId = state.keptCardInstanceId === instanceId ? null : instanceId;
        renderAll();
      }

      function chooseBuffReplacement(slotIndex) {
        if (pendingBuffHandIndex === null) return;
        const handIndex = pendingBuffHandIndex;
        pendingBuffHandIndex = null;
        ui.closeBuffReplaceModal();
        const cardInstance = state.hand[handIndex];
        const card = CARD_DB[cardInstance?.cardId];
        if (
          !card ||
          card.type !== 'BUFF' ||
          state.buffs.length < MAX_BUFF_SLOTS ||
          !Number.isInteger(slotIndex) ||
          slotIndex < 0 ||
          slotIndex >= state.buffs.length
        ) {
          renderAll();
          return;
        }
        const cost = getEffectiveCardCost(card, cardInstance.upgradeLevel);
        if (state.player.energy < cost) {
          renderAll();
          return;
        }
        const [replaced] = state.buffs.splice(slotIndex, 1);
        if (replaced) {
          discardBuffEntry(replaced);
          addLog(`♻️ ${CARD_DB[replaced.cardId]?.name || 'Buff'} was replaced.`, 'text-slate-400');
        }
        playCardAtIndex(handIndex);
      }

      function cancelBuffReplacement() {
        pendingBuffHandIndex = null;
        ui.closeBuffReplaceModal();
        renderAll();
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

        if (card.type === 'BUFF' && state.buffs.length >= MAX_BUFF_SLOTS) {
          pendingBuffHandIndex = handIdx;
          ui.openBuffReplaceModal(state.buffs.map((buff) => ({
            ...buff,
            name: CARD_DB[buff.cardId]?.name,
            art: CARD_DB[buff.cardId]?.art
          })));
          return;
        }

        playSoundEffect(playCardSfx);
        state.player.energy -= cost;
        state.cardPlayCounts[card.id] = (state.cardPlayCounts[card.id] || 0) + 1;
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
          dealEnemyDmg: (amount, pierce = 0) => dealDamageToEnemy(amount, pierce),
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
          raiseHandLimit: (amount) => {
            const ceiling = Math.max(MAX_HAND_SIZE, state.handLimit ?? MAX_HAND_SIZE) + amount;
            state.handLimit = Math.min(MAX_HAND_LIMIT, ceiling);
          },
          stealEnemyBlock: (amount) => {
            const stolen = Math.min(state.enemy.block, amount);
            state.enemy.block -= stolen;
            state.player.block += stolen;
            if (stolen > 0) {
              ui.spawnPopup('enemyArenaCard', `-${stolen} 🛡️`, 'text-cyan-300 font-display font-black text-lg');
              ui.spawnPopup('playerArenaCard', `+${stolen} 🛡️`, 'text-cyan-300 font-display font-black text-lg');
            }
            return stolen;
          },
          log: (msg, cls) => addLog(msg, cls)
        };
      }

      function dealDamageToEnemy(amount, pierce = 0) {
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
          ui.triggerKaijuHitAnim();
          ui.spawnPopup('enemyArenaCard', `-${hpDamage}`, 'text-amber-300 font-display font-black text-xl');
          triggerEnemyPassives('onHpBelowHalf');
        } else {
          ui.spawnPopup('enemyArenaCard', 'BLOCKED', 'text-cyan-300 font-display font-bold text-sm');
        }
        return hpDamage;
      }

      function resolveMemberSynergy({ harmonyTriggered, spotlightTriggered }) {
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

      function playVoiceLine(category, memberId = null) {
        const line = pickVoiceLine(category, memberId);
        if (line) ui.showVoiceLine(line.speaker, line.text);
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
        playVoiceLine('finale');

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
        const keptCardInstanceId = state.keptCardInstanceId ?? null;
        while (state.hand.length > 0) {
          const cardInstance = state.hand.pop();
          const card = CARD_DB[cardInstance.cardId];
          const isKept = keptCardInstanceId !== null && cardInstance.instanceId === keptCardInstanceId;
          if (card?.retain || card?.retainInHand || isKept) {
            retainedCards.unshift(cardInstance);
          } else {
            state.discardPile.push(cardInstance);
          }
        }
        state.hand.push(...retainedCards);
        state.keptCardInstanceId = null;

      function applyStageHazard(hazard, isSecond = false) {
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

      applyStageHazard(state.enemy.stageEffect);
      if (state.secondHazard) applyStageHazard(state.secondHazard, true);

      if (state.player.hp <= 0 && finishPlayerDefeat()) return;

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
          playSoundEffect(playDorsalInterruptSfx);
        } else {
          addLog(`--- ${e.name} executes ${intent.displayText} ---`, 'text-sky-300 font-bold');
          if (typeof intent.effectiveDmg === 'number') playSoundEffect(playKaijuRoarSfx);

          if (intent.type === 'charge') {
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

        if (state.player.hp <= 0 && finishPlayerDefeat()) return;

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

      function discardBuffEntry(buff) {
        state.discardPile.push({
          instanceId: buff.instanceId,
          cardId: buff.cardId,
          upgradeLevel: buff.upgradeLevel
        });
      }

      function expireTimedBuffsAtWaveEnd() {
        const surviving = [];
        state.buffs.forEach((buff) => {
          if (buff.remaining === null) {
            surviving.push(buff);
            return;
          }
          addLog(`⏳ ${CARD_DB[buff.cardId]?.name || 'Buff'} expired at the end of the wave.`, 'text-slate-400');
        });
        state.buffs = surviving;
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
        const surviving = [];
        state.buffs.forEach((buff) => {
          const card = CARD_DB[buff.cardId];
          const def = card?.buff;
          if (!def) return;

          if (def.trigger === 'turnStart') {
            const amount = getBuffAmount(buff);
            if (def.effect === 'gainBlock') {
              state.player.block += amount;
              ui.spawnPopup('playerArenaCard', `+${amount} 🛡️`, 'text-cyan-300 font-display font-black text-lg');
            } else if (def.effect === 'heal') {
              const healed = Math.min(state.player.maxHp - state.player.hp, amount);
              state.player.hp += healed;
              if (healed > 0) {
                ui.spawnPopup('playerArenaCard', `+${healed} ❤️`, 'text-emerald-300 font-display font-black text-lg');
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
        const negateIndex = state.buffs.findIndex((buff) =>
          CARD_DB[buff.cardId]?.buff?.effect === 'negateDamage'
        );
        if (negateIndex >= 0 && rawDmg > 0) {
          const [consumed] = state.buffs.splice(negateIndex, 1);
          discardBuffEntry(consumed);
          addLog(`⏳ ${CARD_DB[consumed.cardId]?.name || 'Buff'} negated ${rawDmg} damage and shattered.`, 'text-sky-300 font-bold');
          ui.spawnPopup('playerArenaCard', 'NEGATED', 'text-sky-300 font-display font-black');
          return;
        }
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
        const reviveIndex = state.buffs.findIndex((buff) =>
          CARD_DB[buff.cardId]?.buff?.effect === 'revive'
        );
        if (reviveIndex >= 0) {
          const [consumed] = state.buffs.splice(reviveIndex, 1);
          const reviveHp = getBuffAmount(consumed);
          state.player.hp = Math.min(state.player.maxHp, Math.max(1, reviveHp));
          discardBuffEntry(consumed);
          addLog(`👼 ${CARD_DB[consumed.cardId]?.name || 'Buff'} revived K/DA at ${state.player.hp} HP!`, 'text-emerald-300 font-bold');
          ui.spawnPopup('playerArenaCard', `REVIVED ${state.player.hp} ❤️`, 'text-emerald-300 font-display font-black text-lg');
          renderAll();
          return false;
        }
        state.player.hp = 0;
        state.runStatus = 'defeat';
        recordDailyResult(false);
        evaluateMissions();
        renderAll();
        ui.showRunEndModal(false);
        handleDailyRunEnd();
        return true;
      }

      function triggerEnemyPassives(trigger) {
        const e = state.enemy;
        if (e.hp <= 0) return;
        for (const passive of e.passives || []) {
          if (passive.trigger !== trigger) continue;

          if (passive.effect === 'gainBlock') {
            e.block += passive.value;
            ui.spawnPopup('enemyArenaCard', `+${passive.value} 🛡️`, 'text-sky-300 font-display font-black text-lg');
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
          recordDailyResult(true);
          evaluateMissions();
          saveRunState();
          ui.showRunEndModal(true);
          handleDailyRunEnd();
          return;
        }

        const chaos = state.modifiers?.chaosDraft === true;
        const draftPool = Object.values(CARD_DB).filter((c) => (chaos || !c.starter) && c.draftable !== false);
        state.runStatus = 'draft';
        state.draftChoices = shuffle(draftPool).slice(0, 3).map((card) => card.id);
        const ownedRelics = new Set(state.relics);
        state.relicChoices = shuffle(Object.keys(RELIC_DB).filter((relicId) =>
          !ownedRelics.has(relicId) && (chaos || !RELIC_DB[relicId].leaderId)
        )).slice(0, 3);
        state.rewardMode = null;
        state.routeChoices = getAvailableRouteIds();
        state.tourEventId = rollTourEvent(nextRandom);
        shop.awardMerchTokens();
        shop.rollShopInventory();
        saveRunState();
        if (state.tourEventId && getTourEvent(state.tourEventId)) {
          ui.openTourEventModal(
            getTourEvent(state.tourEventId),
            tourEvents.getAvailableEventOptions(state.tourEventId),
            state.masterDeck
          );
          return;
        }
        state.tourEventId = null;
        saveRunState();
        ui.openTourRoutingModal(
          state.routeChoices.map((routeId) => getTourRoute(routeId)),
          getDraftHealAmount(),
          state.shop,
          state.merchTokens
        );
      }

      function isRewardAvailable(rewardMode) {
        if (rewardMode === 'rest') return true;
        if (rewardMode === 'cards') return state.draftChoices.length > 0;
        if (rewardMode === 'relics') return state.relicChoices.length > 0;
        if (rewardMode === 'cuts') return state.masterDeck.length > 1;
        if (rewardMode === 'upgrades') {
          return state.masterDeck.some(
            (instance) => instance.upgradeLevel === 0 && CARD_DB[instance.cardId]?.upgrade
          );
        }
        return false;
      }

      function getAvailableRouteIds() {
        const available = TOUR_ROUTES.filter((route) => isRewardAvailable(route.rewardMode));
        const ids = shuffle(available).slice(0, 3).map((route) => route.id);
        if (ids.length === 0) return ['fanmeet'];
        return ids;
      }

      function getDraftHealAmount() {
        return state.encoreLevel >= 2 ? 10 : 14;
      }

      function chooseTourRoute(routeId) {
        if (state.runStatus !== 'draft') return;
        if (!state.routeChoices.includes(routeId)) return;
        const route = getTourRoute(routeId);
        if (!route) return;
        if (!isRewardAvailable(route.rewardMode)) {
          state.routeChoices = getAvailableRouteIds();
          state.rewardMode = null;
          saveRunState();
          refreshRoutingModal();
          addLog('🎫 Leona rerouted K/DA: that stop sold out.', 'text-amber-300');
          return;
        }
        ui.closeTourRoutingModal();
        state.rewardMode = route.rewardMode;
        addLog(`🎫 Leona routed K/DA to ${route.name}.`, 'text-amber-300');
        ui.openDraftModal(state.draftChoices, state.relicChoices, state.masterDeck, route.rewardMode);
        saveRunState();
      }

      const tourEvents = createTourEvents({
        getState: () => state,
        getCardDatabase: () => CARD_DB,
        getRelicDatabase: () => RELIC_DB,
        shuffle,
        addLog,
        saveRunState,
        openEventModal: (event, options, deck) => ui.openTourEventModal(event, options, deck),
        closeEventModal: () => ui.closeTourEventModal(),
        showRouting: () => refreshRoutingModal(),
        isRewardAvailable,
        getAvailableRouteIds,
        getTourRoute
      });

      const shop = createShop({
        getState: () => state,
        getCardDatabase: () => CARD_DB,
        getRelicDatabase: () => RELIC_DB,
        shuffle,
        addLog,
        saveRunState,
        renderAll,
        showRouting: () => refreshRoutingModal(),
        getUnownedRelicIds: tourEvents.getUnownedRelicIds,
        pruneStaleRelicChoices: tourEvents.pruneStaleRelicChoices
      });

      function refreshRoutingModal() {
        ui.openTourRoutingModal(
          state.routeChoices.map((routeId) => getTourRoute(routeId)),
          getDraftHealAmount(),
          state.shop,
          state.merchTokens
        );
      }

      function evaluateMissions() {
        if (!state || !profileStats) return;
        const done = new Set(profileStats.completedMissions ?? []);
        const newly = MISSION_DEFS.filter((mission) => {
          if (!mission || done.has(mission.id)) return false;
          try {
            return testMission(mission, state, profileStats) === true;
          } catch {
            return false;
          }
        });
        if (newly.length === 0) return;
        profileStats.completedMissions = [...done, ...newly.map((mission) => mission.id)];
        const earned = newly.reduce((sum, mission) => sum + mission.reward, 0);
        profileStats.finishTokens = (Number.isInteger(profileStats.finishTokens) ? profileStats.finishTokens : 0) + earned;
        newly.forEach((mission) => addLog(`🏆 Mission complete: ${mission.name}! +${mission.reward} ✦ Spotlight Shards.`, 'text-amber-300 font-bold'));
      }

      function recordStageClear() {
        state.wavesCleared += 1;
        applyRelicEffects('waveClear');
        profileStats.finishTokens = (Number.isInteger(profileStats.finishTokens) ? profileStats.finishTokens : 0) + 1;
        addLog('✦ Earned 1 Spotlight Shard for clearing the wave.', 'text-amber-300');
        evaluateMissions();
        profileStats.highestWaveCleared = Math.max(profileStats.highestWaveCleared, state.stageIndex + 1);
        const artId = profileStats.selectedArts[state.leader];
        profileStats.artWaveClears[state.leader][artId] += 1;
        if (!profileStats.unlockedKaiju.includes(state.enemy.id)) {
          profileStats.unlockedKaiju.push(state.enemy.id);
        }
        if (state.stageIndex === ENCOUNTERS.length - 1) {
          profileStats.leaderWins[state.leader] += 1;
          if (!state.dailyChallenge) {
            // Clearing a tier unlocks exactly the next one, never a skip.
            profileStats.maxEncoreLevel = Math.min(
              5,
              Math.max(profileStats.maxEncoreLevel, state.encoreLevel + 1)
            );
            profileStats.maxEncoreWins[state.leader] = Math.max(
              profileStats.maxEncoreWins[state.leader] ?? 0,
              state.encoreLevel
            );
          }
          const duration = Math.max(0, Date.now() - state.startedAt);
          if (profileStats.fastestWinMs === null || duration < profileStats.fastestWinMs) {
            profileStats.fastestWinMs = duration;
          }
          profileStats.finishTokens += 3;
          addLog('✦ Tour victory bonus: +3 Spotlight Shards!', 'text-amber-300 font-bold');
        }
        persistProfileStats();
      }

      function recordDailyResult(won) {
        if (!state.dailyChallenge) return;
        const date = state.dailyChallenge.date;
        if (won) {
          if (
            profileStats.lastDailyWinDate !== date &&
            (!profileStats.lastDailyWinDate || date > profileStats.lastDailyWinDate)
          ) {
            const previousDate = new Date(`${date}T00:00:00Z`);
            previousDate.setUTCDate(previousDate.getUTCDate() - 1);
            const yesterday = getUtcDateString(previousDate);
            profileStats.dailyWinStreak = profileStats.lastDailyWinDate === yesterday
              ? profileStats.dailyWinStreak + 1
              : 1;
            profileStats.dailyBestWinStreak = Math.max(
              profileStats.dailyBestWinStreak,
              profileStats.dailyWinStreak
            );
            profileStats.lastDailyWinDate = date;
          }
        } else if (
          profileStats.lastDailyWinDate !== date &&
          (!profileStats.lastDailyWinDate || date >= profileStats.lastDailyWinDate)
        ) {
          profileStats.dailyWinStreak = 0;
        }
        persistProfileStats();
      }

      function getRunReceiptText() {
        const mostPlayed = getMostPlayedCard(state.cardPlayCounts, CARD_DB);
        const cardName = mostPlayed ? mostPlayed.name : '—';
        const dailyDescription = state.dailyChallenge
          ? `Daily Tour ${state.dailyChallenge.date} // ${state.dailyChallenge.modifier.replaceAll('_', ' ')}`
          : 'Standard Tour';
        const lines = [
          'K/DA // ENCORE SPIRE TOUR RECEIPT',
          `Mode: ${dailyDescription}`,
          `Leader: ${LEADERS.find(({ id }) => id === state.leader).name}`,
          `Waves Cleared: ${state.wavesCleared} / ${ENCOUNTERS.length}`,
          `Most-Played Card: ${cardName}${mostPlayed ? ` (${mostPlayed.count} plays)` : ''}`,
          `Peak Single-Turn Damage: ${state.peakSingleTurnDamage}`,
          `Merch Tokens: ${state.merchTokens ?? 0}`
        ];
        if (state.runStatus === 'defeat') {
          const deathEntries = getDeathLogEntries(state.logs, 8);
          lines.push('Death Log // Final Moments:');
          if (deathEntries.length === 0) {
            lines.push('- No combat actions were logged.');
          } else {
            deathEntries.forEach((entry) => {
              lines.push(`[T${entry.turn}] ${entry.text}`);
            });
          }
        }
        return lines.join('\n');
      }

      async function copyRunReceipt() {
        try {
          if (!navigator.clipboard?.writeText) {
            throw new Error('Clipboard access is unavailable in this browser.');
          }
          await navigator.clipboard.writeText(getRunReceiptText());
          ui.showReceiptCopyStatus('Tour receipt copied.');
        } catch (error) {
          console.error('Unable to copy the tour receipt.', error);
          ui.showReceiptCopyStatus('Copy failed. Clipboard access is unavailable.');
        }
      }

      function suggestDancerName() {
        return `Dancer${1000 + Math.floor(Math.random() * 9000)}`;
      }

      async function submitDailyScore() {
        const messages = {
          offline: 'Leaderboard offline — score kept locally. Check your connection.',
          unavailable: 'Leaderboard is unavailable right now.',
          unauthorized: 'Leaderboard sign-in failed.',
          invalid_score: 'Leaderboard rejected the score.',
          invalid_name: 'That display name is not allowed (3–16 characters).',
          rate_limited: 'Leaderboard rate limit — try the next run.'
        };
        try {
          const payload = {
            day: state.dailyChallenge.date,
            name: profileStats.playerName,
            ...buildScorePayload(state, CARD_DB, GAME_VERSION)
          };
          ui.showShareStatus('Sharing score…');
          const result = await submitLeaderboardScore(payload);
          if (result?.ok) {
            const line = result.improved
              ? '🏆 Daily score shared! New personal best.'
              : '🏆 Daily score shared (best kept).';
            addLog(line, 'text-amber-300 font-bold');
            ui.showShareStatus(line);
          } else {
            ui.showShareStatus(messages[result?.error] || 'Leaderboard share failed.');
          }
        } catch {
          ui.showShareStatus('Leaderboard offline — score kept locally. Check your connection.');
        }
      }

      function handleDailyRunEnd() {
        if (!state.dailyChallenge) return;
        if (profileStats.settings.shareScores === false) return;
        if (!profileStats.playerName) {
          ui.openConsentModal(suggestDancerName());
          return;
        }
        void submitDailyScore();
      }

      function confirmConsentShare(name) {
        const clean = typeof name === 'string' ? name.trim().slice(0, 16) : '';
        profileStats.playerName = clean || suggestDancerName();
        persistProfileStats();
        ui.closeConsentModal();
        void submitDailyScore();
      }

      function skipConsentShare() {
        ui.closeConsentModal();
        ui.showShareStatus('Score not shared.');
      }

        function optOutConsentShare() {
        updateProfileSettings({ ...profileStats.settings, shareScores: false });
        ui.closeConsentModal();
        addLog('🔕 Daily leaderboard sharing is off. Re-enable anytime in Options.', 'text-slate-400');
        renderAll();
      }

      function formatCrownPeriod(kind, start) {
        return kind === 'weekly' ? `week of ${start}` : start.slice(0, 7);
      }

      async function checkBoardCrowns(silent = true) {
        try {
          if (profileStats.settings.shareScores === false) return false;
          const today = getUtcDateString();
          if (silent && profileStats.lastCrownCheck === today) return false;
          const result = await checkCrowns();
          if (!result || result.error) return false;
          let crowned = false;
          for (const [kind, missionId] of [['weekly', 'crown_weekly'], ['monthly', 'crown_monthly']]) {
            const claim = result[kind];
            if (claim && claim.won && !(profileStats.completedMissions ?? []).includes(missionId)) {
              const mission = MISSION_DEFS.find((entry) => entry.id === missionId);
              const reward = mission?.reward ?? 10;
              profileStats.completedMissions = [...(profileStats.completedMissions ?? []), missionId];
              profileStats.finishTokens = (Number.isInteger(profileStats.finishTokens) ? profileStats.finishTokens : 0) + reward;
              addLog(`🏆 ${kind === 'weekly' ? 'Weekly' : 'Monthly'} Champion! +${reward} Spotlight Shards for ruling ${formatCrownPeriod(kind, claim.start)}.`, 'text-amber-300 font-bold');
              crowned = true;
            }
          }
          profileStats.lastCrownCheck = today;
          persistProfileStats();
          return crowned;
        } catch {
          return false;
        }
      }

      async function maybeCheckCrownsManual() {
        const crowned = await checkBoardCrowns(false);
        if (crowned) renderAll();
        ui.showMissions();
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

      function updateProfileSettings(settings) {
        profileStats.settings = {
          ...settings,
          keybinds: normalizeKeybinds(settings.keybinds, defaultKeybinds)
        };
        setSoundEnabled(profileStats.settings.soundEnabled);
        persistProfileStats();
        optionsUI?.renderSettings();
      }

      function applyRelicEffects(trigger, playedCard = null, effectiveCardCost = null) {
        // attackPlayed/skillPlayed relics fire at most once per turn each.
        // The per-relic record resets whenever a new player turn begins.
        if (trigger === 'attackPlayed' || trigger === 'skillPlayed') {
          if (state.relicTriggersThisTurn === null || typeof state.relicTriggersThisTurn !== 'object') state.relicTriggersThisTurn = {};
        }
        state.relics.forEach((relicId) => {
          const relic = RELIC_DB[relicId];
          if (!relic) throw new Error(`Unknown owned relic: ${relicId}`);
          const capped = trigger === 'attackPlayed' || trigger === 'skillPlayed';
          if (capped && state.relicTriggersThisTurn[relicId]) return;
          let fired = false;
          relic.effects.filter((effect) => effect.trigger === trigger).forEach((effect) => {
            if (trigger === 'attackPlayed' && playedCard?.type !== 'ATTACK') return;
            switch (effect.type) {
              case 'startingEnergy':
                state.player.energy += effect.amount;
                addLog(`✦ ${relic.name}: +${effect.amount} starting Hype Energy.`, 'text-amber-300');
                break;
              case 'startingBlock':
                state.player.block += effect.amount;
                ui.spawnPopup('playerArenaCard', `+${effect.amount} 🛡️`, 'text-cyan-300 font-display font-black text-lg');
                addLog(`✦ ${relic.name}: started the wave with +${effect.amount} Holo Shield.`, 'text-cyan-300');
                break;
              case 'heal': {
                const healed = Math.min(state.player.maxHp - state.player.hp, effect.amount);
                state.player.hp += healed;
                if (healed > 0) {
                  ui.spawnPopup('playerArenaCard', `+${healed} ❤️`, 'text-emerald-300 font-display font-black text-lg');
                }
                addLog(`✦ ${relic.name}: restored +${healed} HP.`, 'text-emerald-300');
                break;
              }
              case 'maxHp': {
                state.player.maxHp += effect.amount;
                state.player.hp = Math.min(state.player.maxHp, state.player.hp + effect.amount);
                addLog(`✦ ${relic.name}: +${effect.amount} Max HP.`, 'text-emerald-300');
                break;
              }
              case 'gainBlock':
                state.player.block += effect.amount;
                ui.spawnPopup('playerArenaCard', `+${effect.amount} 🛡️`, 'text-cyan-300 font-display font-black text-lg');
                addLog(`✦ ${relic.name}: gained +${effect.amount} Holo Shield.`, 'text-cyan-300');
                fired = true;
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
                dealDamageToEnemy(effect.amount);
                addLog(`✦ ${relic.name}: +${effect.amount} damage to 0-cost Attack.`, 'text-fuchsia-300');
                fired = true;
                break;
              case 'skillGainBlock':
                if (trigger !== 'skillPlayed' || playedCard?.type !== 'SKILL') break;
                state.player.block += effect.amount;
                ui.spawnPopup('playerArenaCard', `+${effect.amount} 🛡️`, 'text-cyan-300 font-display font-black text-lg');
                addLog(`✦ ${relic.name}: +${effect.amount} Holo Shield for playing a Skill.`, 'text-cyan-300');
                fired = true;
                break;
              case 'charmDuration':
                if (trigger !== 'skillPlayed' || playedCard?.type !== 'SKILL') break;
                if ((state.enemy.statuses.charm || 0) > 0) {
                  state.enemy.statuses.charm += effect.amount;
                  addLog(`✦ ${relic.name}: +${effect.amount} Charm duration.`, 'text-purple-300');
                  fired = true;
                }
                break;
              default:
                throw new Error(`Unsupported relic effect type: ${effect.type}`);
            }
          });
          if (capped && fired) state.relicTriggersThisTurn[relicId] = true;
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
        if (devtoolsOpen) {
          mainMenuOpen = false;
          ui?.hideMainMenu();
        }
        if (ui && state && !mainMenuOpen) ui.renderAll();
      }

      function playSoundEffect(play) {
        if (!isSoundEnabled()) return;
        try {
          play();
        } catch (error) {
          setSoundEnabled(false);
          profileStats.settings.soundEnabled = false;
          persistProfileStats();
          optionsUI?.renderSettings();
          console.error('A sound effect failed; sound has been disabled.', error);
          ui.showSaveNotice('A sound effect failed to play and has been disabled. Gameplay can continue normally.');
        }
      }

      // =========================================================================
      // Run flow and event wiring
      // =========================================================================
      function startNewRun(leader, encoreLevel = 0, dailyChallenge = null, modifiers = null) {
        if (!LEADERS.some(({ id }) => id === leader)) {
          throw new Error(`Unknown run leader: ${leader}`);
        }
        if (
          state &&
          ['playing', 'draft'].includes(state.runStatus) &&
          !window.confirm('Starting this tour will replace your active run. Continue?')
        ) return;
        encoreLevel = Number.isInteger(encoreLevel) ? Math.min(5, Math.max(0, encoreLevel)) : 0;
        if (encoreLevel > (profileStats.maxEncoreLevel ?? 0)) return;
        ui.hideRunModals();
        ui.hideMainMenu();
        mainMenuOpen = false;
        const order = dailyChallenge
          ? rollDailyEncounterOrder(dailyChallenge.date)
          : rollEncounterOrder(Math.random);
        ENCOUNTERS = order.map((id) => ENCOUNTERS_BY_ID[id]);
        state = createNewRunState(leader, encoreLevel, dailyChallenge, order, modifiers);
        startStage(0);
        syncPage();
      }

      function startDailyRun() {
        const challenge = getTodayDailyChallenge();
        startNewRun(challenge.leader, 0, challenge);
      }

      function selectLeaderArt(leader, artId) {
        const leaderWins = profileStats.leaderWins[leader];
        if (!Number.isInteger(leaderWins)) throw new Error(`Unknown art leader: ${leader}`);
        if (!getUnlockedArtStyles(leaderWins).some((style) => style.id === artId)) {
          throw new Error(`Art style ${artId} is not unlocked for ${leader}.`);
        }
        profileStats.selectedArts[leader] = artId;
        persistProfileStats();
        if (mainMenuOpen) ui.showMainMenu(state);
        renderAll();
      }

      function upgradeCardFinish(cardId) {
        const level = getCardFinishLevel(profileStats.cardFinishes, cardId);
        const next = getNextFinishLevel(level);
        const card = CARD_DB[cardId];
        if (!next || !card || card.draftable === false) return;
        if ((profileStats.finishTokens ?? 0) < next.cost) return;
        profileStats.finishTokens -= next.cost;
        profileStats.cardFinishes = { ...profileStats.cardFinishes, [cardId]: next.level };
        persistProfileStats();
      }

      function previewCardFinish(cardId) {
        const card = CARD_DB[cardId];
        if (!card) return;
        ui.openPileModal(card.name, [{ instanceId: 0, cardId, upgradeLevel: 0 }]);
      }

      function openNewRunSelection() {
        ui.openLeaderSelection(Boolean(state), state?.leader);
      }

      function showMainMenu() {
        saveRunState();
        ui.hideRunModals();
        mainMenuOpen = true;
        ui.showMainMenu(state);
      }

      function continueTour() {
        if (!state) return;
        buildEncountersFromOrder(state.encounterOrder);
        mainMenuOpen = false;
        ui.hideMainMenu();
        renderAll();
        restoreRunModal();
        syncPage();
      }

      function leaveRewardPhase(message, className = 'text-emerald-300') {
        state.runStatus = 'playing';
        state.draftChoices = [];
        state.relicChoices = [];
        state.routeChoices = [];
        state.rewardMode = null;
        state.tourEventId = null;
        state.shop = null;
        document.getElementById('draftModal').classList.add('hidden');
        document.getElementById('tourRoutingModal').classList.add('hidden');
        ui.closeTourEventModal();
        if (message) addLog(message, className);
        startStage(state.stageIndex + 1);
      }

      function chooseDraftCard(cardId) {
        if (state.runStatus !== 'draft' || !state.draftChoices.includes(cardId)) return;
        const card = CARD_DB[cardId];
        state.masterDeck.push({
          instanceId: state.nextCardInstanceId++,
          cardId,
          upgradeLevel: 0
        });
        const heal = getDraftHealAmount();
        state.player.hp = Math.min(state.player.maxHp, state.player.hp + heal);
        leaveRewardPhase(`✨ Drafted "${card.name}" & restored +${heal} HP!`, 'text-amber-300');
      }

      function chooseRelic(relicId) {
        if (state.runStatus !== 'draft' || !state.relicChoices.includes(relicId)) return;
        const relic = RELIC_DB[relicId];
        if (!relic) return;
        if (relic.leaderId && !state.modifiers?.chaosDraft) {
          throw new Error(`Leader starter relic ${relicId} cannot be selected as a reward.`);
        }
        if (state.relics.includes(relicId)) {
          tourEvents.pruneStaleRelicChoices();
          saveRunState();
          addLog('🎫 Leona rerouted K/DA: that relic was already claimed.', 'text-amber-300');
          if (state.rewardMode === 'relics' && state.relicChoices.length === 0) {
            state.rewardMode = null;
            refreshRoutingModal();
          } else {
            ui.openDraftModal(state.draftChoices, state.relicChoices, state.masterDeck, state.rewardMode);
          }
          return;
        }
        state.relics.push(relicId);
        const heal = getDraftHealAmount();
        state.player.hp = Math.min(state.player.maxHp, state.player.hp + heal);
        leaveRewardPhase(`✦ Equipped ${relic.name} & restored +${heal} HP!`, 'text-amber-300');
      }

      function upgradeCard(instanceId) {
        if (state.runStatus !== 'draft') return;
        const instance = state.masterDeck.find((card) => card.instanceId === instanceId);
        if (!instance || instance.upgradeLevel !== 0 || !CARD_DB[instance.cardId]?.upgrade) return;
        instance.upgradeLevel = 1;
        const activeBuff = state.buffs.find((buff) => buff.instanceId === instanceId);
        if (activeBuff) activeBuff.upgradeLevel = 1;
        leaveRewardPhase(`⬆️ Upgraded "${CARD_DB[instance.cardId].name}" for the rest of the run.`, 'text-amber-300');
      }

      // =========================================================================
      // PvP duel sessions (ephemeral: never saved, never restored)
      // =========================================================================
      function pvpViewModel(hint = '', error = '') {
        if (!pvp) return { screen: 'choice', hint, error };
        return {
          screen: 'lobby',
          role: pvp.role,
          roomCode: pvp.roomCode,
          myLeader: pvp.myLeader,
          peerLeader: pvp.peerLeader,
          peerPresent: pvp.peerPresent,
          peerReady: pvp.peerReady,
          iReady: pvp.iReady,
          flip: pvp.flip,
          hint,
          error
        };
      }

      async function createPvpSession(role, roomCode) {
        const config = await getBoardConfig();
        if (!config) {
          throw new Error('PvP needs the community board backend (Supabase) configured. Check Options → Leaderboard.');
        }
        const playerId = `pvp-${Math.random().toString(36).slice(2, 10)}`;
        const bus = await createSupabasePvpBus({
          roomCode,
          supabase: { url: config.url, publishableKey: config.publishableKey }
        });
        const session = {
          role, roomCode, playerId, bus, room: null,
          myLeader: null, peerLeader: null, peerPresent: false, peerReady: false,
          iReady: false, flip: null, roundIndex: 0, pendingEvents: []
        };
        session.room = createPvpRoom({
          roomCode, playerId, bus,
          onEvent: (event) => handlePvpEvent(session, event)
        });
        return session;
      }

      function handlePvpEvent(session, event) {
        if (session !== pvp) return; // stale session
        if (event.type === 'peers' || event.type === 'opponentReady') {
          const peer = (event.peers || []).find((p) => p.playerId !== session.playerId) ||
            (event.peer && event.peer.playerId !== session.playerId ? event.peer : null);
          session.peerPresent = Boolean(peer);
          session.peerLeader = peer?.leader || null;
          session.peerReady = peer?.ready === true;
          if (session.peerPresent) checkPvpStart(session);
          pvpUI?.setState(pvpViewModel(session.peerPresent ? '' : 'Waiting for rival to join…'));
        } else if (event.type === 'opponentLeft') {
          session.peerPresent = false;
          session.peerLeader = null;
          session.peerReady = false;
          pvpUI?.setState(pvpViewModel('Rival left. Share the code again or leave.'));
        } else if (event.type === 'action' || event.type === 'snapshot' || event.type === 'resync') {
          session.pendingEvents.push(event); // consumed by the duel engine
        }
      }

      function checkPvpStart(session) {
        if (session.flip || !session.iReady || !session.peerReady) return;
        if (!session.myLeader || !session.peerLeader) return;
        session.flip = pvpCoinFlip(session.roomCode, session.roundIndex);
        session.room.start();
        pvpUI?.setState(pvpViewModel('Both ready — the duel engine lands next!'));
      }

      async function hostPvpDuel() {
        try {
          pvpUI?.setState({ screen: 'lobby', role: 'host', roomCode: '…', hint: 'Opening room…' });
          pvp = await createPvpSession('host', generateRoomCode());
          pvp.room.join(null);
          pvpUI?.setState(pvpViewModel('Share the code with your rival.'));
        } catch (error) {
          pvp = null;
          pvpUI?.setError(error?.message || 'Could not open the duel room.');
        }
      }

      async function joinPvpDuel(code) {
        if (!isValidRoomCode(code)) {
          pvpUI?.setError('Enter the 4-letter room code.');
          return;
        }
        try {
          pvpUI?.setState({ screen: 'lobby', role: 'guest', roomCode: code, hint: 'Joining…' });
          pvp = await createPvpSession('guest', code);
          pvp.room.join(null);
          pvpUI?.setState(pvpViewModel('Joined! Pick your leader.'));
        } catch (error) {
          pvp = null;
          pvpUI?.setState({ screen: 'choice', hint: '', error: error?.message || 'Could not join the room.' });
        }
      }

      function pickPvpLeader(leaderId) {
        if (!pvp || !LEADERS.some(({ id }) => id === leaderId)) return;
        pvp.myLeader = leaderId;
        pvp.iReady = false;
        try {
          pvp.room.setReady(false, leaderId);
        } catch { /* presence update is best-effort */ }
        pvpUI?.setState(pvpViewModel(''));
      }

      function readyPvpDuel() {
        if (!pvp || !pvp.myLeader || !pvp.peerPresent || pvp.iReady) return;
        pvp.iReady = true;
        try {
          pvp.room.setReady(true, pvp.myLeader);
        } catch { /* presence update is best-effort */ }
        checkPvpStart(pvp);
        pvpUI?.setState(pvpViewModel(pvp.flip ? '' : 'Waiting for rival to ready up…'));
      }

      function leavePvpDuel() {
        try {
          pvp?.room.close();
        } catch { /* already closed */ }
        pvp = null;
        pvpUI?.hide();
      }

      function openPvpLobby() {
        if (!pvpUI) {
          pvpUI = createPvpUI({
            onHost: hostPvpDuel,
            onJoin: joinPvpDuel,
            onPickLeader: pickPvpLeader,
            onReady: readyPvpDuel,
            onLeave: leavePvpDuel
          });
        }
        if (pvp) {
          try { pvp.room.close(); } catch { /* stale session */ }
          pvp = null;
        }
        pvpUI.show('');
      }

      function wireEvents() {
        document.getElementById('btnEndTurn').addEventListener('click', endPlayerTurn);
        document.getElementById('btnJointAttack').addEventListener('click', triggerJointAttack);
        document.getElementById('btnLeaderAbility').addEventListener('click', useLeaderAbility);
        document.getElementById('btnComboGuide').addEventListener('click', () => {
          const guide = document.getElementById('comboGuide');
          const button = document.getElementById('btnComboGuide');
          const nowHidden = guide.classList.toggle('hidden');
          button.setAttribute('aria-expanded', String(!nowHidden));
        });
        document.getElementById('btnCancelBuffReplace').addEventListener('click', cancelBuffReplacement);
        document.getElementById('buffReplaceChoices').addEventListener('click', (event) => {
          const choice = event.target.closest('[data-buff-replace]');
          if (!choice) return;
          chooseBuffReplacement(Number(choice.dataset.buffReplace));
        });
        document.getElementById('btnNewRun').addEventListener('click', openNewRunSelection);
        document.getElementById('btnMainMenu').addEventListener('click', showMainMenu);
        document.getElementById('btnRestartRunEnd').addEventListener('click', openNewRunSelection);
        document.getElementById('btnStartNewRun').addEventListener('click', () => {
          startNewRun(ui.getSelectedLeader(), ui.getSelectedEncoreLevel(), null, ui.getSelectedModifiers());
        });
        document.getElementById('btnOptions').addEventListener('click', () => optionsUI.showOptions());
        document.getElementById('btnMenuOptions').addEventListener('click', () => optionsUI.showOptions());
        document.getElementById('btnMenuHowToPlay').addEventListener('click', () => optionsUI.showHowToPlay());

        document.getElementById('btnDailyTour').addEventListener('click', startDailyRun);
        document.getElementById('btnPvpDuel').addEventListener('click', openPvpLobby);

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
          if (
            mainMenuOpen || !state || !state.isPlayerTurn ||
            optionsUI?.isListening() ||
            document.querySelector('[role="dialog"]:not(.hidden), [id$="Modal"]:not(.hidden)') ||
            e.altKey || e.ctrlKey || e.metaKey ||
            e.target instanceof HTMLElement && e.target.matches('input, textarea, select, [contenteditable="true"]')
          ) return;

          const action = getActionForKey(e.key, profileStats.settings.keybinds);
          if (!action) return;
          e.preventDefault();
          if (action.startsWith('card')) {
            const slot = Number(action.slice(-1)) - 1;
            if (slot < state.hand.length) playCardAtIndex(slot);
          } else if (action === 'endTurn') {
            endPlayerTurn();
          } else if (action === 'jointFinale') {
            triggerJointAttack();
          } else if (action === 'leaderAbility') {
            useLeaderAbility();
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
          if (state.tourEventId && getTourEvent(state.tourEventId)) {
            const options = tourEvents.getAvailableEventOptions(state.tourEventId);
            if (options.length > 0) {
              ui.openTourEventModal(getTourEvent(state.tourEventId), options, state.masterDeck);
              return;
            }
            state.tourEventId = null;
            saveRunState();
          }
          if (state.rewardMode) {
            ui.openDraftModal(state.draftChoices, state.relicChoices, state.masterDeck, state.rewardMode);
          } else if (Array.isArray(state.routeChoices) && state.routeChoices.length > 0) {
            const freshIds = state.routeChoices.filter((id) => {
              const route = getTourRoute(id);
              return route && isRewardAvailable(route.rewardMode);
            });
            state.routeChoices = freshIds.length > 0 ? freshIds : getAvailableRouteIds();
            if (!state.shop) shop.rollShopInventory();
            saveRunState();
            refreshRoutingModal();
          } else {
            ui.openDraftModal(state.draftChoices, state.relicChoices, state.masterDeck);
          }
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
          ENCOUNTERS_BY_ID = gameData.encountersById;
          ENCOUNTER_POOLS = gameData.encounterPools;
          ALL_ENCOUNTERS = gameData.encounters;
          ENCOUNTERS = rollEncounterOrder(Math.random);
          STARTER_DECKS = gameData.starterDecks;
          MISSION_DEFS = gameData.missions;
          defaultKeybinds = gameData.defaultKeybinds;
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
            getAllEncounters: () => ALL_ENCOUNTERS,
            getCurrentEnemyIntent,
            getMissions: () => MISSION_DEFS,
            onPlayCard: playCardAtIndex,
            onToggleKeep: toggleKeptCard,
            onChooseRoute: chooseTourRoute,
            onChooseEventOption: tourEvents.chooseTourEventOption,
            onRemoveEventCard: tourEvents.removeEventCard,
            onBuyShopCard: shop.buyShopCard,
            onBuyShopRelic: shop.buyShopRelic,
            onBuyShopRemoval: shop.buyShopRemoval,
            onBuyShopHeal: shop.buyShopHeal,
            getCardDamagePreview,
            onJumpToStage: startStage,
            onChooseDraftCard: chooseDraftCard,
            onChooseRelic: chooseRelic,
            onUpgradeCard: upgradeCard,
            onSelectLeaderArt: selectLeaderArt,
            onUpgradeCardFinish: upgradeCardFinish,
            onPreviewCard: previewCardFinish,
            onConsentShare: confirmConsentShare,
            onConsentSkip: skipConsentShare,
            onConsentOptOut: optOutConsentShare,
            onCheckCrowns: maybeCheckCrownsManual,
            onContinueTour: continueTour,
            getDailyChallenge: getTodayDailyChallenge,
            onCopyReceipt: copyRunReceipt
          });
          ui.setChangelog(gameData.changelog);
          GAME_VERSION = gameData.changelog.currentVersion;
          initBugReportLinks(() => {
            const inRun = Boolean(state) &&
              (state.runStatus === 'playing' || state.runStatus === 'draft') &&
              Boolean(state.leader);
            return {
              version: GAME_VERSION,
              leader: inRun ? state.leader : null,
              waveIndex: inRun ? state.stageIndex : null,
              encoreLevel: inRun ? state.encoreLevel : 0,
              userAgent: navigator.userAgent,
              view: window
            };
          });
          wireEvents();

          try {
            profileStats = loadProfileStats(defaultKeybinds);
          } catch (error) {
            if (error instanceof ProfileStorageError) {
              profileStorageAvailable = false;
              console.error('Unable to read player profile stats.', error);
              ui.showSaveNotice('Profile statistics are unavailable in this browser.');
            } else if (error instanceof InvalidProfileStatsError || error instanceof OutdatedProfileStatsError) {
              if (error instanceof InvalidProfileStatsError) {
                console.error('Saved profile stats could not be restored.', error);
              }
              ui.showSaveNotice(error instanceof OutdatedProfileStatsError
                ? 'This update reset profile progress. Start a new World Tour.'
                : 'Saved profile statistics could not be restored and have been reset.');
              profileStats = createDefaultProfileStats(defaultKeybinds);
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
          setSoundEnabled(profileStats.settings.soundEnabled);
          void checkBoardCrowns(true);
          optionsUI = createOptionsUI({
            getSettings: () => profileStats.settings,
            defaultKeybinds,
            getProfileStats: () => profileStats,
            getEncounters: () => ENCOUNTERS,
            getAllEncounters: () => ALL_ENCOUNTERS,
            onSettingsChange: updateProfileSettings,
            isSoundSupported,
            onTestSound: () => playSoundEffect(playSettingsTestSfx),
            changelog: gameData.changelog
          });

          let savedRun = null;
          try {
            savedRun = loadSavedRun();
            if (savedRun !== null && savedRun.version !== RUN_SAVE_VERSION) {
              clearSavedRun();
              savedRun = null;
              ui.showSaveNotice('This update reset saved progress. Choose a leader to start a new World Tour.');
            }
            if (savedRun !== null) {
              if (Array.isArray(savedRun.state?.encounterOrder)) {
                buildEncountersFromOrder(savedRun.state.encounterOrder);
              }
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
            encounters: ENCOUNTERS,
            encounterPools: ENCOUNTER_POOLS
          })) {
            ui.showSaveNotice('The previous saved run could not be restored. Choose a leader to start a new run.');
            savedRun = null;
          }

          if (savedRun) {
            state = savedRun.state;
            if (window.location.hash === '#devtools') {
              mainMenuOpen = false;
              ui.hideMainMenu();
              renderAll();
              restoreRunModal();
              syncPage();
            } else {
              mainMenuOpen = true;
              ui.showMainMenu(state);
            }
          } else {
            if (window.location.hash === '#devtools') {
              mainMenuOpen = false;
              ui.hideMainMenu();
              ui.openLeaderSelection(false, null);
            } else {
              mainMenuOpen = true;
              ui.showMainMenu(null);
            }
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
