import { getEffectiveCardCost } from './card-effects.js';
import { getArtRank, getUnlockedArtStyles, LEADERS, LEADER_ART_STYLES } from './leader-data.js';
import { DAILY_MODIFIERS } from './daily-challenge.js';

export function createGameUI({
  getState,
  getArtAssets,
  getLeaderArts,
  getCardDatabase,
  getRelicDatabase,
  getProfileStats,
  getEncounters,
  getCurrentEnemyIntent,
  getDailyChallenge,
  onPlayCard,
  onJumpToStage,
  onChooseDraftCard,
  onChooseRelic,
  onUpgradeCard,
  onCutCard,
  onSelectLeaderArt,
  onContinueTour,
  onCopyReceipt
}) {
  let loadedChangelog = null;

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
          ${card.type}${card.retain || card.retainInHand ? ' // RETAIN' : ''}
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
    const profileStats = getProfileStats();

    document.getElementById('turnNumberDisplay').textContent = state.turn;
    const setlistEl = document.getElementById('setlistTracker');
    setlistEl.innerHTML = encounters.map((enc, idx) => {
      const active = idx === state.stageIndex;
      const cleared = idx < state.stageIndex;
      const cls = active
        ? 'bg-pink-500 text-white border-amber-300 shadow-[0_0_10px_rgba(255,42,133,0.6)]'
        : cleared
        ? 'bg-emerald-500/25 text-emerald-300 border-emerald-400/40'
        : 'bg-white/5 text-slate-400 border-white/10';
      return `<span${active ? ' aria-current="step"' : ''} title="${enc.name}" class="px-2 py-0.5 rounded-lg border font-display text-[10px] font-black ${cls}">W${idx + 1}</span>`;
    }).join('');

    const devtoolsWaveSelector = document.getElementById('devtoolsWaveSelector');
    devtoolsWaveSelector.replaceChildren();
    if (window.location.hash === '#devtools') {
      encounters.forEach((enc, idx) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = `W${idx + 1}`;
        button.title = enc.name;
        button.setAttribute('aria-pressed', String(idx === state.stageIndex));
        button.className = `px-3 py-2 rounded-xl border font-display text-xs font-black transition ${
          idx === state.stageIndex
            ? 'bg-pink-500 text-white border-amber-300'
            : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/15'
        }`;
        button.addEventListener('click', () => onJumpToStage(idx));
        devtoolsWaveSelector.appendChild(button);
      });
    }

    LEADERS.forEach(({ id: member, name }) => {
      const slot = document.getElementById(`portrait-${member}`);
      const artAssets = getArtAssets();
      const artId = profileStats.selectedArts[member];
      const rank = getArtRank(profileStats.artWaveClears[member][artId]);
      if (slot) {
        slot.classList.add('border-2', 'border-white/10');
        if (slot.dataset.artUrl !== artAssets[member]) {
          const image = document.createElement('img');
          image.src = artAssets[member];
          image.alt = `${name} ${LEADER_ART_STYLES.find((style) => style.id === artId).name} art`;
          image.className = 'w-full h-full object-cover object-[50%_18%]';
          slot.replaceChildren(image);
          slot.dataset.artUrl = artAssets[member];
        }
        slot.dataset.rankTier = rank?.id || 'unranked';
        slot.title = rank
          ? `${name} ${LEADER_ART_STYLES.find((style) => style.id === artId).name} // ${rank.name} rank (${profileStats.artWaveClears[member][artId]} waves)`
          : `${name} ${LEADER_ART_STYLES.find((style) => style.id === artId).name}`;
      }
    });

    const leader = LEADERS.find(({ id }) => id === state.leader);
    const leaderAbilityButton = document.getElementById('btnLeaderAbility');
    leaderAbilityButton.disabled = state.leaderAbilityUsed || !state.isPlayerTurn;
    leaderAbilityButton.textContent = `★ ${leader.name.toUpperCase()} // ${leader.abilityName.toUpperCase()}${state.leaderAbilityUsed ? ' — USED' : ' — ONCE PER RUN'}`;
    leaderAbilityButton.title = leader.abilityDescription;
    leaderAbilityButton.className = state.leaderAbilityUsed || !state.isPlayerTurn
      ? 'w-full mt-2 py-1.5 px-3 rounded-xl font-display text-[10px] sm:text-xs font-black tracking-wider transition border border-white/10 bg-white/5 text-slate-400 cursor-not-allowed'
      : 'w-full mt-2 py-1.5 px-3 rounded-xl font-display text-[10px] sm:text-xs font-black tracking-wider transition border border-fuchsia-300/60 bg-fuchsia-500/15 text-fuchsia-100 hover:bg-fuchsia-500/25 cursor-pointer';

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
    const stageEffects = {
      overcharge_grid: {
        label: 'OVERCHARGE GRID',
        description: 'At turn end, each unspent Energy deals 3 direct HP damage.'
      },
      thermonuclear_heat: {
        label: 'THERMONUCLEAR HEAT',
        description: 'At turn end, having 0 Shield deals 3 direct HP damage.'
      },
      luminous_spores: {
        label: 'LUMINOUS SPORES',
        description: 'Playing a Skill grants +3% extra Crowd Cheer.'
      }
    };
    const stageEffectBadge = document.getElementById('enemyStageEffectBadge');
    const stageEffect = stageEffects[e.stageEffect];
    stageEffectBadge.classList.toggle('hidden', !stageEffect);
    if (stageEffect) {
      stageEffectBadge.textContent = `⚠️ ${stageEffect.label}`;
      stageEffectBadge.title = stageEffect.description;
    }

    const eBlockBadge = document.getElementById('enemyBlockBadge');
    if (e.block > 0) {
      eBlockBadge.classList.remove('hidden');
      eBlockBadge.textContent = `🛡️ ${e.block} BLOCK`;
    } else {
      eBlockBadge.classList.add('hidden');
    }

    const eStrengthBadge = document.getElementById('enemyStrengthBadge');
    if (e.strength > 0) {
      eStrengthBadge.classList.remove('hidden');
      eStrengthBadge.textContent = `💪 ${e.strength} STRENGTH`;
    } else {
      eStrengthBadge.classList.add('hidden');
    }

    const passiveEl = document.getElementById('enemyPassives');
    passiveEl.replaceChildren();
    for (const passive of e.passives || []) {
      const description = document.createElement('span');
      description.textContent = `◆ ${passive.desc}`;
      passiveEl.appendChild(description);
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

    const chain = state.memberPlayChain || { member: null, count: 0 };
    const membersPlayed = new Set(state.turnMembersPlayed || []);
    const harmonyEl = document.getElementById('memberHarmonyChain');
    harmonyEl.replaceChildren();
    LEADERS.forEach(({ id, name }) => {
      const pill = document.createElement('span');
      const isChainMember = chain.member === id && chain.count > 0;
      pill.className = `rounded-full border px-2 py-1 font-display text-[8px] font-bold ${
        isChainMember
          ? 'border-amber-300/70 bg-amber-400/20 text-amber-100'
          : membersPlayed.has(id)
            ? 'border-cyan-300/40 bg-cyan-400/10 text-cyan-100'
            : 'border-white/10 bg-black/20 text-slate-500'
      }`;
      pill.textContent = `${name.toUpperCase()}${isChainMember ? ` ${chain.count}/3` : membersPlayed.has(id) ? ' ✓' : ''}`;
      harmonyEl.appendChild(pill);
    });
    const harmonyReady = membersPlayed.size === LEADERS.length;
    if (harmonyReady) {
      const harmonyPill = document.createElement('span');
      harmonyPill.className = 'rounded-full border border-amber-300/70 bg-amber-400/20 px-2 py-1 font-display text-[8px] font-black text-amber-100';
      harmonyPill.textContent = 'QUARTET HARMONY';
      harmonyEl.appendChild(harmonyPill);
    }

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
    const cutGrid = document.getElementById('cutChoicesGrid');
    document.getElementById('draftHealText').textContent =
      `+${(getState()?.encoreLevel ?? 0) >= 2 ? 12 : 18} HP`;
    const cardDatabase = getCardDatabase();
    const relicDatabase = getRelicDatabase();
    cardGrid.innerHTML = '';
    relicGrid.innerHTML = '';
    upgradeGrid.innerHTML = '';
    cutGrid.replaceChildren();

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
    masterDeck.forEach((instance) => {
      const card = cardDatabase[instance.cardId];
      if (!card || masterDeck.length <= 1) return;
      const choice = document.createElement('button');
      choice.type = 'button';
      choice.className = 'rounded-2xl border border-rose-300/30 bg-black/25 p-2 text-left transition hover:border-rose-200 hover:bg-rose-500/10';
      choice.appendChild(createCardElement(card, true, -1, instance));
      choice.addEventListener('click', () => onCutCard(instance.instanceId));
      cutGrid.appendChild(choice);
    });

    const tabs = [
      ['cards', cardIds.length > 0],
      ['relics', relicIds.length > 0],
      ['upgrades', upgradeableCards.length > 0],
      ['cuts', masterDeck.length > 1]
    ];
    tabs.forEach(([mode, available]) => {
      document.querySelector(`[data-reward-tab="${mode}"]`).classList.toggle('hidden', !available);
    });
    const defaultTab = tabs.find(([, available]) => available)?.[0];
    if (!defaultTab) throw new Error('No post-battle rewards are available.');
    setRewardTab(defaultTab);
    modal.classList.remove('hidden');
  }

  function renderMainMenu(savedRun, dailyChallenge) {
    const profileStats = getProfileStats();
    const encounters = getEncounters();
    const artAssets = getArtAssets();
    const members = document.getElementById('mainMenuMembers');
    members.replaceChildren();

    LEADERS.forEach(({ id, name }) => {
      const artId = profileStats.selectedArts[id];
      const style = LEADER_ART_STYLES.find((entry) => entry.id === artId);
      const rank = getArtRank(profileStats.artWaveClears[id][artId]);
      const card = document.createElement('article');
      card.className = 'overflow-hidden rounded-2xl border bg-black/40 shadow-lg';
      card.style.borderColor = rank?.color || 'rgba(255,255,255,0.15)';
      if (rank) card.style.boxShadow = `0 0 16px ${rank.color}55`;

      const image = document.createElement('img');
      image.src = artAssets[id];
      image.alt = `${name} ${style?.name || ''}`;
      image.className = 'h-36 w-full object-cover object-[50%_18%] sm:h-48';
      const caption = document.createElement('div');
      caption.className = 'flex flex-wrap items-center justify-between gap-1 p-2.5';
      const title = document.createElement('span');
      title.className = 'font-display text-[10px] font-black text-white';
      title.textContent = name.toUpperCase();
      const artName = document.createElement('span');
      artName.className = 'text-[9px] text-slate-400';
      artName.textContent = style?.name || 'POP/STARS';
      caption.append(title, artName);
      if (rank) {
        const rankBadge = document.createElement('span');
        rankBadge.className = 'w-full font-display text-[8px] font-bold uppercase tracking-wider';
        rankBadge.style.color = rank.color;
        rankBadge.textContent = `${rank.name} // ${profileStats.artWaveClears[id][artId]} WAVES`;
        caption.appendChild(rankBadge);
      }
      card.append(image, caption);
      members.appendChild(card);
    });

    const totalClears = Object.values(profileStats.leaderWins)
      .reduce((sum, wins) => sum + wins, 0);
    document.getElementById('menuHighestWave').textContent =
      `${profileStats.highestWaveCleared} / ${encounters.length}`;
    document.getElementById('menuFullClears').textContent = totalClears;
    const unlockedArtCount = LEADERS.reduce((count, leader) =>
      count + getUnlockedArtStyles(profileStats.leaderWins[leader.id]).length, 0);
    document.getElementById('menuUnlockedArt').textContent =
      `${unlockedArtCount} / ${LEADERS.length * LEADER_ART_STYLES.length}`;
    document.getElementById('menuCodexProgress').textContent =
      `${profileStats.unlockedKaiju.length} / ${encounters.length}`;
    const fastest = profileStats.fastestWinMs;
    document.getElementById('menuFastestWin').textContent = fastest === null
      ? '—'
      : `${Math.floor(fastest / 60000)}m ${Math.floor((fastest % 60000) / 1000)}s`;
    const maxEncoreLevel = profileStats.maxEncoreLevel ?? 0;
    document.getElementById('menuEncoreLevel').textContent =
      maxEncoreLevel === 0 ? 'Normal' : `Encore ${maxEncoreLevel}`;
    const yesterday = new Date(`${dailyChallenge.date}T00:00:00Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const lastDailyWinIsCurrent = profileStats.lastDailyWinDate === dailyChallenge.date ||
      profileStats.lastDailyWinDate === yesterday.toISOString().slice(0, 10);
    const currentDailyStreak = lastDailyWinIsCurrent ? profileStats.dailyWinStreak : 0;
    document.getElementById('menuDailyStreak').textContent =
      `${currentDailyStreak} // BEST ${profileStats.dailyBestWinStreak}`;
    const modifier = DAILY_MODIFIERS.find(({ id }) => id === dailyChallenge.modifier);
    const dailyLeader = LEADERS.find(({ id }) => id === dailyChallenge.leader);
    const dailyRelic = dailyChallenge.relicId
      ? getRelicDatabase()[dailyChallenge.relicId]?.name || dailyChallenge.relicId
      : 'No starter Relic';
    document.getElementById('menuDailyDetails').textContent =
      `${dailyChallenge.date} UTC // ${dailyLeader.name} // ${dailyRelic}`;
    document.getElementById('menuDailyRule').textContent = modifier.description;

    const continueButton = document.getElementById('btnContinueTour');
    const hasActiveRun = savedRun && ['playing', 'draft'].includes(savedRun.runStatus);
    continueButton.classList.toggle('hidden', !hasActiveRun);
    if (hasActiveRun) {
      const leader = LEADERS.find((entry) => entry.id === savedRun.leader);
      document.getElementById('menuContinueDetails').textContent =
        `${leader?.name || savedRun.leader} // WAVE ${savedRun.stageIndex + 1} // ${savedRun.player.hp}/${savedRun.player.maxHp} HP`;
    }
  }

  function showMainMenu(savedRun) {
    renderMainMenu(savedRun, getDailyChallenge());
    document.getElementById('mainMenuOverlay').classList.remove('hidden');
  }

  function hideMainMenu() {
    document.getElementById('mainMenuOverlay').classList.add('hidden');
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
    const history = document.getElementById('statsChangelogEntries');
    history.replaceChildren();
    loadedChangelog?.releases.forEach((release) => {
      const article = document.createElement('article');
      article.className = 'rounded-xl border border-white/10 bg-white/5 p-3';
      const heading = document.createElement('div');
      heading.className = 'flex items-center justify-between gap-2';
      const version = document.createElement('span');
      version.className = 'font-display text-[10px] font-black text-amber-200';
      version.textContent = release.version;
      const date = document.createElement('time');
      date.className = 'text-[10px] text-slate-400';
      date.dateTime = release.date;
      date.textContent = release.date;
      heading.append(version, date);
      const changes = document.createElement('ul');
      changes.className = 'mt-2 list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-slate-300';
      release.changes.forEach((change) => {
        const item = document.createElement('li');
        item.textContent = change;
        changes.appendChild(item);
      });
      article.append(heading, changes);
      history.appendChild(article);
    });
    document.getElementById('statsModal').classList.remove('hidden');
  }

  function showArtStudio() {
    const profileStats = getProfileStats();
    const leaderArts = getLeaderArts();
    const grid = document.getElementById('leaderArtGrid');
    grid.replaceChildren();

    LEADERS.forEach(({ id, name }) => {
      const leaderWins = profileStats.leaderWins[id];
      const section = document.createElement('section');
      section.className = 'rounded-2xl bg-black/35 border border-white/10 p-4';
      const heading = document.createElement('div');
      heading.className = 'flex flex-wrap items-baseline justify-between gap-2 mb-3';
      const title = document.createElement('h3');
      title.className = 'font-display text-sm font-black text-white';
      title.textContent = name;
      const progress = document.createElement('p');
      progress.className = 'text-[11px] text-slate-400';
      progress.textContent = `${leaderWins} full ${leaderWins === 1 ? 'clear' : 'clears'} // ${
        leaderWins < 2 ? `${2 - leaderWins} ${leaderWins === 1 ? 'more clear' : 'clears'} to FIRESTARTER` : 'all art unlocked'
      }`;
      heading.append(title, progress);

      const artChoices = document.createElement('div');
      artChoices.className = 'grid grid-cols-1 sm:grid-cols-3 gap-3';
      const unlockedStyles = getUnlockedArtStyles(leaderWins);
      LEADER_ART_STYLES.forEach((style) => {
        const unlocked = unlockedStyles.some(({ id: unlockedId }) => unlockedId === style.id);
        const selected = profileStats.selectedArts[id] === style.id;
        const clearedWaves = profileStats.artWaveClears[id][style.id];
        const rank = getArtRank(clearedWaves);
        const choice = document.createElement('button');
        choice.type = 'button';
        choice.disabled = !unlocked;
        choice.setAttribute('aria-pressed', String(selected));
        choice.className = `overflow-hidden rounded-xl border text-left transition ${
          selected ? 'border-amber-300 ring-2 ring-amber-300/30' : 'border-white/15'
        } ${unlocked ? 'hover:border-cyan-300' : 'opacity-55 cursor-not-allowed'}`;

        const image = document.createElement('img');
        image.src = leaderArts[id][style.id];
        image.alt = `${name} ${style.name}`;
        image.className = 'h-28 w-full object-cover object-[50%_20%]';
        const details = document.createElement('span');
        details.className = 'block p-3';
        const artName = document.createElement('span');
        artName.className = 'block font-display text-[10px] font-black text-white';
        artName.textContent = `${style.name}${selected ? ' // EQUIPPED' : ''}`;
        const status = document.createElement('span');
        status.className = 'mt-1 block text-[10px] text-slate-300';
        status.textContent = unlocked
          ? `${clearedWaves} waves with this art${rank ? ` // ${rank.name} rank` : ''}`
          : `Unlock after ${style.winsRequired} full ${style.winsRequired === 1 ? 'clear' : 'clears'} with ${name}`;
        details.append(artName, status);
        choice.append(image, details);
        if (rank) choice.style.borderColor = rank.color;
        if (unlocked) {
          choice.addEventListener('click', () => {
            onSelectLeaderArt(id, style.id);
            showArtStudio();
          });
        }
        artChoices.appendChild(choice);
      });

      section.append(heading, artChoices);
      grid.appendChild(section);
    });

    document.getElementById('artStudioModal').classList.remove('hidden');
  }

  let selectedLeader = LEADERS[0].id;
  let selectedEncoreLevel = 0;

  const ENCORE_TIERS = [
    { level: 0, name: 'Normal', description: 'Standard 10-wave setlist. No Encore modifiers.' },
    { level: 1, name: 'Encore 1', description: 'E1: Bosses have +15% maximum HP.' },
    { level: 2, name: 'Encore 2', description: 'E1–E2: Boss HP +15%; post-draft healing is only +12 HP.' },
    { level: 3, name: 'Encore 3', description: 'E1–E3: Boss HP +15%, heal +12, and bosses start with +1 Strength.' },
    { level: 4, name: 'Encore 4', description: 'E1–E4: All prior modifiers, plus one Stage Fright curse in the starter deck.' },
    { level: 5, name: 'Encore 5', description: 'E1–E5: Prior modifiers, +4 to interrupt thresholds, and boss Phase 2 begins at 60% HP.' }
  ];

  function renderEncoreChoices() {
    const maxLevel = getProfileStats().maxEncoreLevel ?? 0;
    if (selectedEncoreLevel > maxLevel) selectedEncoreLevel = 0;
    const choices = document.getElementById('encoreTierChoices');
    choices.replaceChildren();
    document.getElementById('encoreTierUnlockText').textContent = `${maxLevel}/5 tiers unlocked`;

    ENCORE_TIERS.forEach((tier) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.disabled = tier.level > maxLevel;
      button.setAttribute('aria-pressed', String(selectedEncoreLevel === tier.level));
      button.className = `rounded-xl border px-2 py-2 text-center font-display text-[10px] font-black transition ${
        selectedEncoreLevel === tier.level
          ? 'border-amber-300 bg-amber-400/20 text-amber-200 ring-2 ring-amber-300/20'
          : tier.level <= maxLevel
            ? 'border-white/15 bg-black/25 text-slate-200 hover:border-cyan-300/60'
            : 'cursor-not-allowed border-white/5 bg-white/[0.03] text-slate-600'
      }`;
      button.textContent = tier.level > maxLevel ? `${tier.name} 🔒` : tier.name;
      button.addEventListener('click', () => {
        selectedEncoreLevel = tier.level;
        renderEncoreChoices();
      });
      choices.appendChild(button);
    });
    document.getElementById('encoreTierDescription').textContent =
      ENCORE_TIERS[selectedEncoreLevel].description;
  }

  function renderLeaderChoices() {
    const profileStats = getProfileStats();
    const leaderArts = getLeaderArts();
    const choices = document.getElementById('leaderChoicesGrid');
    choices.replaceChildren();

    LEADERS.forEach((leader) => {
      const choice = document.createElement('button');
      choice.type = 'button';
      choice.setAttribute('aria-pressed', String(selectedLeader === leader.id));
      choice.className = `flex items-center gap-3 rounded-2xl border p-3 text-left transition ${
        selectedLeader === leader.id
          ? 'border-amber-300 bg-amber-400/10 ring-2 ring-amber-300/25'
          : 'border-white/15 bg-black/25 hover:border-cyan-300/60'
      }`;
      const image = document.createElement('img');
      image.src = leaderArts[leader.id][profileStats.selectedArts[leader.id]];
      image.alt = '';
      image.className = 'h-20 w-20 shrink-0 rounded-xl object-cover object-[50%_18%]';
      const description = document.createElement('span');
      description.className = 'min-w-0';
      const name = document.createElement('span');
      name.className = 'block font-display text-sm font-black text-white';
      name.textContent = leader.name;
      const ability = document.createElement('span');
      ability.className = 'mt-1 block font-display text-[10px] font-bold text-fuchsia-200';
      ability.textContent = leader.abilityName;
      const details = document.createElement('span');
      details.className = 'mt-1 block text-[11px] leading-relaxed text-slate-300';
      details.textContent = leader.abilityDescription;
      const wins = document.createElement('span');
      wins.className = 'mt-1 block text-[9px] text-slate-500';
      wins.textContent = `${profileStats.leaderWins[leader.id]} full clears`;
      description.append(name, ability, details, wins);
      choice.append(image, description);
      choice.addEventListener('click', () => {
        selectedLeader = leader.id;
        renderLeaderChoices();
      });
      choices.appendChild(choice);
    });
  }

  function openLeaderSelection(canCancel, currentLeader, allowCancel = canCancel) {
    selectedLeader = LEADERS.some(({ id }) => id === currentLeader) ? currentLeader : LEADERS[0].id;
    renderEncoreChoices();
    document.getElementById('btnCancelLeaderSelection').classList.toggle('hidden', !allowCancel);
    document.getElementById('leaderSelectionWarning').classList.toggle('hidden', !canCancel);
    renderLeaderChoices();
    document.getElementById('leaderSelectionModal').classList.remove('hidden');
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

  function setChangelog(changelog) {
    loadedChangelog = changelog;
    document.getElementById('versionText').textContent = changelog.currentVersion;
    const entries = document.getElementById('changelogEntries');
    entries.innerHTML = '';
    changelog.releases.forEach((release) => {
      const article = document.createElement('article');
      article.className = 'rounded-xl border border-white/10 bg-white/5 p-3';
      const heading = document.createElement('div');
      heading.className = 'flex flex-wrap items-center justify-between gap-2';
      const version = document.createElement('h3');
      version.className = 'font-display text-[10px] font-black text-amber-200';
      version.textContent = release.version;
      const date = document.createElement('time');
      date.className = 'text-[10px] text-slate-400';
      date.dateTime = release.date;
      date.textContent = release.date;
      heading.append(version, date);
      if (release.version === changelog.currentVersion) {
        const current = document.createElement('span');
        current.className = 'rounded-full border border-emerald-400/35 bg-emerald-400/10 px-2 py-0.5 font-display text-[8px] font-bold text-emerald-200';
        current.textContent = 'CURRENT';
        heading.append(current);
      }

      const changes = document.createElement('ul');
      changes.className = 'mt-2 list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-slate-300';
      release.changes.forEach((change) => {
        const item = document.createElement('li');
        item.textContent = change;
        changes.appendChild(item);
      });
      article.append(heading, changes);
      entries.appendChild(article);
    });
    fitChangelogToFour();
  }

  function fitChangelogToFour() {
    const entries = document.getElementById('changelogEntries');
    const itemCount = Math.min(4, entries.children.length);
    if (itemCount === 0) return;
    const first = entries.children[0].getBoundingClientRect();
    const fourth = entries.children[itemCount - 1].getBoundingClientRect();
    const height = fourth.bottom - first.top;
    entries.style.maxHeight = `${Math.min(height, window.innerHeight * 0.7)}px`;
  }

  function setChangelogOpen(open) {
    const button = document.getElementById('btnVersion');
    document.getElementById('changelogDropdown').classList.toggle('hidden', !open);
    button.setAttribute('aria-expanded', String(open));
    if (open) requestAnimationFrame(fitChangelogToFour);
  }

  function setBattleLogCollapsed(collapsed) {
    const panel = document.getElementById('battleLogPanel');
    const button = document.getElementById('btnToggleBattleLog');
    panel.classList.toggle('battle-log-collapsed', collapsed);
    button.setAttribute('aria-expanded', String(!collapsed));
    document.getElementById('battleLogToggleIcon').textContent = collapsed ? '▼' : '▲';
    document.getElementById('battleLogToggleText').textContent = collapsed ? 'EXPAND' : 'COLLAPSE';
  }

  function showRunEndModal(isVictory) {
    const state = getState();
    const encounters = getEncounters();
    const cardDatabase = getCardDatabase();
    const modal = document.getElementById('runEndModal');
    const badge = document.getElementById('runEndBadge');
    const title = document.getElementById('runEndTitle');
    const desc = document.getElementById('runEndDesc');

    if (isVictory) {
      badge.textContent = 'SETLIST COMPLETE // WORLD TOUR SAVED';
      badge.className = 'inline-block px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 font-display text-[10px] tracking-widest mb-3';
      title.textContent = 'ENCORE VICTORY!';
      const finalEncounter = encounters[encounters.length - 1];
      desc.textContent = `K/DA defeated ${finalEncounter.name.split(':')[0]} and completed all ${encounters.length} Kaiju waves with ${state.player.hp}/${state.player.maxHp} HP remaining!`;
    } else {
      badge.textContent = 'STAGE OVERWHELMED';
      badge.className = 'inline-block px-3 py-1 rounded-full bg-rose-500/20 border border-rose-400/40 text-rose-300 font-display text-[10px] tracking-widest mb-3';
      title.textContent = 'STAGE COLLAPSED';
      desc.textContent = `${state.enemy.name} shattered the concert dome on Wave ${state.stageIndex + 1}. Tweak your draft and try another run!`;
    }

    const mostPlayed = Object.entries(state.cardPlayCounts || {})
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    document.getElementById('receiptWaves').textContent =
      `${state.wavesCleared || 0} / ${encounters.length}`;
    document.getElementById('receiptMostPlayed').textContent = mostPlayed
      ? `${cardDatabase[mostPlayed[0]]?.name || mostPlayed[0]} (${mostPlayed[1]})`
      : '—';
    document.getElementById('receiptPeakDamage').textContent =
      String(state.peakSingleTurnDamage || 0);
    const dailyDetails = document.getElementById('receiptDailyDetails');
    if (state.dailyChallenge) {
      const modifier = DAILY_MODIFIERS.find(({ id }) => id === state.dailyChallenge.modifier);
      dailyDetails.textContent =
        `DAILY ${state.dailyChallenge.date} UTC // ${modifier?.name || state.dailyChallenge.modifier}`;
      dailyDetails.classList.remove('hidden');
    } else {
      dailyDetails.textContent = '';
      dailyDetails.classList.add('hidden');
    }
    document.getElementById('receiptCopyStatus').textContent = '';
    modal.classList.remove('hidden');
  }

  function showReceiptCopyStatus(message) {
    document.getElementById('receiptCopyStatus').textContent = message;
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
    document.getElementById('leaderSelectionModal').classList.add('hidden');
    document.getElementById('artStudioModal').classList.add('hidden');
  }

  function showSaveNotice(message) {
    const notice = document.getElementById('saveNotice');
    notice.textContent = message;
    notice.classList.remove('hidden');
  }

  document.querySelectorAll('[data-reward-tab]').forEach((tab) => {
    tab.addEventListener('click', () => setRewardTab(tab.dataset.rewardTab));
  });
  document.getElementById('btnVersion').addEventListener('click', () => {
    const isOpen = document.getElementById('btnVersion').getAttribute('aria-expanded') === 'true';
    setChangelogOpen(!isOpen);
  });
  document.addEventListener('click', (event) => {
    if (!document.getElementById('versionMenu').contains(event.target)) setChangelogOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setChangelogOpen(false);
  });
  window.addEventListener('resize', fitChangelogToFour);
  document.getElementById('btnArtStudio').addEventListener('click', showArtStudio);
  document.getElementById('btnMenuArtStudio').addEventListener('click', showArtStudio);
  document.getElementById('btnMenuCodex').addEventListener('click', showStatsModal);
  document.getElementById('btnCopyReceipt').addEventListener('click', onCopyReceipt);
  document.getElementById('btnNewWorldTour').addEventListener('click', () => {
    openLeaderSelection(false, null, true);
  });
  document.getElementById('btnContinueTour').addEventListener('click', onContinueTour);
  document.getElementById('btnCloseArtStudio').addEventListener('click', () => {
    document.getElementById('artStudioModal').classList.add('hidden');
  });
  document.getElementById('btnCancelLeaderSelection').addEventListener('click', () => {
    document.getElementById('leaderSelectionModal').classList.add('hidden');
  });
  document.getElementById('btnToggleBattleLog').addEventListener('click', () => {
    const panel = document.getElementById('battleLogPanel');
    setBattleLogCollapsed(!panel.classList.contains('battle-log-collapsed'));
  });
  setBattleLogCollapsed(window.matchMedia('(max-width: 640px)').matches);

  return {
    hideRunModals,
    showMainMenu,
    hideMainMenu,
    openLeaderSelection,
    openDraftModal,
    openPileModal,
    renderAll,
    setChangelog,
    showStatsModal,
    showArtStudio,
    showRunEndModal,
    showReceiptCopyStatus,
    showSaveNotice,
    getSelectedLeader: () => selectedLeader,
    getSelectedEncoreLevel: () => selectedEncoreLevel,
    updateSoundButton,
    spawnPopup,
    triggerKaijuHitAnim,
    triggerScreenShake
  };
}
