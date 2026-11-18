/**
     * K/DA VS. GODZILLA // ENCORE SPIRE
     * Slay the Spire-inspired deckbuilder. Game data and artwork live under assets/.
     */
    (function () {
      'use strict';

      // =========================================================================
      // Art assets and encounter definitions are loaded from JSON files in assets/.
      let ART_ASSETS = null;
      let ENCOUNTERS = [];
      const DATA_MANIFEST_URL = new URL('./assets/data.json', document.baseURI);

      async function loadJson(url) {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Request failed for ${url}: ${response.status} ${response.statusText}`);
        }
        return response.json();
      }

      async function loadGameData() {
        const manifest = await loadJson(DATA_MANIFEST_URL);
        if (!manifest.portraits || !manifest.backdrops || !Array.isArray(manifest.bosses) || manifest.bosses.length === 0) {
          throw new Error('The asset manifest must define portraits, backdrops, and at least one boss file.');
        }

        ART_ASSETS = manifest.portraits;
        ENCOUNTERS = await Promise.all(manifest.bosses.map(async (bossPath) => {
          const bossUrl = new URL(bossPath, DATA_MANIFEST_URL);
          const boss = await loadJson(bossUrl);
          const backdrop = boss.assets && manifest.backdrops[boss.assets.backdrop];
          if (!backdrop || !boss.assets.illustration || !boss.visuals || !boss.visuals.background) {
            throw new Error(`Boss data is missing required assets or visuals: ${bossPath}`);
          }
          return {
            ...boss,
            assets: {
              backdrop: new URL(backdrop, DATA_MANIFEST_URL).href,
              illustration: new URL(boss.assets.illustration, bossUrl).href
            }
          };
        }));
      }

      // 2. K/DA PERFORMANCE CARD DATABASE (STARTER + DRAFT POOL)
      // =========================================================================
      const CARD_DB = {
        // --- STARTER DECK CARDS ---
        foxfire_chord: {
          id: 'foxfire_chord',
          name: 'Foxfire Chord',
          member: 'ahri',
          memberName: 'AHRI',
          type: 'ATTACK',
          cost: 1,
          starter: true,
          desc: 'Deal <b>6</b> damage to the Kaiju.',
          play: (ctx) => {
            const dmg = ctx.calcDmg(6);
            ctx.dealEnemyDmg(dmg);
            ctx.log(`🦊 Ahri fired Foxfire Chord for ${dmg} DMG!`, 'text-pink-300');
          }
        },
        hologram_barrier: {
          id: 'hologram_barrier',
          name: 'Hologram Barrier',
          member: 'kaisa',
          memberName: "KAI'SA",
          type: 'SKILL',
          cost: 1,
          starter: true,
          desc: 'Gain <b>5</b> Holo Shield.',
          play: (ctx) => {
            ctx.gainBlock(5);
            ctx.log(`🦋 Kai'Sa projected +5 Holo Shield.`, 'text-cyan-300');
          }
        },
        smoke_shroud: {
          id: 'smoke_shroud',
          name: 'Neon Smoke Shroud',
          member: 'akali',
          memberName: 'AKALI',
          type: 'SKILL',
          cost: 1,
          starter: true,
          desc: 'Gain <b>4</b> Holo Shield and draw <b>1</b> card.',
          play: (ctx) => {
            ctx.gainBlock(4);
            ctx.draw(1);
            ctx.log(`⚡ Akali dropped Neon Smoke (+4 Shield, +1 Card).`, 'text-cyan-300');
          }
        },
        allure_strike: {
          id: 'allure_strike',
          name: 'Velvet Allure',
          member: 'evelynn',
          memberName: 'EVELYNN',
          type: 'SKILL',
          cost: 1,
          starter: true,
          desc: 'Deal <b>4</b> damage and apply <b>2 Charm</b> (-25% Kaiju DMG).',
          play: (ctx) => {
            const dmg = ctx.calcDmg(4);
            ctx.dealEnemyDmg(dmg);
            ctx.applyEnemyStatus('charm', 2);
            ctx.log(`🕶️ Evelynn struck for ${dmg} DMG & applied 2 Charm!`, 'text-purple-300');
          }
        },

        // --- DRAFTABLE ENCORE CARDS ---
        icathian_rain: {
          id: 'icathian_rain',
          name: 'Icathian Laser Rain',
          member: 'kaisa',
          memberName: "KAI'SA",
          type: 'ATTACK',
          cost: 2,
          starter: false,
          desc: 'Deal <b>4</b> damage <b>3 times</b>.',
          play: (ctx) => {
            let total = 0;
            for (let i = 0; i < 3; i++) {
              const hit = ctx.calcDmg(4);
              ctx.dealEnemyDmg(hit);
              total += hit;
            }
            ctx.log(`🦋 Kai'Sa unleashed Icathian Laser Rain (${total} total DMG)!`, 'text-indigo-300');
          }
        },
        starlight_aria: {
          id: 'starlight_aria',
          name: 'Starlight Aria',
          member: 'ahri',
          memberName: 'AHRI',
          type: 'SKILL',
          cost: 1,
          starter: false,
          desc: 'Restore <b>6 HP</b>, gain <b>4</b> Holo Shield, and <b>+15%</b> Crowd Cheer.',
          play: (ctx) => {
            ctx.healPlayer(6);
            ctx.gainBlock(4);
            ctx.addCheer(15);
            ctx.log(`🦊 Ahri sang Starlight Aria (+6 HP, +4 Shield, +15% Cheer).`, 'text-pink-300');
          }
        },
        perfect_execution: {
          id: 'perfect_execution',
          name: 'Perfect Execution',
          member: 'akali',
          memberName: 'AKALI',
          type: 'ATTACK',
          cost: 2,
          starter: false,
          desc: 'Deal <b>15</b> damage. Apply <b>2 Marked</b> (+50% DMG taken).',
          play: (ctx) => {
            const dmg = ctx.calcDmg(15);
            ctx.dealEnemyDmg(dmg);
            ctx.applyEnemyStatus('marked', 2);
            ctx.log(`⚡ Akali executed a lethal dash for ${dmg} DMG + 2 Marked!`, 'text-cyan-300');
          }
        },
        last_caress: {
          id: 'last_caress',
          name: 'Last Caress',
          member: 'evelynn',
          memberName: 'EVELYNN',
          type: 'ATTACK',
          cost: 1,
          starter: false,
          desc: 'Deal <b>9</b> damage. If Kaiju is Charmed, gain <b>+1 Hype Energy</b>.',
          play: (ctx) => {
            const wasCharmed = state.enemy.statuses.charm > 0;
            const dmg = ctx.calcDmg(9);
            ctx.dealEnemyDmg(dmg);
            if (wasCharmed) {
              state.player.energy += 1;
              ctx.log(`🕶️ Evelynn's Last Caress hit for ${dmg} DMG & refunded +1 Energy!`, 'text-purple-300');
            } else {
              ctx.log(`🕶️ Evelynn's Last Caress hit for ${dmg} DMG!`, 'text-purple-300');
            }
          }
        },
        popstars_encore: {
          id: 'popstars_encore',
          name: 'POP/STARS Drop',
          member: 'squad',
          memberName: 'K/DA SQUAD',
          type: 'POWER',
          cost: 1,
          starter: false,
          exhaust: true,
          desc: 'Gain <b>+3 Encore Power</b> (+3 DMG on all Attacks) & <b>+20%</b> Cheer. <i>Exhaust.</i>',
          play: (ctx) => {
            state.player.statuses.encore += 3;
            ctx.addCheer(20);
            ctx.log(`🌟 K/DA activated POP/STARS Drop (+3 permanent Attack DMG)!`, 'text-amber-300 font-bold');
          }
        },
        firestarter_finale: {
          id: 'firestarter_finale',
          name: 'FIRESTARTER Finale',
          member: 'squad',
          memberName: 'K/DA SQUAD',
          type: 'ATTACK',
          cost: 3,
          starter: false,
          desc: 'Deal <b>24</b> damage and gain <b>12</b> Holo Shield.',
          play: (ctx) => {
            const dmg = ctx.calcDmg(24);
            ctx.dealEnemyDmg(dmg);
            ctx.gainBlock(12);
            ctx.log(`🔥 K/DA detonated FIRESTARTER Finale (${dmg} DMG + 12 Shield)!`, 'text-amber-300 font-bold');
          }
        },
        kunai_flurry: {
          id: 'kunai_flurry',
          name: 'Five-Point Kunai',
          member: 'akali',
          memberName: 'AKALI',
          type: 'ATTACK',
          cost: 0,
          starter: false,
          desc: 'Deal <b>4</b> damage and draw <b>1</b> card.',
          play: (ctx) => {
            const dmg = ctx.calcDmg(4);
            ctx.dealEnemyDmg(dmg);
            ctx.draw(1);
            ctx.log(`⚡ Akali threw Five-Point Kunai (${dmg} DMG + 1 Card).`, 'text-cyan-300');
          }
        },
        crystal_prism_wall: {
          id: 'crystal_prism_wall',
          name: 'Void Prism Bastion',
          member: 'kaisa',
          memberName: "KAI'SA",
          type: 'SKILL',
          cost: 2,
          starter: false,
          desc: 'Gain <b>14</b> Holo Shield and remove player Weak.',
          play: (ctx) => {
            ctx.gainBlock(14);
            state.player.statuses.weak = 0;
            ctx.log(`🦋 Kai'Sa raised Void Prism Bastion (+14 Shield, Cleansed Weak).`, 'text-indigo-300');
          }
        }
      };

      // =========================================================================
      // 3. Boss encounter data is loaded from assets/bosses/*.json.
      // 4. GAME STATE & COMBAT ENGINE
      // =========================================================================
      let state = null;

      function shuffle(arr) {
        const copy = [...arr];
        for (let i = copy.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy;
      }

      function createNewRunState() {
        const starterDeck = [
          'foxfire_chord',
          'foxfire_chord',
          'foxfire_chord',
          'hologram_barrier',
          'hologram_barrier',
          'hologram_barrier',
          'smoke_shroud',
          'smoke_shroud',
          'allure_strike',
          'allure_strike'
        ];

        return {
          stageIndex: 0,
          turn: 1,
          isPlayerTurn: true,
          masterDeck: starterDeck,
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
        card.play(ctx);

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
              triggerKaijuHitAnim();
              spawnPopup('enemyArenaCard', `-${remaining}`, 'text-amber-300 font-display font-black text-xl');
            } else {
              spawnPopup('enemyArenaCard', 'BLOCKED', 'text-cyan-300 font-display font-bold text-sm');
            }
          },
          gainBlock: (amount) => {
            state.player.block += amount;
            spawnPopup('playerArenaCard', `+${amount} 🛡️`, 'text-cyan-300 font-display font-black text-lg');
          },
          healPlayer: (amount) => {
            const actual = Math.min(state.player.maxHp - state.player.hp, amount);
            state.player.hp += actual;
            if (actual > 0) {
              spawnPopup('playerArenaCard', `+${actual} ❤️`, 'text-emerald-300 font-display font-black text-lg');
            }
          },
          applyEnemyStatus: (statusKey, turns) => {
            state.enemy.statuses[statusKey] = (state.enemy.statuses[statusKey] || 0) + turns;
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

        triggerScreenShake();
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
          spawnPopup('enemyArenaCard', `+${intent.block} 🛡️`, 'text-sky-300 font-display font-black text-lg');
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
          renderAll();
          showRunEndModal(false);
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
          triggerScreenShake();
          spawnPopup('playerArenaCard', `-${remaining} HP`, 'text-rose-400 font-display font-black text-xl');
          addLog(`💥 K/DA took ${remaining} damage! (${state.player.hp}/${state.player.maxHp} HP)`, 'text-rose-400');
        } else {
          spawnPopup('playerArenaCard', 'SHIELDED!', 'text-cyan-300 font-display font-bold text-sm');
          addLog(`🛡️ Holo Shield completely absorbed ${rawDmg} damage!`, 'text-cyan-300');
        }
      }

      function handleKaijuDefeated() {
        state.isPlayerTurn = false;
        addLog(`🏆 ${state.enemy.name} CONTAINED!`, 'text-emerald-300 font-bold');

        if (state.stageIndex >= ENCOUNTERS.length - 1) {
          showRunEndModal(true);
          return;
        }

        openDraftModal();
      }

      // =========================================================================
      // 5. POST-BATTLE CARD DRAFT & MODALS
      // =========================================================================
      function openDraftModal() {
        const modal = document.getElementById('draftModal');
        const grid = document.getElementById('draftChoicesGrid');
        grid.innerHTML = '';

        const draftPool = Object.values(CARD_DB).filter((c) => !c.starter);
        const choices = shuffle(draftPool).slice(0, 3);

        choices.forEach((card) => {
          const cardEl = createCardElement(card, true);
          cardEl.addEventListener('click', () => {
            state.masterDeck.push(card.id);
            state.player.hp = Math.min(state.player.maxHp, state.player.hp + 18);
            modal.classList.add('hidden');
            addLog(`✨ Drafted "${card.name}" & restored +18 HP!`, 'text-amber-300');
            startStage(state.stageIndex + 1);
          });
          grid.appendChild(cardEl);
        });

        modal.classList.remove('hidden');
      }

      function showRunEndModal(isVictory) {
        const modal = document.getElementById('runEndModal');
        const badge = document.getElementById('runEndBadge');
        const title = document.getElementById('runEndTitle');
        const desc = document.getElementById('runEndDesc');

        if (isVictory) {
          badge.textContent = 'SETLIST COMPLETE // WORLD TOUR SAVED';
          badge.className = 'inline-block px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 font-display text-[10px] tracking-widest mb-3';
          title.textContent = 'ENCORE VICTORY!';
          desc.textContent = `K/DA defeated Burning Godzilla and completed all ${ENCOUNTERS.length} Kaiju waves with ${state.player.hp}/${state.player.maxHp} HP remaining!`;
        } else {
          badge.textContent = 'STAGE OVERWHELMED';
          badge.className = 'inline-block px-3 py-1 rounded-full bg-rose-500/20 border border-rose-400/40 text-rose-300 font-display text-[10px] tracking-widest mb-3';
          title.textContent = 'STAGE COLLAPSED';
          desc.textContent = `${state.enemy.name} shattered the concert dome on Wave ${state.stageIndex + 1}. Tweak your draft and try another run!`;
        }

        modal.classList.remove('hidden');
      }

      // =========================================================================
      // 6. UI RENDERING & VISUAL FX
      // =========================================================================
      function addLog(text, colorClass = 'text-slate-300') {
        state.logs.unshift({ text, colorClass, turn: state.turn });
        if (state.logs.length > 35) state.logs.pop();
      }

      function triggerScreenShake() {
        const root = document.getElementById('appRoot');
        root.classList.remove('shake-active');
        void root.offsetWidth;
        root.classList.add('shake-active');
      }

      function triggerKaijuHitAnim() {
        const sprite = document.getElementById('kaijuSpriteContainer');
        sprite.classList.remove('kaiju-hit');
        void sprite.offsetWidth;
        sprite.classList.add('kaiju-hit');
      }

      function spawnPopup(containerId, label, extraClasses) {
        const container = document.getElementById(containerId);
        if (!container) return;
        const el = document.createElement('div');
        el.className = `floating-popup ${extraClasses}`;
        el.style.left = `${35 + Math.random() * 30}%`;
        el.style.top = `${30 + Math.random() * 25}%`;
        el.textContent = label;
        container.appendChild(el);
        setTimeout(() => el.remove(), 860);
      }

      function createCardElement(card, isDraftPreview = false, handIndex = -1) {
        const playable = isDraftPreview || (state.isPlayerTurn && state.player.energy >= card.cost);
        const el = document.createElement('div');
        el.className = `spire-card card-${card.member} p-2.5 sm:p-3 flex flex-col justify-between ${
          playable ? 'playable' : 'unplayable'
        }`;

        const badgeColor =
          card.member === 'ahri'
            ? 'text-pink-300 bg-pink-500/20 border-pink-400/40'
            : card.member === 'akali'
            ? 'text-cyan-300 bg-cyan-500/20 border-cyan-400/40'
            : card.member === 'evelynn'
            ? 'text-purple-300 bg-purple-500/20 border-purple-400/40'
            : card.member === 'kaisa'
            ? 'text-indigo-300 bg-indigo-500/20 border-indigo-400/40'
            : 'text-amber-300 bg-amber-500/20 border-amber-400/40';

        const artUrl = ART_ASSETS[card.member] || ART_ASSETS.squad;

        el.innerHTML = `
          <div>
            <div class="flex items-center justify-between gap-1 mb-1.5">
              <span class="px-1.5 py-0.5 rounded border font-display text-[9px] font-bold ${badgeColor}">
                ${card.memberName}
              </span>
              <span class="w-6 h-6 rounded-full bg-amber-400 text-slate-950 font-display text-xs font-black flex items-center justify-center shadow">
                ${card.cost}
              </span>
            </div>
            <div class="w-full h-16 sm:h-20 rounded-lg overflow-hidden mb-1.5 border border-white/10 bg-slate-900">
              <img src="${artUrl}" alt="${card.name}" class="w-full h-full object-cover object-[50%_18%]" />
            </div>
            <div class="font-display text-xs font-black text-white leading-tight mb-1">
              ${card.name}
            </div>
          </div>
          <div>
            <p class="text-[11px] text-slate-300 leading-snug mb-1.5">${card.desc}</p>
            <div class="text-[9px] font-display tracking-widest text-slate-500 uppercase">
              ${card.type}
            </div>
          </div>
        `;

        if (!isDraftPreview && handIndex >= 0) {
          el.addEventListener('click', () => playCardAtIndex(handIndex));
        }
        return el;
      }

      function renderAll() {
        // Turn & Wave Pills (W1 - W8 clickable)
        document.getElementById('turnNumberDisplay').textContent = state.turn;
        const setlistEl = document.getElementById('setlistTracker');
        setlistEl.innerHTML = ENCOUNTERS.map((enc, idx) => {
          const active = idx === state.stageIndex;
          const cleared = idx < state.stageIndex;
          const cls = active
            ? 'bg-pink-500 text-white border-amber-300 shadow-[0_0_10px_rgba(255,42,133,0.6)]'
            : cleared
            ? 'bg-emerald-500/25 text-emerald-300 border-emerald-400/40'
            : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/15';
          return `<button data-jump-wave="${idx}" title="${enc.name}" class="px-2 py-0.5 rounded-lg border font-display text-[10px] font-black transition cursor-pointer ${cls}">W${idx + 1}</button>`;
        }).join('');

        setlistEl.querySelectorAll('[data-jump-wave]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const waveIdx = parseInt(btn.getAttribute('data-jump-wave'), 10);
            startStage(waveIdx);
          });
        });

        // Squad Portraits
        ['ahri', 'akali', 'evelynn', 'kaisa'].forEach((member) => {
          const slot = document.getElementById(`portrait-${member}`);
          if (slot && !slot.dataset.loaded) {
            slot.innerHTML = `<img src="${ART_ASSETS[member]}" alt="${member}" class="w-full h-full object-cover object-[50%_18%]" />`;
            slot.dataset.loaded = 'true';
          }
        });

        // Crowd Cheer Bar & Button
        const cheerPct = Math.min(100, Math.round(state.player.cheer));
        document.getElementById('crowdCheerText').textContent = `${cheerPct}%`;
        document.getElementById('crowdCheerBar').style.width = `${cheerPct}%`;
        const jointBtn = document.getElementById('btnJointAttack');
        if (cheerPct >= 100 && state.isPlayerTurn) {
          jointBtn.disabled = false;
          jointBtn.className =
            'w-full py-1.5 px-3 rounded-xl font-display text-[10px] sm:text-xs font-black tracking-wider transition border border-amber-300 bg-gradient-to-r from-pink-500 via-amber-400 to-cyan-400 text-slate-950 shadow-[0_0_18px_rgba(255,209,102,0.65)] hover:brightness-110 cursor-pointer animate-pulse';
          jointBtn.textContent = '🌟 UNLEASH K/DA JOINT FINALE (FREE!)';
        } else {
          jointBtn.disabled = true;
          jointBtn.className =
            'w-full py-1.5 px-3 rounded-xl font-display text-[10px] sm:text-xs font-black tracking-wider transition border border-white/10 bg-white/5 text-slate-400 cursor-not-allowed';
          jointBtn.textContent = `✨ PLAY CARDS TO CHARGE CROWD CHEER (${cheerPct}%)`;
        }

        // Player Vitals
        const p = state.player;
        document.getElementById('playerHpText').textContent = `${p.hp} / ${p.maxHp}`;
        document.getElementById('playerHpBar').style.width = `${Math.max(0, (p.hp / p.maxHp) * 100)}%`;
        document.getElementById('playerBlockText').textContent = p.block;
        document.getElementById('playerEnergyText').textContent = `${p.energy} / ${p.maxEnergy}`;

        // Player Status Badges
        const pStatusEl = document.getElementById('playerStatusBadges');
        pStatusEl.innerHTML = '';
        if (p.statuses.encore > 0) {
          pStatusEl.innerHTML += `<span class="px-2 py-0.5 rounded-full bg-amber-400/20 border border-amber-400/50 text-amber-200 font-display text-[10px] font-bold">🔥 +${p.statuses.encore} ENCORE</span>`;
        }
        if (p.statuses.weak > 0) {
          pStatusEl.innerHTML += `<span class="px-2 py-0.5 rounded-full bg-rose-500/20 border border-rose-400/50 text-rose-200 font-display text-[10px] font-bold">💫 WEAK (${p.statuses.weak})</span>`;
        }

        // Enemy Header, HP, Block & Intent
        const e = state.enemy;
        const intent = getCurrentEnemyIntent();
        document.getElementById('enemySubtitle').textContent = e.subtitle;
        document.getElementById('enemyName').textContent = e.name;
        document.getElementById('enemyIntentText').textContent = intent.displayText;
        document.getElementById('enemyHpText').textContent = `${e.hp} / ${e.maxHp}`;
        document.getElementById('enemyHpBar').style.width = `${Math.max(0, (e.hp / e.maxHp) * 100)}%`;

        const eBlockBadge = document.getElementById('enemyBlockBadge');
        if (e.block > 0) {
          eBlockBadge.classList.remove('hidden');
          eBlockBadge.textContent = `🛡️ ${e.block} BLOCK`;
        } else {
          eBlockBadge.classList.add('hidden');
        }

        // Enemy Status Badges
        const eStatusEl = document.getElementById('enemyStatusBadges');
        eStatusEl.innerHTML = '';
        if (e.statuses.charm > 0) {
          eStatusEl.innerHTML += `<span class="px-2 py-0.5 rounded-full bg-pink-500/25 border border-pink-400/50 text-pink-200 font-display text-[10px] font-bold">💕 CHARMED (${e.statuses.charm})</span>`;
        }
        if (e.statuses.marked > 0) {
          eStatusEl.innerHTML += `<span class="px-2 py-0.5 rounded-full bg-rose-500/25 border border-rose-400/50 text-rose-200 font-display text-[10px] font-bold">🎯 MARKED (${e.statuses.marked})</span>`;
        }

        // Boss assets and fallback styling are configured with each encounter.
        const spriteContainer = document.getElementById('kaijuSpriteContainer');
        const backdropUrl = e.assets.backdrop;
        const illustrationUrl = e.assets.illustration;
        const fallbackBg = e.visuals.background;

        const borderColor = intent.charged ? 'border-sky-400' : 'border-slate-700';
        const shadowClass = intent.charged ? 'shadow-[0_0_25px_rgba(56,189,248,0.45)]' : 'shadow-lg';

        spriteContainer.className = `relative w-full h-36 sm:h-44 rounded-xl overflow-hidden border-2 transition-all duration-300 ${borderColor} ${shadowClass} ${
          intent.charged ? 'dorsal-charged' : ''
        } flex items-center justify-center p-2`;
        spriteContainer.style.cssText = `background: ${fallbackBg};`;

        spriteContainer.innerHTML = `
          <div class="absolute inset-0 z-0 opacity-45">
            <img src="${backdropUrl}" onerror="this.style.display='none'" class="w-full h-full object-cover object-center" alt="Arena Backdrop" />
          </div>
          <div class="relative z-10 w-full h-full max-w-[230px] max-h-[155px] flex items-center justify-center">
            <img src="${illustrationUrl}" alt="${e.name}" class="w-full h-full object-contain" />
          </div>
        `;

        // Draw / Discard Counts & Hand Cards
        document.getElementById('drawCountText').textContent = state.drawPile.length;
        document.getElementById('discardCountText').textContent = state.discardPile.length;

        const handEl = document.getElementById('handContainer');
        handEl.innerHTML = '';
        state.hand.forEach((cardId, idx) => {
          const card = CARD_DB[cardId];
          if (card) {
            handEl.appendChild(createCardElement(card, false, idx));
          }
        });

        // Battle Log
        const logEl = document.getElementById('combatLog');
        logEl.innerHTML = state.logs
          .map(
            (entry) =>
              `<div class="bg-black/35 rounded-lg px-2 py-1 border border-white/5 leading-snug ${entry.colorClass}">
                <span class="text-[9px] font-display text-slate-500 mr-1">[T${entry.turn}]</span>${entry.text}
              </div>`
          )
          .join('');
      }

      // =========================================================================
      // 7. PILE INSPECTOR & EVENT WIRING
      // =========================================================================
      function openPileModal(title, cardIds) {
        document.getElementById('pileModalTitle').textContent = `${title} (${cardIds.length})`;
        const grid = document.getElementById('pileModalGrid');
        grid.innerHTML = '';
        cardIds.forEach((id) => {
          const card = CARD_DB[id];
          if (card) grid.appendChild(createCardElement(card, true));
        });
        document.getElementById('pileModal').classList.remove('hidden');
      }

      function startNewRun() {
        document.getElementById('runEndModal').classList.add('hidden');
        document.getElementById('draftModal').classList.add('hidden');
        state = createNewRunState();
        startStage(0);
      }

      function wireEvents() {
        document.getElementById('btnEndTurn').addEventListener('click', endPlayerTurn);
        document.getElementById('btnJointAttack').addEventListener('click', triggerJointAttack);
        document.getElementById('btnNewRun').addEventListener('click', startNewRun);
        document.getElementById('btnRestartRunEnd').addEventListener('click', startNewRun);

        document.getElementById('btnSkipDraft').addEventListener('click', () => {
          state.player.hp = Math.min(state.player.maxHp, state.player.hp + 25);
          document.getElementById('draftModal').classList.add('hidden');
          addLog('💖 Skipped draft & rested backstage (+25 HP).', 'text-emerald-300');
          startStage(state.stageIndex + 1);
        });

        document.getElementById('btnViewDraw').addEventListener('click', () => {
          openPileModal('DRAW PILE', state.drawPile);
        });
        document.getElementById('btnViewDiscard').addEventListener('click', () => {
          openPileModal('DISCARD PILE', state.discardPile);
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

      async function initializeGame() {
        try {
          await loadGameData();
          wireEvents();
          startNewRun();
        } catch (error) {
          console.error('Unable to load game data and assets.', error);
          const errorElement = document.getElementById('loadError');
          errorElement.textContent = `Unable to load game data. Serve the project with a web server, then reload. ${error.message}`;
          errorElement.classList.remove('hidden');
        }
      }

      initializeGame();
    })();
