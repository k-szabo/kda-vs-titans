import { getEffectiveCardCost } from './card-effects.js';

export function createGameUI({
  getState,
  getArtAssets,
  getCardDatabase,
  getRelicDatabase,
  getProfileStats,
  getEncounters,
  getCurrentEnemyIntent,
  onPlayCard,
  onJumpToStage,
  onChooseDraftCard,
  onChooseRelic,
  onUpgradeCard
}) {
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

  function createCardElement(card, isDraftPreview = false, handIndex = -1, cardInstance = null, previewUpgrade = false) {
    const state = getState();
    const upgradeLevel = previewUpgrade ? 1 : (cardInstance?.upgradeLevel || 0);
    const cost = getEffectiveCardCost(card, upgradeLevel);
    const playable = isDraftPreview || (state.isPlayerTurn && state.player.energy >= cost);
    const el = document.createElement('div');
    el.className = `spire-card card-${card.member} p-2.5 sm:p-3 flex flex-col justify-between ${
      playable ? 'playable' : 'unplayable'
    }${upgradeLevel > 0 ? ' card-upgraded' : ''}`;

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

    const artAssets = getArtAssets();
    const artUrl = artAssets[card.member] || artAssets.squad;

    el.innerHTML = `
      <div>
        <div class="flex items-center justify-between gap-1 mb-1.5">
          <span class="px-1.5 py-0.5 rounded border font-display text-[9px] font-bold ${badgeColor}">
            ${card.memberName}
          </span>
          <span class="w-6 h-6 rounded-full bg-amber-400 text-slate-950 font-display text-xs font-black flex items-center justify-center shadow">
            ${cost}
          </span>
        </div>
        <div class="w-full h-16 sm:h-20 rounded-lg overflow-hidden mb-1.5 border border-white/10 bg-slate-900">
          <img src="${artUrl}" alt="${card.name}" class="w-full h-full object-cover object-[50%_18%]" />
        </div>
        <div class="font-display text-xs font-black text-white leading-tight mb-1">
          ${card.name}${upgradeLevel > 0 ? ' +' : ''}
        </div>
      </div>
      <div>
        <p class="text-[11px] text-slate-300 leading-snug mb-1.5">${upgradeLevel > 0 ? card.upgrade.description : card.desc}</p>
        <div class="text-[9px] font-display tracking-widest text-slate-500 uppercase">
          ${card.type}
        </div>
      </div>
    `;

    if (!isDraftPreview && handIndex >= 0) {
      el.addEventListener('click', () => onPlayCard(handIndex));
    }
    return el;
  }

  function setRewardTab(mode) {
    document.querySelectorAll('[data-reward-panel]').forEach((panel) => {
      panel.classList.toggle('hidden', panel.dataset.rewardPanel !== mode);
    });
    document.querySelectorAll('[data-reward-tab]').forEach((tab) => {
      const active = tab.dataset.rewardTab === mode;
      tab.classList.toggle('border-amber-300/50', active);
      tab.classList.toggle('bg-amber-400/15', active);
      tab.classList.toggle('text-amber-200', active);
      tab.classList.toggle('border-white/15', !active);
      tab.classList.toggle('bg-white/5', !active);
      tab.classList.toggle('text-slate-300', !active);
    });
  }

  function renderAll() {
    const state = getState();
    const encounters = getEncounters();
    const cardDatabase = getCardDatabase();
    const relicDatabase = getRelicDatabase();

    document.getElementById('turnNumberDisplay').textContent = state.turn;
    const setlistEl = document.getElementById('setlistTracker');
    setlistEl.innerHTML = encounters.map((enc, idx) => {
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
        onJumpToStage(waveIdx);
      });
    });

    ['ahri', 'akali', 'evelynn', 'kaisa'].forEach((member) => {
      const slot = document.getElementById(`portrait-${member}`);
      const artAssets = getArtAssets();
      if (slot && !slot.dataset.loaded) {
        slot.innerHTML = `<img src="${artAssets[member]}" alt="${member}" class="w-full h-full object-cover object-[50%_18%]" />`;
        slot.dataset.loaded = 'true';
      }
    });

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

    const p = state.player;
    document.getElementById('playerHpText').textContent = `${p.hp} / ${p.maxHp}`;
    document.getElementById('playerHpBar').style.width = `${Math.max(0, (p.hp / p.maxHp) * 100)}%`;
    document.getElementById('playerBlockText').textContent = p.block;
    document.getElementById('playerEnergyText').textContent = `${p.energy} / ${p.maxEnergy}`;

    const relicBar = document.getElementById('relicBar');
    relicBar.innerHTML = '';
    state.relics.forEach((relicId) => {
      const relic = relicDatabase[relicId];
      if (!relic) throw new Error(`Unknown owned relic: ${relicId}`);
      const badge = document.createElement('span');
      badge.className = 'rounded-full bg-amber-400/15 border border-amber-300/35 px-2 py-1 font-display text-[9px] font-bold text-amber-200';
      badge.title = relic.description;
      badge.textContent = `✦ ${relic.name}`;
      relicBar.appendChild(badge);
    });

    const pStatusEl = document.getElementById('playerStatusBadges');
    pStatusEl.innerHTML = '';
    if (p.statuses.encore > 0) {
      pStatusEl.innerHTML += `<span class="px-2 py-0.5 rounded-full bg-amber-400/20 border border-amber-400/50 text-amber-200 font-display text-[10px] font-bold">🔥 +${p.statuses.encore} ENCORE</span>`;
    }
    if (p.statuses.weak > 0) {
      pStatusEl.innerHTML += `<span class="px-2 py-0.5 rounded-full bg-rose-500/20 border border-rose-400/50 text-rose-200 font-display text-[10px] font-bold">💫 WEAK (${p.statuses.weak})</span>`;
    }

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

    const eStatusEl = document.getElementById('enemyStatusBadges');
    eStatusEl.innerHTML = '';
    if (e.statuses.charm > 0) {
      eStatusEl.innerHTML += `<span class="px-2 py-0.5 rounded-full bg-pink-500/25 border border-pink-400/50 text-pink-200 font-display text-[10px] font-bold">💕 CHARMED (${e.statuses.charm})</span>`;
    }
    if (e.statuses.marked > 0) {
      eStatusEl.innerHTML += `<span class="px-2 py-0.5 rounded-full bg-rose-500/25 border border-rose-400/50 text-rose-200 font-display text-[10px] font-bold">🎯 MARKED (${e.statuses.marked})</span>`;
    }

    const spriteContainer = document.getElementById('kaijuSpriteContainer');
    const borderColor = intent.charged ? 'border-sky-400' : 'border-slate-700';
    const shadowClass = intent.charged ? 'shadow-[0_0_25px_rgba(56,189,248,0.45)]' : 'shadow-lg';

    spriteContainer.className = `relative w-full h-36 sm:h-44 rounded-xl overflow-hidden border-2 transition-all duration-300 ${borderColor} ${shadowClass} ${
      intent.charged ? 'dorsal-charged' : ''
    } flex items-center justify-center p-2`;
    spriteContainer.style.cssText = `background: ${e.visuals.background};`;
    spriteContainer.innerHTML = `
      <div class="absolute inset-0 z-0 opacity-45">
        <img src="${e.assets.backdrop}" onerror="this.style.display='none'" class="w-full h-full object-cover object-center" alt="Arena Backdrop" />
      </div>
      <div class="relative z-10 w-full h-full max-w-[230px] max-h-[155px] flex items-center justify-center">
        <img src="${e.assets.illustration}" alt="${e.name}" class="w-full h-full object-contain" />
      </div>
    `;

    document.getElementById('drawCountText').textContent = state.drawPile.length;
    document.getElementById('discardCountText').textContent = state.discardPile.length;
    const handEl = document.getElementById('handContainer');
    handEl.innerHTML = '';
    state.hand.forEach((cardInstance, idx) => {
      const card = cardDatabase[cardInstance.cardId];
      if (card) handEl.appendChild(createCardElement(card, false, idx, cardInstance));
    });

    document.getElementById('combatLog').innerHTML = state.logs
      .map((entry) => `<div class="bg-black/35 rounded-lg px-2 py-1 border border-white/5 leading-snug ${entry.colorClass}">
        <span class="text-[9px] font-display text-slate-500 mr-1">[T${entry.turn}]</span>${entry.text}
      </div>`)
      .join('');
  }

  function openDraftModal(cardIds, relicIds, masterDeck) {
    const modal = document.getElementById('draftModal');
    const cardGrid = document.getElementById('draftChoicesGrid');
    const relicGrid = document.getElementById('relicChoicesGrid');
    const upgradeGrid = document.getElementById('upgradeChoicesGrid');
    const cardDatabase = getCardDatabase();
    const relicDatabase = getRelicDatabase();
    cardGrid.innerHTML = '';
    relicGrid.innerHTML = '';
    upgradeGrid.innerHTML = '';

    cardIds.forEach((cardId) => {
      const card = cardDatabase[cardId];
      if (!card) throw new Error(`Unknown draft card: ${cardId}`);
      const cardEl = createCardElement(card, true, -1, { upgradeLevel: 0 });
      cardEl.addEventListener('click', () => onChooseDraftCard(card.id));
      cardGrid.appendChild(cardEl);
    });

    relicIds.forEach((relicId) => {
      const relic = relicDatabase[relicId];
      if (!relic) throw new Error(`Unknown relic reward: ${relicId}`);
      const choice = document.createElement('button');
      choice.type = 'button';
      choice.className = 'rounded-2xl border border-amber-300/40 bg-gradient-to-br from-amber-400/15 to-slate-950/80 p-5 text-left transition hover:border-amber-200 hover:bg-amber-400/20';
      const name = document.createElement('span');
      name.className = 'block font-display text-sm font-black text-amber-200 mb-2';
      name.textContent = `✦ ${relic.name}`;
      const description = document.createElement('span');
      description.className = 'block text-xs leading-relaxed text-slate-300';
      description.textContent = relic.description;
      choice.append(name, description);
      choice.addEventListener('click', () => onChooseRelic(relic.id));
      relicGrid.appendChild(choice);
    });

    const seenCardTypes = new Set();
    const upgradeableCards = masterDeck.filter((instance) => {
      const card = cardDatabase[instance.cardId];
      if (instance.upgradeLevel !== 0 || !card?.upgrade || seenCardTypes.has(instance.cardId)) return false;
      seenCardTypes.add(instance.cardId);
      return true;
    });
    upgradeableCards.forEach((instance) => {
      const card = cardDatabase[instance.cardId];
      const cardEl = createCardElement(card, true, -1, instance, true);
      cardEl.classList.add('upgrade-choice');
      cardEl.addEventListener('click', () => onUpgradeCard(instance.instanceId));
      upgradeGrid.appendChild(cardEl);
    });

    const tabs = [
      ['cards', cardIds.length > 0],
      ['relics', relicIds.length > 0],
      ['upgrades', upgradeableCards.length > 0]
    ];
    tabs.forEach(([mode, available]) => {
      document.querySelector(`[data-reward-tab="${mode}"]`).classList.toggle('hidden', !available);
    });
    const defaultTab = tabs.find(([, available]) => available)?.[0];
    if (!defaultTab) throw new Error('No post-battle rewards are available.');
    setRewardTab(defaultTab);
    modal.classList.remove('hidden');
  }

  function showStatsModal() {
    const profileStats = getProfileStats();
    const encounters = getEncounters();
    document.getElementById('statsHighestWave').textContent =
      `${profileStats.highestWaveCleared} / ${encounters.length}`;
    const fastestWin = profileStats.fastestWinMs;
    document.getElementById('statsFastestWin').textContent = fastestWin === null
      ? '—'
      : `${Math.floor(fastestWin / 60000)}m ${Math.floor((fastestWin % 60000) / 1000)}s`;

    const unlocked = new Set(profileStats.unlockedKaiju);
    const codexGrid = document.getElementById('statsCodexGrid');
    codexGrid.innerHTML = '';
    encounters.forEach((encounter, index) => {
      const cleared = unlocked.has(encounter.id);
      const entry = document.createElement('div');
      entry.className = `rounded-xl border p-3 ${cleared ? 'border-sky-400/35 bg-sky-500/10' : 'border-white/10 bg-black/25'}`;
      const wave = document.createElement('span');
      wave.className = 'block font-display text-[9px] tracking-widest text-slate-400';
      wave.textContent = `WAVE ${index + 1} // ${cleared ? 'CONTAINED' : 'UNKNOWN'}`;
      const name = document.createElement('span');
      name.className = `block font-display text-xs font-bold ${cleared ? 'text-sky-200' : 'text-slate-500'}`;
      name.textContent = cleared ? encounter.name : 'UNDISCOVERED KAIJU';
      entry.append(wave, name);
      codexGrid.appendChild(entry);
    });
    document.getElementById('statsModal').classList.remove('hidden');
  }

  function updateSoundButton(enabled, supported) {
    const button = document.getElementById('btnSound');
    button.disabled = !supported;
    button.setAttribute('aria-pressed', String(enabled));
    button.textContent = supported
      ? `${enabled ? '🔊 SOUND ON' : '🔇 SOUND OFF'}`
      : '🔇 SOUND UNAVAILABLE';
    button.classList.toggle('opacity-50', !supported);
    button.classList.toggle('cursor-not-allowed', !supported);
  }

  function showRunEndModal(isVictory) {
    const state = getState();
    const encounters = getEncounters();
    const modal = document.getElementById('runEndModal');
    const badge = document.getElementById('runEndBadge');
    const title = document.getElementById('runEndTitle');
    const desc = document.getElementById('runEndDesc');

    if (isVictory) {
      badge.textContent = 'SETLIST COMPLETE // WORLD TOUR SAVED';
      badge.className = 'inline-block px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 font-display text-[10px] tracking-widest mb-3';
      title.textContent = 'ENCORE VICTORY!';
      desc.textContent = `K/DA defeated Burning Godzilla and completed all ${encounters.length} Kaiju waves with ${state.player.hp}/${state.player.maxHp} HP remaining!`;
    } else {
      badge.textContent = 'STAGE OVERWHELMED';
      badge.className = 'inline-block px-3 py-1 rounded-full bg-rose-500/20 border border-rose-400/40 text-rose-300 font-display text-[10px] tracking-widest mb-3';
      title.textContent = 'STAGE COLLAPSED';
      desc.textContent = `${state.enemy.name} shattered the concert dome on Wave ${state.stageIndex + 1}. Tweak your draft and try another run!`;
    }

    modal.classList.remove('hidden');
  }

  function openPileModal(title, cardInstances) {
    const cardDatabase = getCardDatabase();
    document.getElementById('pileModalTitle').textContent = `${title} (${cardInstances.length})`;
    const grid = document.getElementById('pileModalGrid');
    grid.innerHTML = '';
    cardInstances.forEach((instance) => {
      const card = cardDatabase[instance.cardId];
      if (card) grid.appendChild(createCardElement(card, true, -1, instance));
    });
    document.getElementById('pileModal').classList.remove('hidden');
  }

  function hideRunModals() {
    document.getElementById('runEndModal').classList.add('hidden');
    document.getElementById('draftModal').classList.add('hidden');
    document.getElementById('statsModal').classList.add('hidden');
  }

  function showSaveNotice(message) {
    const notice = document.getElementById('saveNotice');
    notice.textContent = message;
    notice.classList.remove('hidden');
  }

  document.querySelectorAll('[data-reward-tab]').forEach((tab) => {
    tab.addEventListener('click', () => setRewardTab(tab.dataset.rewardTab));
  });

  return {
    hideRunModals,
    openDraftModal,
    openPileModal,
    renderAll,
    showStatsModal,
    showRunEndModal,
    showSaveNotice,
    updateSoundButton,
    spawnPopup,
    triggerKaijuHitAnim,
    triggerScreenShake
  };
}
