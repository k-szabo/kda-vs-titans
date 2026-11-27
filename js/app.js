import {
  isSoundEnabled,
  isSoundSupported,
  playSettingsTestSfx,
  setSoundEnabled
} from './audio.js';
import {
  createTurnMemberState,
  getDeathLogEntries,
  getEncoreBossMaxHp,
  getWaveStrengthBonus,
  MAX_HAND_SIZE
} from './combat-rules.js';
import { createCombatEngine } from './combat-engine.js';
import { loadGameData } from './game-data.js';
import { createDailyChallenge, getDailyAttemptStatus, nextSeededRandom } from './daily-challenge.js';
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
import { createPvpDuel } from './pvp-duel.js';
import { buildScorePayload, checkCrowns, computeDailyScore, getMostPlayedCard, submitDailyScore as submitLeaderboardScore } from './leaderboard.js';

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
  let pvpDuel = null; // PvP duel controller (ephemeral, never saved)
  let combat = null; // turn-based combat engine (stateless w.r.t. run state)

  function getPvpDuel() {
    if (!pvpDuel) {
      pvpDuel = createPvpDuel({
        getState: () => state,
        setState: (next) => { state = next; },
        setMainMenuOpen: (open) => { mainMenuOpen = open; },
        getCardDB: () => CARD_DB,
        getRelicDB: () => RELIC_DB,
        getStarterDecks: () => STARTER_DECKS,
        getArtAssets: () => ART_ASSETS,
        takeEndlessBoss,
        beginStage: (stageIdx) => startStage(stageIdx),
        shuffle,
        nextRandom,
        applyDamageToPlayer: (rawDmg, pierce) => combat.applyDamageToPlayer(rawDmg, pierce),
        discardBuffEntry,
        getBuffAmount,
        tickBuffsAtTurnStart: () => combat.tickBuffsAtTurnStart(),
        drawCards,
        applyRelicEffects,
        uiHideMainMenu: () => ui.hideMainMenu(),
        uiHideRunModals: () => ui.hideRunModals(),
        addLog,
        renderAll
      });
    }
    return pvpDuel;
  }

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
          cardsPlayedThisTurn: 0,
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
        let enc = ENCOUNTERS[stageIdx];
        if (!enc && state && state.endless) {
          // Self-heal for saves stranded mid-transition: draft the missing
          // boss on the spot instead of stranding the tour.
          pushEndlessBoss();
          enc = ENCOUNTERS[stageIdx];
        }
        if (!enc) {
          addLog('⚠️ Missing encounter data — the tour cannot continue past this wave.', 'text-rose-300 font-bold');
          return;
        }
        const encoreMaxHp = getEncoreBossMaxHp(enc.maxHp, state.encoreLevel);
        const waveMaxHp = Math.ceil(encoreMaxHp * (1 + 0.03 * stageIdx));
        const bossMaxHp = state.dailyChallenge?.modifier === 'encore_pressure'
          ? Math.ceil(waveMaxHp * 1.15)
          : waveMaxHp;

        state.stageIndex = stageIdx;
        state.turn = 1;
        state.damageDealtThisTurn = 0;
        state.skillsPlayedThisTurn = 0;
        state.cardsPlayedThisTurn = 0;
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
          strength: (enc.strength || 0) + getWaveStrengthBonus(stageIdx, state.encoreLevel),
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

      function toggleKeptCard(instanceId) {
        if (!state.isPlayerTurn) return;
        if (!Number.isInteger(instanceId)) return;
        if (!state.hand.some((cardInstance) => cardInstance.instanceId === instanceId)) return;
        state.keptCardInstanceId = state.keptCardInstanceId === instanceId ? null : instanceId;
        renderAll();
      }

      // Trigger K/DA 4-Member Joint Finale when Crowd Cheer hits 100%
      // Endless tours draft the next boss from the cycling pools. Called when
      // entering every endless draft phase (and by startStage as a self-heal
      // for saves stranded mid-transition), so the setlist never runs dry.
      function takeEndlessBoss(nextIndex) {
        if (!Array.isArray(ENCOUNTER_POOLS) || ENCOUNTER_POOLS.length === 0) return null;
        const pool = ENCOUNTER_POOLS[nextIndex % ENCOUNTER_POOLS.length];
        if (!Array.isArray(pool) || pool.length === 0) return null;
        const id = pool[Math.floor(nextRandom() * pool.length) % pool.length];
        const encounter = ENCOUNTERS_BY_ID[id];
        if (!encounter) return null;
        ENCOUNTERS.push(encounter);
        return { id };
      }

      function pushEndlessBoss() {
        if (!state || !state.endless) return false;
        const taken = takeEndlessBoss(state.stageIndex + 1);
        if (!taken) return false;
        state.encounterOrder.push(taken.id);
        return true;
      }

      function keepTouring() {
        if (!state || state.runStatus !== 'victory' || state.dailyChallenge) return;
        state.endless = true;
        if (!pushEndlessBoss()) return;
        const nextIndex = state.stageIndex + 1;
        state.runStatus = 'playing';
        ui.hideRunModals();
        addLog(`🔁 ENDLESS TOUR: wave ${nextIndex + 1} approaches…`, 'text-amber-300 font-bold');
        startStage(nextIndex);
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
        try {
          recordDailyResult(false);
          recordRunHistory(false);
          evaluateMissions();
          renderAll();
        } finally {
          // The defeat screen must appear even if a bookkeeping step above throws.
          ui.showRunEndModal(false);
        }
        handleDailyRunEnd();
        return true;
      }

      function handleKaijuDefeated() {
        state.isPlayerTurn = false;
        addLog(`🏆 ${state.enemy.name} CONTAINED!`, 'text-emerald-300 font-bold');
        recordStageClear();

        if (state.stageIndex >= ENCOUNTERS.length - 1 && !state.endless) {
          state.runStatus = 'victory';
          recordDailyResult(true);
          recordRunHistory(true);
          evaluateMissions();
          saveRunState();
          ui.showRunEndModal(true, { endless: !state.dailyChallenge });
          handleDailyRunEnd();
          return;
        }

        const chaos = state.modifiers?.chaosDraft === true;
        const draftPool = Object.values(CARD_DB).filter((c) => (chaos || !c.starter) && c.draftable !== false);
        state.runStatus = 'draft';
        // Endless tours draft the next boss up front so the reward phase can
        // never strand the run on a missing encounter.
        if (state.endless) pushEndlessBoss();
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
        nextRandom,
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

      function recordRunHistory(won) {
        if (!state || state.runStatus === 'pvp') return;
        const entry = {
          date: getUtcDateString(),
          mode: state.dailyChallenge ? 'daily' : 'standard',
          leader: state.leader,
          encore: state.encoreLevel,
          victory: won === true,
          waves: state.wavesCleared,
          durationMs: Math.max(0, Date.now() - (state.startedAt || Date.now())),
          receipt: getRunReceiptText()
        };
        const history = Array.isArray(profileStats.runHistory) ? profileStats.runHistory : [];
        profileStats.runHistory = [entry, ...history].slice(0, 10);
        persistProfileStats();
      }

      function recordDailyResult(won) {
        if (!state.dailyChallenge) return;
        const date = state.dailyChallenge.date;
        // One attempt per day: every finished daily run consumes it, except a
        // wave-0 defeat which grants exactly one retry (claimed at restart).
        profileStats.dailyLock = {
          date,
          finishes: (profileStats.dailyLock?.date === date ? profileStats.dailyLock.finishes ?? 0 : 0) + 1,
          lastWaves: state.wavesCleared || 0,
          lastVictory: won === true,
          w0RetriesUsed: profileStats.dailyLock?.date === date && profileStats.dailyLock.w0RetriesUsed === 1 ? 1 : 0
        };
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
        if (state.dailyChallenge) {
          const seconds = Math.max(1, Math.round((Date.now() - state.startedAt) / 1000));
          const parts = computeDailyScore({
            wavesCleared: state.wavesCleared,
            victory: state.runStatus === 'victory',
            peakSingleTurnDamage: state.peakSingleTurnDamage,
            seconds
          });
          lines.push(`Daily Score: ${parts.score} (waves ${parts.wavePts} + win ${parts.victoryPts} + peak ${parts.peakPts} + speed ${parts.speedPts})`);
        }
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
          if (state.runStatus === 'defeat') {
            // Don't cover the defeat screen with the consent modal: remember
            // the pending share and submit it once a board name is set.
            pendingDailySubmit = true;
            ui.showShareStatus('Daily score not shared yet — set a board name in Options to share it.');
            return;
          }
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

      let pendingDailySubmit = false;

      function updateBoardName(name) {
        profileStats.playerName = name;
        persistProfileStats();
        if (pendingDailySubmit && state?.dailyChallenge && state.runStatus === 'defeat') {
          pendingDailySubmit = false;
          void submitDailyScore();
        }
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
                combat.dealDamageToEnemy(effect.amount);
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
        pendingDailySubmit = false;
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
        // An unfinished daily tour resumes instead of restarting: replacing
        // it would dodge the one-attempt lock.
        if (
          state && ['playing', 'draft'].includes(state.runStatus) &&
          state.dailyChallenge?.date === challenge.date
        ) {
          continueTour();
          return;
        }
        const status = getDailyAttemptStatus(profileStats, challenge.date);
        if (status === 'locked') {
          ui.showSaveNotice('Daily tour already played today — come back tomorrow.');
          showMainMenu();
          return;
        }
        if (status === 'retry') {
          profileStats.dailyLock = { ...profileStats.dailyLock, w0RetriesUsed: 1 };
          persistProfileStats();
          addLog('💔 W0 wipe forgiven: one retry granted.', 'text-amber-300');
        }
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

      function wireEvents() {
        document.getElementById('btnEndTurn').addEventListener('click', () => combat.endPlayerTurn());
        document.getElementById('btnJointAttack').addEventListener('click', () => combat.triggerJointAttack());
        document.getElementById('btnLeaderAbility').addEventListener('click', () => combat.useLeaderAbility());
        document.getElementById('btnComboGuide').addEventListener('click', () => {
          const guide = document.getElementById('comboGuide');
          const button = document.getElementById('btnComboGuide');
          const nowHidden = guide.classList.toggle('hidden');
          button.setAttribute('aria-expanded', String(!nowHidden));
        });
        document.getElementById('btnCancelBuffReplace').addEventListener('click', () => combat.cancelBuffReplacement());
        document.getElementById('buffReplaceChoices').addEventListener('click', (event) => {
          const choice = event.target.closest('[data-buff-replace]');
          if (!choice) return;
          combat.chooseBuffReplacement(Number(choice.dataset.buffReplace));
        });
        document.getElementById('btnNewRun').addEventListener('click', openNewRunSelection);
        document.getElementById('btnMainMenu').addEventListener('click', () => {
          if (state && state.runStatus === 'pvp') getPvpDuel().leave(); // forfeit, rival wins by disconnect
          showMainMenu();
        });
        document.getElementById('btnRestartRunEnd').addEventListener('click', openNewRunSelection);
        document.getElementById('btnStartNewRun').addEventListener('click', () => {
          startNewRun(ui.getSelectedLeader(), ui.getSelectedEncoreLevel(), null, ui.getSelectedModifiers());
        });
        document.getElementById('btnOptions').addEventListener('click', () => optionsUI.showOptions());
        document.getElementById('btnMenuOptions').addEventListener('click', () => optionsUI.showOptions());
        document.getElementById('btnMenuHowToPlay').addEventListener('click', () => optionsUI.showHowToPlay());

        document.getElementById('btnDailyTour').addEventListener('click', startDailyRun);
        document.getElementById('btnPvpDuel').addEventListener('click', () => getPvpDuel().openLobby());

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
            if (slot < state.hand.length) combat.playCardAtIndex(slot);
          } else if (action === 'endTurn') {
            combat.endPlayerTurn();
          } else if (action === 'jointFinale') {
            combat.triggerJointAttack();
          } else if (action === 'leaderAbility') {
            combat.useLeaderAbility();
          }
        });
      }

      function saveRunState() {
        if (!state || !storageAvailable) return;
        if (state.runStatus === 'pvp') return; // duels are ephemeral, never saved
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
          combat = createCombatEngine({
            getState: () => state,
            getCardDB: () => CARD_DB,
            applyRelicEffects: (trigger, card, cost) => applyRelicEffects(trigger, card, cost),
            drawCards: (count) => drawCards(count),
            getBuffAmount,
            discardBuffEntry,
            onEnemyDefeated: () => handleKaijuDefeated(),
            onPlayerDefeat: () => finishPlayerDefeat(),
            getPvp: () => pvpDuel,
            showVoiceLine: (speaker, text) => ui.showVoiceLine(speaker, text),
            popup: (target, text, cls) => ui.spawnPopup(target, text, cls),
            shake: () => ui.triggerScreenShake(),
            kaijuHit: () => ui.triggerKaijuHitAnim(),
            openBuffReplaceModal: (buffs) => ui.openBuffReplaceModal(buffs),
            closeBuffReplaceModal: () => ui.closeBuffReplaceModal(),
            addLog,
            renderAll
          });
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
            getCurrentEnemyIntent: () => combat.getCurrentEnemyIntent(),
            getMissions: () => MISSION_DEFS,
            onPlayCard: (idx) => combat.playCardAtIndex(idx),
            onToggleKeep: toggleKeptCard,
            onChooseRoute: chooseTourRoute,
            onChooseEventOption: tourEvents.chooseTourEventOption,
            onRemoveEventCard: tourEvents.removeEventCard,
            onBuyShopCard: shop.buyShopCard,
            onBuyShopRelic: shop.buyShopRelic,
            onBuyShopRemoval: shop.buyShopRemoval,
            onBuyShopHeal: shop.buyShopHeal,
            onPullSlots: shop.pullSlots,
            getCardDamagePreview: (instance) => combat.getCardDamagePreview(instance),
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
            onKeepTouring: keepTouring,
            getDailyChallenge: getTodayDailyChallenge,
            getGameVersion: () => GAME_VERSION,
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
            onPlayerNameChange: updateBoardName,
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
