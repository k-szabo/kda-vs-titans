import { executeCardEffects, getEffectiveCardCost } from './card-effects.js';
import {
  isSoundEnabled,
  isSoundSupported,
  playCardSfx,
  playJointFinaleSfx,
  playKaijuRoarSfx,
  setSoundEnabled
} from './audio.js';
import { applyPlayerDamage } from './combat-rules.js';
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

      function createNewRunState() {
        let nextCardInstanceId = 1;
        const masterDeck = STARTER_DECK.map((cardId) => ({
          instanceId: nextCardInstanceId++,
          cardId,
          upgradeLevel: 0
        }));
        return {
          stageIndex: 0,
          turn: 1,
          startedAt: Date.now(),
          nextCardInstanceId,
          runStatus: 'playing',
          draftChoices: [],
          relicChoices: [],
          relics: [],
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
          hp: enc.maxHp,
          block: 0,
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

        if (typeof intent.dmg === 'number') {
          let eff = intent.dmg;
          if (e.statuses.charm > 0) {
            eff = Math.floor(eff * 0.75);
          }
          intent.effectiveDmg = eff;
          if (intent.type === 'multi') {
            intent.displayText = `${intent.label.split(':')[0]}: ${eff}x${intent.hits} DMG`;
          } else if (intent.type === 'debuff_atk') {
            intent.displayText = `${intent.label.split(':')[0]}: ${eff} DMG + WEAK`;
          } else {
            intent.displayText = `${intent.label.split(':')[0]}: ${eff} DMG`;
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
        applyRelicEffects('attackPlayed', card);

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
              ui.triggerKaijuHitAnim();
              ui.spawnPopup('enemyArenaCard', `-${remaining}`, 'text-amber-300 font-display font-black text-xl');
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

      function endPlayerTurn() {
        if (!state.isPlayerTurn) return;
        state.isPlayerTurn = false;

        // Discard remaining hand
        while (state.hand.length > 0) {
          state.discardPile.push(state.hand.pop());
        }

        const intent = getCurrentEnemyIntent();
        const e = state.enemy;
        e.block = 0; // Enemy block resets at start of its turn

        addLog(`--- ${e.name} executes ${intent.displayText} ---`, 'text-sky-300 font-bold');

        if (typeof intent.effectiveDmg === 'number') playSoundEffect(playKaijuRoarSfx);
        if (intent.type === 'charge') {
          e.block += intent.block;
          ui.spawnPopup('enemyArenaCard', `+${intent.block} 🛡️`, 'text-sky-300 font-display font-black text-lg');
        } else if (intent.type === 'attack' || intent.type === 'atomic' || intent.type === 'debuff_atk') {
          applyDamageToPlayer(intent.effectiveDmg);
          if (intent.weak) {
            state.player.statuses.weak += intent.weak;
            addLog(`⚠️ K/DA afflicted with ${intent.weak} Weak (-25% Attack DMG)!`, 'text-rose-300');
          }
        } else if (intent.type === 'multi') {
          for (let h = 0; h < intent.hits; h++) {
            applyDamageToPlayer(intent.effectiveDmg);
          }
        }

        // Advance enemy pattern & decrement statuses
        e.patternStep += 1;
        if (e.statuses.charm > 0) e.statuses.charm -= 1;
        if (e.statuses.marked > 0) e.statuses.marked -= 1;
        if (state.player.statuses.weak > 0) state.player.statuses.weak -= 1;

        if (state.player.hp <= 0) {
          state.player.hp = 0;
          state.runStatus = 'defeat';
          renderAll();
          ui.showRunEndModal(false);
          return;
        }

        // Carry remaining Holo Shield forward into the next player turn.
        state.turn += 1;
        state.player.energy = state.player.maxEnergy;
        state.isPlayerTurn = true;
        drawCards(5);
        renderAll();
      }

      function applyDamageToPlayer(rawDmg) {
        const { damageAfterBlock, hpLost, cheerLost } = applyPlayerDamage(state.player, rawDmg);
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

        const draftPool = Object.values(CARD_DB).filter((c) => !c.starter);
        state.runStatus = 'draft';
        state.draftChoices = shuffle(draftPool).slice(0, 3).map((card) => card.id);
        const ownedRelics = new Set(state.relics);
        state.relicChoices = shuffle(Object.keys(RELIC_DB).filter((relicId) => !ownedRelics.has(relicId))).slice(0, 3);
        saveRunState();
        ui.openDraftModal(state.draftChoices, state.relicChoices, state.masterDeck);
      }

      function recordStageClear() {
        profileStats.highestWaveCleared = Math.max(profileStats.highestWaveCleared, state.stageIndex + 1);
        if (!profileStats.unlockedKaiju.includes(state.enemy.id)) {
          profileStats.unlockedKaiju.push(state.enemy.id);
        }
        if (state.stageIndex === ENCOUNTERS.length - 1) {
          const duration = Math.max(0, Date.now() - state.startedAt);
          if (profileStats.fastestWinMs === null || duration < profileStats.fastestWinMs) {
            profileStats.fastestWinMs = duration;
          }
        }
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

      function applyRelicEffects(trigger, playedCard = null) {
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
      function startNewRun() {
        ui.hideRunModals();
        state = createNewRunState();
        startStage(0);
      }

      function chooseDraftCard(cardId) {
        if (state.runStatus !== 'draft' || !state.draftChoices.includes(cardId)) return;
        const card = CARD_DB[cardId];
        state.masterDeck.push({
          instanceId: state.nextCardInstanceId++,
          cardId,
          upgradeLevel: 0
        });
        state.player.hp = Math.min(state.player.maxHp, state.player.hp + 18);
        state.runStatus = 'playing';
        state.draftChoices = [];
        state.relicChoices = [];
        document.getElementById('draftModal').classList.add('hidden');
        addLog(`✨ Drafted "${card.name}" & restored +18 HP!`, 'text-amber-300');
        startStage(state.stageIndex + 1);
      }

      function chooseRelic(relicId) {
        if (state.runStatus !== 'draft' || !state.relicChoices.includes(relicId) || state.relics.includes(relicId)) return;
        const relic = RELIC_DB[relicId];
        state.relics.push(relicId);
        state.player.hp = Math.min(state.player.maxHp, state.player.hp + 18);
        state.runStatus = 'playing';
        state.draftChoices = [];
        state.relicChoices = [];
        document.getElementById('draftModal').classList.add('hidden');
        addLog(`✦ Equipped ${relic.name} & restored +18 HP!`, 'text-amber-300');
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
        document.getElementById('btnNewRun').addEventListener('click', startNewRun);
        document.getElementById('btnRestartRunEnd').addEventListener('click', startNewRun);
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
            getArtAssets: () => ART_ASSETS,
            getCardDatabase: () => CARD_DB,
            getRelicDatabase: () => RELIC_DB,
            getProfileStats: () => profileStats,
            getEncounters: () => ENCOUNTERS,
            getCurrentEnemyIntent,
            onPlayCard: playCardAtIndex,
            onJumpToStage: startStage,
            onChooseDraftCard: chooseDraftCard,
            onChooseRelic: chooseRelic,
            onUpgradeCard: upgradeCard
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
              ui.showSaveNotice('Saved profile statistics were invalid and have been reset.');
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
              ui.showSaveNotice('The previous saved run could not be restored. A new run will start and autosave from here.');
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
            ui.showSaveNotice('The previous saved run is incompatible or damaged. A new run will start and autosave from here.');
            savedRun = null;
          }

          if (savedRun) {
            state = savedRun.state;
            renderAll();
            restoreRunModal();
          } else {
            startNewRun();
          }
        } catch (error) {
          console.error('Unable to load game data and assets.', error);
          const errorElement = document.getElementById('loadError');
          errorElement.textContent = `Unable to load game data. Serve the project with a web server, then reload. ${error.message}`;
          errorElement.classList.remove('hidden');
        }
      }

      initializeGame();
    })();
