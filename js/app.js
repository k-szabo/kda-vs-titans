import { executeCardEffects } from './card-effects.js';
import { loadGameData } from './game-data.js';
import {
  InvalidSavedRunError,
  loadSavedRun,
  RUN_SAVE_VERSION,
  RunStorageError,
  saveRun
} from './run-storage.js';
import { createGameUI } from './ui.js';

(function () {
  'use strict';

  let ART_ASSETS = null;
  let CARD_DB = {};
  let ENCOUNTERS = [];
  let STARTER_DECK = [];
  let ui = null;
  let state = null;
  let storageAvailable = true;

      function shuffle(arr) {
        const copy = [...arr];
        for (let i = copy.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy;
      }

      function createNewRunState() {
        return {
          stageIndex: 0,
          turn: 1,
          runStatus: 'playing',
          draftChoices: [],
          isPlayerTurn: true,
          masterDeck: [...STARTER_DECK],
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
        const cardId = state.hand[handIdx];
        const card = CARD_DB[cardId];
        if (!card) return;

        if (state.player.energy < card.cost) {
          addLog(`⚠️ Not enough Hype Energy for ${card.name}!`, 'text-amber-300');
          renderAll();
          return;
        }

        // Spend Energy & Charge Crowd Cheer (+8% base + 6% per Energy)
        state.player.energy -= card.cost;
        state.player.cheer = Math.min(100, state.player.cheer + 8 + card.cost * 6);

        // Move card from hand to discard/exhaust
        state.hand.splice(handIdx, 1);
        if (card.exhaust) {
          state.exhaustPile.push(cardId);
        } else {
          state.discardPile.push(cardId);
        }

        // Execute Card Effect
        const ctx = createEffectContext();
        executeCardEffects(card, ctx);

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

        // Start next player turn
        state.turn += 1;
        state.player.block = 0;
        state.player.energy = state.player.maxEnergy;
        state.isPlayerTurn = true;
        drawCards(5);
        renderAll();
      }

      function applyDamageToPlayer(rawDmg) {
        let remaining = rawDmg;
        if (state.player.block > 0) {
          const blocked = Math.min(state.player.block, remaining);
          state.player.block -= blocked;
          remaining -= blocked;
        }
        if (remaining > 0) {
          state.player.hp = Math.max(0, state.player.hp - remaining);
          ui.triggerScreenShake();
          ui.spawnPopup('playerArenaCard', `-${remaining} HP`, 'text-rose-400 font-display font-black text-xl');
          addLog(`💥 K/DA took ${remaining} damage! (${state.player.hp}/${state.player.maxHp} HP)`, 'text-rose-400');
        } else {
          ui.spawnPopup('playerArenaCard', 'SHIELDED!', 'text-cyan-300 font-display font-bold text-sm');
          addLog(`🛡️ Holo Shield completely absorbed ${rawDmg} damage!`, 'text-cyan-300');
        }
      }

      function handleKaijuDefeated() {
        state.isPlayerTurn = false;
        addLog(`🏆 ${state.enemy.name} CONTAINED!`, 'text-emerald-300 font-bold');

        if (state.stageIndex >= ENCOUNTERS.length - 1) {
          state.runStatus = 'victory';
          saveRunState();
          ui.showRunEndModal(true);
          return;
        }

        const draftPool = Object.values(CARD_DB).filter((c) => !c.starter);
        state.runStatus = 'draft';
        state.draftChoices = shuffle(draftPool).slice(0, 3).map((card) => card.id);
        saveRunState();
        ui.openDraftModal(state.draftChoices);
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
        state.masterDeck.push(cardId);
        state.player.hp = Math.min(state.player.maxHp, state.player.hp + 18);
        state.runStatus = 'playing';
        state.draftChoices = [];
        document.getElementById('draftModal').classList.add('hidden');
        addLog(`✨ Drafted "${card.name}" & restored +18 HP!`, 'text-amber-300');
        startStage(state.stageIndex + 1);
      }

      function skipDraft() {
        if (state.runStatus !== 'draft') return;
        state.player.hp = Math.min(state.player.maxHp, state.player.hp + 25);
        state.runStatus = 'playing';
        state.draftChoices = [];
        document.getElementById('draftModal').classList.add('hidden');
        addLog('💖 Skipped draft & rested backstage (+25 HP).', 'text-emerald-300');
        startStage(state.stageIndex + 1);
      }

      function wireEvents() {
        document.getElementById('btnEndTurn').addEventListener('click', endPlayerTurn);
        document.getElementById('btnJointAttack').addEventListener('click', triggerJointAttack);
        document.getElementById('btnNewRun').addEventListener('click', startNewRun);
        document.getElementById('btnRestartRunEnd').addEventListener('click', startNewRun);

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

      function isValidSavedRun(savedRun) {
        if (!savedRun || savedRun.version !== RUN_SAVE_VERSION || !savedRun.state) return false;
        const saved = savedRun.state;
        const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
        const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
        const cardPiles = [
          saved.masterDeck,
          saved.drawPile,
          saved.hand,
          saved.discardPile,
          saved.exhaustPile,
          saved.draftChoices
        ];
        if (!cardPiles.every(Array.isArray)) return false;
        const cardIds = [
          ...saved.masterDeck,
          ...saved.drawPile,
          ...saved.hand,
          ...saved.discardPile,
          ...saved.exhaustPile,
          ...saved.draftChoices
        ];

        if (
          !Number.isInteger(saved.stageIndex) ||
          saved.stageIndex < 0 ||
          saved.stageIndex >= ENCOUNTERS.length ||
          !Number.isInteger(saved.turn) ||
          saved.turn < 1 ||
          !['playing', 'draft', 'victory', 'defeat'].includes(saved.runStatus) ||
          typeof saved.isPlayerTurn !== 'boolean' ||
          !Array.isArray(saved.logs) ||
          cardIds.some((cardId) => !CARD_DB[cardId]) ||
          !isRecord(saved.player) ||
          !isRecord(saved.player.statuses) ||
          !isRecord(saved.enemy) ||
          !isRecord(saved.enemy.statuses) ||
          !Array.isArray(saved.enemy.patterns) ||
          saved.enemy.patterns.length === 0 ||
          !isRecord(saved.enemy.assets) ||
          !isRecord(saved.enemy.visuals) ||
          typeof saved.enemy.assets.backdrop !== 'string' ||
          typeof saved.enemy.assets.illustration !== 'string' ||
          typeof saved.enemy.visuals.background !== 'string' ||
          !['hp', 'maxHp', 'block', 'energy', 'maxEnergy', 'cheer'].every((key) => isFiniteNumber(saved.player[key])) ||
          !['encore', 'weak'].every((key) => isFiniteNumber(saved.player.statuses[key])) ||
          !['hp', 'maxHp', 'block', 'patternStep'].every((key) => isFiniteNumber(saved.enemy[key])) ||
          !['charm', 'marked'].every((key) => isFiniteNumber(saved.enemy.statuses[key])) ||
          !saved.logs.every((entry) => isRecord(entry) && typeof entry.text === 'string' && typeof entry.colorClass === 'string' && Number.isInteger(entry.turn))
        ) {
          return false;
        }

        if (saved.enemy.id !== ENCOUNTERS[saved.stageIndex].id) return false;
        if (
          saved.player.maxHp <= 0 ||
          saved.player.hp < 0 ||
          saved.player.hp > saved.player.maxHp ||
          saved.enemy.maxHp <= 0 ||
          saved.enemy.hp < 0 ||
          saved.enemy.hp > saved.enemy.maxHp
        ) {
          return false;
        }
        if (saved.runStatus === 'draft') {
          return !saved.isPlayerTurn && saved.draftChoices.length > 0 && saved.enemy.hp === 0;
        }
        if (saved.runStatus === 'victory') {
          return !saved.isPlayerTurn && saved.stageIndex === ENCOUNTERS.length - 1;
        }
        if (saved.runStatus === 'defeat') return !saved.isPlayerTurn && saved.player.hp === 0;
        return saved.isPlayerTurn && saved.enemy.hp > 0 && saved.player.hp > 0;
      }

      function restoreRunModal() {
        if (state.runStatus === 'draft') {
          ui.openDraftModal(state.draftChoices);
        } else if (state.runStatus === 'victory' || state.runStatus === 'defeat') {
          ui.showRunEndModal(state.runStatus === 'victory');
        }
      }

      async function initializeGame() {
        try {
          const gameData = await loadGameData();
          ART_ASSETS = gameData.artAssets;
          CARD_DB = gameData.cardDatabase;
          ENCOUNTERS = gameData.encounters;
          STARTER_DECK = gameData.starterDeck;
          ui = createGameUI({
            getState: () => state,
            getArtAssets: () => ART_ASSETS,
            getCardDatabase: () => CARD_DB,
            getEncounters: () => ENCOUNTERS,
            getCurrentEnemyIntent,
            onPlayCard: playCardAtIndex,
            onJumpToStage: startStage,
            onChooseDraftCard: chooseDraftCard
          });
          wireEvents();

          let savedRun = null;
          try {
            savedRun = loadSavedRun();
          } catch (error) {
            if (error instanceof RunStorageError) {
              storageAvailable = false;
              console.error('Unable to read the saved run.', error);
              ui.showSaveNotice('Browser storage is unavailable. This run cannot be saved between visits.');
            } else if (error instanceof InvalidSavedRunError) {
              console.error('The saved run could not be restored.', error);
              ui.showSaveNotice('The previous saved run could not be restored. A new run will start and autosave from here.');
            } else {
              throw error;
            }
          }

          if (savedRun !== null && !isValidSavedRun(savedRun)) {
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
