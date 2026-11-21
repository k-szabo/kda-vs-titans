import { getEffectiveCardCost } from './card-effects.js';
import { getDeathLogEntries, MEMBER_SYNERGY } from './combat-rules.js';
import { MEMBER_KEYWORDS } from './keywords.js';
import { getCardFinishLevel, getFinishClass } from './card-finishes.js';
import { pickVoiceLine } from './voice-lines.js';
import { getArtRank, getUnlockedArtStyles, LEADERS, LEADER_ART_STYLES } from './leader-data.js';
import { DAILY_MODIFIERS } from './daily-challenge.js';
import { renderChangelogEntries } from './changelog-ui.js';
import { createProgressionUI } from './progression-ui.js';
import { LEONA_MANAGER_ART } from './tour-routes.js';
import { SHOP_HEAL_AMOUNT, SHOP_PRICES } from './shop.js';

export function createGameUI({
  getState,
  getArtAssets,
  getLeaderArts,
  getCardDatabase,
  getRelicDatabase,
  getCardDamagePreview,
  getProfileStats,
  getEncounters,
  getAllEncounters,
  getCurrentEnemyIntent,
  getDailyChallenge,
  getMissions,
  onPlayCard,
  onToggleKeep,
  onChooseRoute,
  onChooseEventOption,
  onRemoveEventCard,
  onBuyShopCard,
  onBuyShopRelic,
  onBuyShopRemoval,
  onBuyShopHeal,
  onJumpToStage,
  onChooseDraftCard,
  onChooseRelic,
  onUpgradeCard,
  onSelectLeaderArt,
  onContinueTour,
  onCopyReceipt,
  onUpgradeCardFinish,
  onPreviewCard,
  onConsentShare,
  onConsentSkip,
  onConsentOptOut
}) {
  const progressionUI = createProgressionUI({
    getArtAssets,
    getLeaderArts,
    getCardDatabase,
    getRelicDatabase,
    getProfileStats,
    getEncounters,
    getAllEncounters,
    getMissions,
    getDailyChallenge,
    onSelectLeaderArt,
    onUpgradeCardFinish,
    onPreviewCard
  });

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
    const isKept = !isDraftPreview &&
      handIndex >= 0 &&
      cardInstance != null &&
      state.keptCardInstanceId === cardInstance.instanceId;
    const chain = state.memberPlayChain || { member: null, count: 0 };
    const spotlightReady = !isDraftPreview &&
      handIndex >= 0 &&
      card.member === chain.member &&
      chain.count === 2;
    const damagePreview = !isDraftPreview && handIndex >= 0 && getCardDamagePreview
      ? getCardDamagePreview(cardInstance)
      : null;
    const damageLabel = damagePreview
      ? damagePreview.hits && damagePreview.hits > 1
        ? `⚔ ${damagePreview.perHit}×${damagePreview.hits}`
        : `⚔ ${damagePreview.total}`
      : '';
    const damageBadge = damagePreview
      ? `<span class="rounded border px-1 py-0.5 font-display text-[8px] font-black tracking-wider ${
          damagePreview.lethal
            ? 'border-rose-400/60 bg-rose-500/25 text-rose-100'
            : 'border-amber-300/30 bg-black/40 text-amber-200'
        }">${damagePreview.lethal ? `LETHAL ${damageLabel}` : damageLabel}</span>`
      : '';
    const el = document.createElement('div');
    const finishLevel = getCardFinishLevel(getProfileStats().cardFinishes, card.id);
    el.className = `spire-card card-${card.member} p-2.5 sm:p-3 flex flex-col justify-between ${
      playable ? 'playable' : 'unplayable'
    }${upgradeLevel > 0 ? ' card-upgraded' : ''}${isKept ? ' ring-2 ring-amber-300/70' : ''}${finishLevel > 0 ? ` ${getFinishClass(finishLevel)}` : ''}`;

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
    const artUrl = card.art || artAssets[card.member] || artAssets.squad;
    const artClass = card.art ? 'object-contain p-1 bg-slate-950' : 'object-cover object-[50%_18%]';

    el.innerHTML = `
      <div>
        <div class="flex items-center justify-between gap-1 mb-1.5">
          <span class="px-1.5 py-0.5 rounded border font-display text-[9px] font-bold ${badgeColor}">
            ${card.memberName}
          </span>
          <div class="flex items-center gap-1">
            ${!isDraftPreview && handIndex >= 0 ? `<button type="button" data-keep-toggle="1" aria-pressed="${isKept}" title="${isKept ? 'Stop keeping this card' : 'Keep this card for next turn (draws one fewer)'}" class="w-5 h-5 rounded-full border font-display text-[9px] leading-none flex items-center justify-center ${isKept ? 'bg-amber-400 text-slate-950 border-amber-300' : 'bg-black/40 text-amber-200/80 border-white/20'}">📌</button>` : ''}
            <span class="w-6 h-6 rounded-full bg-amber-400 text-slate-950 font-display text-xs font-black flex items-center justify-center shadow">
              ${cost}
            </span>
          </div>
        </div>
        <div class="w-full h-16 sm:h-20 rounded-lg overflow-hidden mb-1.5 border border-white/10 bg-slate-900">
          <img src="${artUrl}" alt="${card.name}" class="w-full h-full ${artClass}" />
        </div>
        <div class="font-display text-xs font-black text-white leading-tight mb-1">
          ${card.name}${upgradeLevel > 0 ? ' +' : ''}
        </div>
      </div>
      <div>
        ${spotlightReady ? '<div class="mb-1 font-display text-[8px] font-black tracking-wider text-amber-300">✨ SPOTLIGHT READY</div>' : ''}
        <p class="text-[11px] text-slate-300 leading-snug mb-1.5">${upgradeLevel > 0 ? card.upgrade.description : card.desc}</p>
        <div class="flex items-center justify-between gap-1">
          <span class="text-[9px] font-display tracking-widest text-slate-500 uppercase">
            ${card.type}${card.retain || card.retainInHand ? ' // RETAIN' : ''}
          </span>
          ${damageBadge}
        </div>
      </div>
    `;

    if (!isDraftPreview && handIndex >= 0) {
      el.addEventListener('click', () => onPlayCard(handIndex));
      const keepToggle = el.querySelector('[data-keep-toggle]');
      if (keepToggle) {
        keepToggle.addEventListener('click', (event) => {
          event.stopPropagation();
          onToggleKeep(cardInstance.instanceId);
        });
      }
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

  function buildComboReference({ compact = false } = {}) {
    const { quartet, spotlight } = MEMBER_SYNERGY;
    const rows = LEADERS.map(({ id, name }) => {
      const synergy = spotlight[id];
      if (!synergy) return '';
      const parts = [];
      if (synergy.charm) parts.push(`${synergy.charm} Charm`);
      if (synergy.heal) parts.push(`heal ${synergy.heal} HP`);
      if (synergy.damage) parts.push(`${synergy.damage} piercing damage`);
      if (synergy.draw) parts.push(`draw ${synergy.draw}`);
      if (synergy.marked) parts.push(`${synergy.marked} Marked`);
      if (synergy.stealBlock) parts.push(`steal up to ${synergy.stealBlock} Block`);
      if (synergy.block) parts.push(`+${synergy.block} Holo Shield`);
      if (synergy.encore) parts.push(`+${synergy.encore} turn of Encore`);
      return `<li><span class="font-bold text-white">${name}</span>: ${parts.join(', ')}</li>`;
    }).join('');

    const wrapperClass = compact
      ? 'rounded-xl border border-amber-300/25 bg-amber-400/5 p-2.5 text-[10px] leading-relaxed text-slate-300'
      : 'text-xs leading-relaxed text-slate-300';
    const headingClass = compact ? 'text-[10px]' : 'text-xs';

    return `
      <div class="${wrapperClass}">
        <p class="font-display ${headingClass} font-black text-amber-200">QUARTET HARMONY <span class="font-normal text-slate-400">— all four members in one turn, once per turn</span></p>
        <p class="mb-2">+${quartet.energy} Energy, +${quartet.block} Holo Shield, +${quartet.cheer}% Crowd Cheer.</p>
        <p class="font-display ${headingClass} font-black text-amber-200">SOLO SPOTLIGHT <span class="font-normal text-slate-400">— 3 cards from the same member in a row</span></p>
        <ul class="mt-1 list-disc space-y-0.5 pl-4">${rows}</ul>
        <p class="mt-2 text-slate-400">A non-member card (e.g. K/DA SQUAD) breaks the consecutive chain but keeps members already played this turn.</p>
      </div>`;
  }

  function renderComboReference() {
    const guide = document.getElementById('comboGuide');
    if (guide && guide.dataset.rendered !== 'true') {
      guide.innerHTML = buildComboReference({ compact: true });
      guide.dataset.rendered = 'true';
    }
    const howTo = document.getElementById('howToPlayCombos');
    if (howTo && howTo.dataset.rendered !== 'true') {
      howTo.innerHTML = buildComboReference();
      howTo.dataset.rendered = 'true';
    }
    const keywordsEl = document.getElementById('howToPlayKeywords');
    if (keywordsEl && keywordsEl.dataset.rendered !== 'true') {
      const rows = LEADERS.map(({ id, name }) => {
        const keyword = MEMBER_KEYWORDS[id];
        if (!keyword) return '';
        return `<li><span class="font-bold text-white">${name} — ${keyword.name} (${keyword.tagline})</span>: ${keyword.description}</li>`;
      }).join('');
      keywordsEl.innerHTML = `<ul class="list-disc space-y-1 pl-4">${rows}</ul>`;
      keywordsEl.dataset.rendered = 'true';
    }
  }

  function renderBuffs(currentState, cardDatabase) {
    const slots = document.getElementById('buffSlots');
    if (!slots) return;
    const buffs = currentState.buffs || [];
    const counter = document.getElementById('buffSlotCount');
    if (counter) counter.textContent = `${buffs.length} / 3`;
    slots.replaceChildren();
    for (let index = 0; index < 3; index++) {
      const buff = buffs[index];
      const tile = document.createElement('div');
      if (!buff) {
        tile.className = 'h-14 rounded-lg border border-dashed border-white/10 bg-black/20 flex items-center justify-center font-display text-[8px] tracking-widest text-slate-600';
        tile.textContent = 'EMPTY';
        slots.appendChild(tile);
        continue;
      }
      const card = cardDatabase[buff.cardId];
      tile.className = 'relative h-14 rounded-lg border border-purple-400/40 bg-purple-500/10 overflow-hidden';
      tile.title = card ? `${card.name}: ${(card.desc || '').replace(/<[^>]+>/g, '')}` : 'Buff';
      const timer = buff.remaining === null ? 'ARMED' : String(buff.remaining);
      tile.innerHTML = `
        ${card?.art ? `<img src="${card.art}" alt="${card.name}" class="absolute inset-0 h-full w-full object-contain p-1" />` : ''}
        <span class="absolute right-0.5 top-0.5 rounded bg-black/75 px-1 font-display text-[8px] font-black text-amber-200">${timer}</span>
        <span class="absolute inset-x-0 bottom-0 truncate bg-black/75 px-1 py-0.5 font-display text-[7px] font-bold text-white">${card?.name || 'Buff'}</span>
      `;
      slots.appendChild(tile);
    }
  }

  function openBuffReplaceModal(buffs) {
    const modal = document.getElementById('buffReplaceModal');
    const grid = document.getElementById('buffReplaceChoices');
    if (!modal || !grid) return;
    grid.replaceChildren();
    buffs.forEach((buff, index) => {
      const choice = document.createElement('button');
      choice.type = 'button';
      choice.dataset.buffReplace = String(index);
      choice.className = 'flex items-center gap-2 rounded-xl border border-purple-400/40 bg-purple-500/10 p-2 text-left transition hover:bg-purple-500/20';
      choice.innerHTML = `
        ${buff.art ? `<img src="${buff.art}" alt="" class="h-10 w-10 rounded-lg bg-slate-950 object-contain" />` : ''}
        <span class="flex-1">
          <span class="block font-display text-[10px] font-black text-white">${buff.name || 'Buff'}</span>
          <span class="block text-[10px] text-slate-400">${buff.remaining === null ? 'ARMED' : `${buff.remaining} turn${buff.remaining === 1 ? '' : 's'} left`}</span>
        </span>
      `;
      grid.appendChild(choice);
    });
    modal.classList.remove('hidden');
  }

  function closeBuffReplaceModal() {
    document.getElementById('buffReplaceModal')?.classList.add('hidden');
  }

  function renderAll() {
    const state = getState();
    const encounters = getEncounters();
    const cardDatabase = getCardDatabase();
    const relicDatabase = getRelicDatabase();
    const profileStats = getProfileStats();

    document.getElementById('turnNumberDisplay').textContent = state.turn;
    const tokenDisplay = document.getElementById('merchTokenDisplay');
    if (tokenDisplay) tokenDisplay.textContent = `${state.merchTokens ?? 0} 🪙`;
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

    renderBuffs(state, cardDatabase);

    const e = state.enemy;
    const intent = getCurrentEnemyIntent();
    document.getElementById('enemySubtitle').textContent = e.subtitle;
    document.getElementById('enemyName').textContent = e.name;
    document.getElementById('enemyIntentText').textContent = intent.displayText;
    const intentBox = document.getElementById('enemyIntentBox');
    const intentHints = [];
    if (intent.charged) intentHints.push('Charged attack.');
    if (Number.isFinite(intent.interruptThreshold)) {
      intentHints.push(`Deal ${intent.interruptThreshold} HP damage this turn to interrupt it.`);
    }
    if (Number.isFinite(intent.pierce) && intent.pierce > 0) {
      intentHints.push(`${Math.round(intent.pierce * 100)}% of the damage pierces Holo Shield.`);
    }
    if (intentHints.length > 0) {
      const hint = intentHints.join(' ');
      intentBox.title = hint;
      intentBox.setAttribute('aria-label', `${intent.displayText}. ${hint}`);
    } else {
      intentBox.removeAttribute('title');
      intentBox.setAttribute('aria-label', intent.displayText);
    }
    const stunMeter = document.getElementById('enemyStunMeter');
    const stunThreshold = Number.isFinite(intent.interruptThreshold) ? intent.interruptThreshold : null;
    if (stunThreshold) {
      const stunProgress = Math.min(state.damageDealtThisTurn || 0, stunThreshold);
      const stunMet = stunProgress >= stunThreshold;
      stunMeter.classList.remove('hidden');
      stunMeter.textContent = stunMet
        ? `🛑 STUN READY (${stunThreshold} HP DMG)`
        : `STUN ${stunProgress} / ${stunThreshold} HP DMG`;
      stunMeter.className = stunMet
        ? 'mt-1 text-[9px] font-display font-black tracking-wider text-emerald-300'
        : 'mt-1 text-[9px] font-display font-black tracking-wider text-cyan-200';
    } else {
      stunMeter.classList.add('hidden');
    }
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

  function openTourRoutingModal(routes, healAmount, shop = null, tokens = 0) {
    const modal = document.getElementById('tourRoutingModal');
    const grid = document.getElementById('tourRouteChoices');
    if (!modal || !grid) return;
    const portrait = document.getElementById('tourManagerPortrait');
    if (portrait) portrait.src = LEONA_MANAGER_ART;
    const healText = document.getElementById('tourHealText');
    if (healText) healText.textContent = `Card and relic stops restore +${healAmount} HP. Cut and rest are gone — thinning and healing are bought at the merch shop.`;
    grid.replaceChildren();
    routes.filter(Boolean).forEach((route) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.dataset.route = route.id;
      card.className = 'group flex items-center gap-3 rounded-2xl border border-white/15 bg-black/30 p-3 text-left transition hover:border-amber-300/70 hover:bg-amber-400/10';
      card.innerHTML = `
        <span class="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-amber-300/40 bg-amber-400/10 text-xl">${route.icon}</span>
        <span class="min-w-0 flex-1">
          <span class="block font-display text-sm font-black text-white">${route.name}</span>
          <span class="block text-[11px] leading-snug text-slate-300">${route.summary}</span>
        </span>
        <span class="shrink-0 rounded-full border border-amber-300/40 bg-amber-400/10 px-2 py-1 font-display text-[8px] font-black text-amber-200">${route.tag}</span>
      `;
      card.addEventListener('click', () => onChooseRoute(route.id));
      grid.appendChild(card);
    });
    renderShop(shop, tokens);
    modal.classList.remove('hidden');
  }

  function renderShop(shop, tokens) {
    const section = document.getElementById('merchShopSection');
    if (!section) return;
    const balance = document.getElementById('shopBalance');
    if (balance) balance.textContent = `${tokens ?? 0} 🪙`;
    const cardGrid = document.getElementById('shopCardGrid');
    const relicGrid = document.getElementById('shopRelicGrid');
    const cutSection = document.getElementById('shopCutSection');
    const cutGrid = document.getElementById('shopCutGrid');
    const healButton = document.getElementById('btnShopHeal');
    const removalButton = document.getElementById('btnShopRemoval');
    if (!cardGrid || !relicGrid || !cutSection || !cutGrid || !healButton || !removalButton) return;
    const cardDatabase = getCardDatabase();
    const relicDatabase = getRelicDatabase();
    const state = getState();
    cutSection.classList.add('hidden');
    cutGrid.replaceChildren();

    cardGrid.replaceChildren();
    (shop?.cards || []).forEach((cardId) => {
      const card = cardDatabase[cardId];
      if (!card) return;
      const affordable = (tokens ?? 0) >= SHOP_PRICES.card;
      const choice = document.createElement('button');
      choice.type = 'button';
      choice.disabled = !affordable;
      choice.className = affordable
        ? 'rounded-2xl border border-amber-300/40 bg-black/25 p-2 text-left transition hover:border-amber-200 hover:bg-amber-500/10'
        : 'rounded-2xl border border-white/10 bg-black/25 p-2 text-left opacity-50 cursor-not-allowed';
      choice.appendChild(createCardElement(card, true, -1, { upgradeLevel: 0 }));
      const price = document.createElement('span');
      price.className = 'mt-1 block text-center font-display text-[10px] font-black text-amber-200';
      price.textContent = `BUY ${SHOP_PRICES.card} 🪙`;
      choice.appendChild(price);
      if (affordable) choice.addEventListener('click', () => onBuyShopCard(cardId));
      cardGrid.appendChild(choice);
    });
    if ((shop?.cards || []).length === 0) {
      const empty = document.createElement('p');
      empty.className = 'text-[11px] italic text-slate-500';
      empty.textContent = 'Sold out.';
      cardGrid.appendChild(empty);
    }

    relicGrid.replaceChildren();
    if (shop?.relic) {
      const relic = relicDatabase[shop.relic];
      if (relic) {
        const affordable = (tokens ?? 0) >= SHOP_PRICES.relic;
        const choice = document.createElement('button');
        choice.type = 'button';
        choice.disabled = !affordable;
        choice.className = affordable
          ? 'rounded-2xl border border-amber-300/40 bg-gradient-to-br from-amber-400/15 to-slate-950/80 p-4 text-left transition hover:border-amber-200 hover:bg-amber-400/20'
          : 'rounded-2xl border border-white/10 bg-black/25 p-4 text-left opacity-50 cursor-not-allowed';
        const name = document.createElement('span');
        name.className = 'block font-display text-sm font-black text-amber-200 mb-1';
        name.textContent = `✦ ${relic.name}`;
        const description = document.createElement('span');
        description.className = 'block text-xs leading-relaxed text-slate-300';
        description.textContent = relic.description;
        const price = document.createElement('span');
        price.className = 'mt-2 block font-display text-[10px] font-black text-amber-200';
        price.textContent = `BUY ${SHOP_PRICES.relic} 🪙`;
        choice.append(name, description, price);
        if (affordable) choice.addEventListener('click', () => onBuyShopRelic());
        relicGrid.appendChild(choice);
      }
    } else {
      const empty = document.createElement('p');
      empty.className = 'text-[11px] italic text-slate-500';
      const unownedRemain = Object.keys(relicDatabase)
        .some((id) => !relicDatabase[id].leaderId && !state?.relics.includes(id));
      empty.textContent = unownedRemain ? 'Sold out.' : 'No relics left to buy.';
      relicGrid.appendChild(empty);
    }

    const canCut = state ? state.masterDeck.length > 1 : false;
    const removalAffordable = (tokens ?? 0) >= SHOP_PRICES.removal && !shop?.removalUsed && canCut;
    removalButton.disabled = !removalAffordable;
    removalButton.textContent = shop?.removalUsed
      ? 'REMOVAL USED'
      : `✂️ REMOVE 1 CARD (${SHOP_PRICES.removal} 🪙)`;
    removalButton.className = removalAffordable
      ? 'px-3 py-2 rounded-xl border border-rose-300/40 bg-rose-500/15 font-display text-[10px] font-bold text-rose-100 transition hover:bg-rose-500/25'
      : 'px-3 py-2 rounded-xl border border-white/10 bg-white/5 font-display text-[10px] font-bold text-slate-500 cursor-not-allowed';
    removalButton.onclick = () => showShopCutPicker();

    const healAffordable = Boolean(state) &&
      (tokens ?? 0) >= SHOP_PRICES.heal &&
      !shop?.healUsed &&
      state.player.hp < state.player.maxHp;
    healButton.disabled = !healAffordable;
    healButton.textContent = shop?.healUsed
      ? 'PATCH-UP USED'
      : `💖 HEAL +${SHOP_HEAL_AMOUNT} HP (${SHOP_PRICES.heal} 🪙)`;
    healButton.className = healAffordable
      ? 'px-3 py-2 rounded-xl border border-emerald-300/40 bg-emerald-500/15 font-display text-[10px] font-bold text-emerald-100 transition hover:bg-emerald-500/25'
      : 'px-3 py-2 rounded-xl border border-white/10 bg-white/5 font-display text-[10px] font-bold text-slate-500 cursor-not-allowed';
    healButton.onclick = healAffordable ? () => onBuyShopHeal() : null;
  }

  function showShopCutPicker() {
    const state = getState();
    const cutSection = document.getElementById('shopCutSection');
    const cutGrid = document.getElementById('shopCutGrid');
    const cardDatabase = getCardDatabase();
    if (!cutSection || !cutGrid || !state) return;
    cutGrid.replaceChildren();
    state.masterDeck.forEach((instance) => {
      const card = cardDatabase[instance.cardId];
      if (!card || state.masterDeck.length <= 1) return;
      const choice = document.createElement('button');
      choice.type = 'button';
      choice.className = 'rounded-2xl border border-rose-300/30 bg-black/25 p-2 text-left transition hover:border-rose-200 hover:bg-rose-500/10';
      choice.appendChild(createCardElement(card, true, -1, instance));
      choice.addEventListener('click', () => {
        cutSection.classList.add('hidden');
        onBuyShopRemoval(instance.instanceId);
      });
      cutGrid.appendChild(choice);
    });
    cutSection.classList.remove('hidden');
    cutSection.scrollIntoView({ block: 'nearest' });
  }

  function closeTourRoutingModal() {
    document.getElementById('tourRoutingModal')?.classList.add('hidden');
  }

  function openTourEventModal(event, options, masterDeck) {
    const modal = document.getElementById('tourEventModal');
    const heading = document.getElementById('tourEventHeading');
    const description = document.getElementById('tourEventDescription');
    const grid = document.getElementById('tourEventChoices');
    const cutSection = document.getElementById('tourEventCutSection');
    const cutGrid = document.getElementById('tourEventCutGrid');
    if (!modal || !heading || !description || !grid) return;
    heading.textContent = `${event.icon} ${event.name}`;
    description.textContent = event.description;
    cutSection?.classList.add('hidden');
    cutGrid?.replaceChildren();
    grid.replaceChildren();
    (Array.isArray(options) ? options : []).forEach((option) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'group flex items-center gap-3 rounded-2xl border border-white/15 bg-black/30 p-3 text-left transition hover:border-fuchsia-300/70 hover:bg-fuchsia-400/10';
      const title = document.createElement('span');
      title.className = 'min-w-0 flex-1';
      const name = document.createElement('span');
      name.className = 'block font-display text-sm font-black text-white';
      name.textContent = option.label;
      const summary = document.createElement('span');
      summary.className = 'block text-[11px] leading-snug text-slate-300';
      summary.textContent = option.summary;
      title.append(name, summary);
      const tag = document.createElement('span');
      tag.className = 'shrink-0 rounded-full border border-fuchsia-300/40 bg-fuchsia-400/10 px-2 py-1 font-display text-[8px] font-black text-fuchsia-200';
      tag.textContent = option.tag;
      card.append(title, tag);
      card.addEventListener('click', () => {
        if (option.id === 'wardrobe_purge') {
          showEventCutPicker(event, masterDeck);
          return;
        }
        onChooseEventOption(event.id, option.id);
      });
      grid.appendChild(card);
    });
    modal.classList.remove('hidden');
  }

  function showEventCutPicker(event, masterDeck) {
    const cutSection = document.getElementById('tourEventCutSection');
    const cutGrid = document.getElementById('tourEventCutGrid');
    const cardDatabase = getCardDatabase();
    if (!cutSection || !cutGrid) {
      onChooseEventOption(event.id, 'wardrobe_purge');
      return;
    }
    cutGrid.replaceChildren();
    masterDeck.forEach((instance) => {
      const card = cardDatabase[instance.cardId];
      if (!card || masterDeck.length <= 1) return;
      const choice = document.createElement('button');
      choice.type = 'button';
      choice.className = 'rounded-2xl border border-rose-300/30 bg-black/25 p-2 text-left transition hover:border-rose-200 hover:bg-rose-500/10';
      choice.appendChild(createCardElement(card, true, -1, instance));
      choice.addEventListener('click', () => onRemoveEventCard(instance.instanceId));
      cutGrid.appendChild(choice);
    });
    cutSection.classList.remove('hidden');
    cutSection.scrollIntoView({ block: 'nearest' });
  }

  function closeTourEventModal() {
    document.getElementById('tourEventModal')?.classList.add('hidden');
    document.getElementById('tourEventCutSection')?.classList.add('hidden');
  }

  function openDraftModal(cardIds, relicIds, masterDeck, rewardMode = null) {
    const modal = document.getElementById('draftModal');
    const cardGrid = document.getElementById('draftChoicesGrid');
    const relicGrid = document.getElementById('relicChoicesGrid');
    const upgradeGrid = document.getElementById('upgradeChoicesGrid');
    document.getElementById('draftHealText').textContent =
      `+${(getState()?.encoreLevel ?? 0) >= 2 ? 12 : 18} HP`;
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
    const routedTab = rewardMode && tabs.some(([mode, available]) => mode === rewardMode && available)
      ? rewardMode
      : null;
    const effectiveMode = routedTab || null;
    ['cards', 'relics', 'upgrades'].forEach((mode) => {
      const tab = tabs.find(([name]) => name === mode);
      const visible = tab ? (effectiveMode ? tab[0] === effectiveMode : tab[1]) : false;
      document.querySelector(`[data-reward-tab="${mode}"]`).classList.toggle('hidden', !visible);
    });
    const defaultTab = effectiveMode || tabs.find(([, available]) => available)?.[0];
    if (!defaultTab) throw new Error('No post-battle rewards are available.');
    setRewardTab(defaultTab);
    modal.classList.remove('hidden');
  }

  function setChangelog(changelog) {
    document.getElementById('versionText').textContent = changelog.currentVersion;
    const entries = document.getElementById('changelogEntries');
    renderChangelogEntries(entries, changelog);
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
    const endVoice = pickVoiceLine(isVictory ? 'victory' : 'defeat');
    if (endVoice) showRunEndVoice(endVoice.speaker, endVoice.text);

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
    document.getElementById('receiptTokens').textContent =
      String(state.merchTokens ?? 0);
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
    document.getElementById('shareStatus').textContent = '';
    const deathSection = document.getElementById('deathLogSection');
    const deathList = document.getElementById('deathLogList');
    if (!isVictory && deathSection && deathList) {
      const entries = getDeathLogEntries(state.logs, 8);
      deathList.replaceChildren();
      entries.forEach((entry) => {
        const item = document.createElement('li');
        const turn = document.createElement('span');
        turn.className = 'text-[9px] font-display text-slate-500 mr-1';
        turn.textContent = `[T${entry.turn}]`;
        const text = document.createElement('span');
        text.textContent = entry.text;
        item.append(turn, text);
        item.className = entry.colorClass || 'text-slate-300';
        deathList.appendChild(item);
      });
      const empty = document.createElement('li');
      if (entries.length === 0) {
        empty.textContent = 'No combat actions were logged.';
        empty.className = 'text-slate-500 italic';
        deathList.appendChild(empty);
      }
      deathSection.classList.remove('hidden');
    } else if (deathSection) {
      deathSection.classList.add('hidden');
    }
    modal.classList.remove('hidden');
  }

  let voiceBubbleTimer = null;

  function showVoiceLine(speaker, text, durationMs = 2600) {
    const bubble = document.getElementById('voiceBubble');
    const speakerEl = document.getElementById('voiceSpeaker');
    const textEl = document.getElementById('voiceText');
    if (!bubble || !speakerEl || !textEl) return;
    speakerEl.textContent = speaker;
    textEl.textContent = `“${text}”`;
    bubble.classList.remove('hidden');
    if (voiceBubbleTimer) clearTimeout(voiceBubbleTimer);
    voiceBubbleTimer = setTimeout(() => bubble.classList.add('hidden'), durationMs);
  }

  function showRunEndVoice(speaker, text) {
    const el = document.getElementById('runEndVoice');
    if (!el) return;
    el.textContent = `${speaker}: “${text}”`;
    el.classList.remove('hidden');
  }

  function openConsentModal(suggestedName) {
    const modal = document.getElementById('consentModal');
    const input = document.getElementById('consentNameInput');
    if (!modal) return;
    if (input && !input.value) input.value = suggestedName;
    modal.classList.remove('hidden');
  }

  function closeConsentModal() {
    document.getElementById('consentModal')?.classList.add('hidden');
  }

  function showReceiptCopyStatus(message) {
    document.getElementById('receiptCopyStatus').textContent = message;
  }

  function showShareStatus(message) {
    const el = document.getElementById('shareStatus');
    if (el) el.textContent = message;
  }

  function openPileModal(title, cardInstances) {
    const cardDatabase = getCardDatabase();
    document.getElementById('pileModalTitle').textContent = `${title} (${cardInstances.length})`;
    const grid = document.getElementById('pileModalGrid');
    const spotlight = cardInstances.length === 1;
    grid.className = spotlight
      ? 'pile-spotlight grid grid-cols-1 justify-items-center gap-3 overflow-y-auto pr-1'
      : 'grid grid-cols-2 sm:grid-cols-4 gap-3 overflow-y-auto pr-1';
    grid.innerHTML = '';
    cardInstances.forEach((instance) => {
      const card = cardDatabase[instance.cardId];
      if (!card) return;
      if (spotlight) {
        const frame = document.createElement('div');
        frame.className = 'w-full max-w-64 sm:max-w-72';
        frame.appendChild(createCardElement(card, true, -1, instance));
        grid.appendChild(frame);
      } else {
        grid.appendChild(createCardElement(card, true, -1, instance));
      }
    });
    document.getElementById('pileModal').classList.remove('hidden');
  }

  function hideRunModals() {
    document.getElementById('runEndModal').classList.add('hidden');
    document.getElementById('draftModal').classList.add('hidden');
    document.getElementById('tourRoutingModal')?.classList.add('hidden');
    document.getElementById('tourEventModal')?.classList.add('hidden');
    document.getElementById('leaderboardModal')?.classList.add('hidden');
    document.getElementById('consentModal')?.classList.add('hidden');
    document.getElementById('missionsModal')?.classList.add('hidden');
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
  document.getElementById('btnCloseMissions')?.addEventListener('click', progressionUI.hideMissions);
  document.getElementById('btnMissions')?.addEventListener('click', progressionUI.showMissions);
  document.getElementById('btnMenuMissions')?.addEventListener('click', progressionUI.showMissions);
  document.getElementById('btnLeaderboard')?.addEventListener('click', progressionUI.showLeaderboard);
  document.getElementById('btnMenuLeaderboard')?.addEventListener('click', progressionUI.showLeaderboard);
  document.getElementById('btnCloseLeaderboard')?.addEventListener('click', progressionUI.hideLeaderboard);
  document.getElementById('btnConsentShare')?.addEventListener('click', () => {
    onConsentShare(document.getElementById('consentNameInput')?.value || '');
  });
  document.getElementById('btnConsentSkip')?.addEventListener('click', () => onConsentSkip());
  document.getElementById('btnConsentOptOut')?.addEventListener('click', () => onConsentOptOut());
  document.getElementById('btnArtStudio').addEventListener('click', progressionUI.showArtStudio);
  document.getElementById('btnMenuArtStudio').addEventListener('click', progressionUI.showArtStudio);
  document.getElementById('btnCopyReceipt').addEventListener('click', onCopyReceipt);
  document.getElementById('btnNewWorldTour').addEventListener('click', () => {
    progressionUI.openLeaderSelection(false, null, true);
  });
  document.getElementById('btnContinueTour').addEventListener('click', onContinueTour);
  document.getElementById('btnCloseArtStudio').addEventListener('click', () => {
    document.getElementById('artStudioModal').classList.add('hidden');
  });
  document.getElementById('btnCancelLeaderSelection').addEventListener('click', () => {
    document.getElementById('leaderSelectionModal').classList.add('hidden');
  });
  document.getElementById('btnCancelEventCut')?.addEventListener('click', () => {
    document.getElementById('tourEventCutSection')?.classList.add('hidden');
  });
  document.getElementById('btnToggleBattleLog').addEventListener('click', () => {
    const panel = document.getElementById('battleLogPanel');
    setBattleLogCollapsed(!panel.classList.contains('battle-log-collapsed'));
  });
  setBattleLogCollapsed(window.matchMedia('(max-width: 640px)').matches);

  // One-time static guides (member combos, keywords): rendered at UI init so
  // How to Play is complete even before the first combat render runs. The
  // per-frame renderAll() path no longer rebuilds them.
  renderComboReference();

  return {
    hideRunModals,
    showMainMenu: progressionUI.showMainMenu,
    hideMainMenu: progressionUI.hideMainMenu,
    openLeaderSelection: progressionUI.openLeaderSelection,
    openConsentModal,
    closeConsentModal,
    showLeaderboard: progressionUI.showLeaderboard,
    hideLeaderboard: progressionUI.hideLeaderboard,
    openDraftModal,
    openTourRoutingModal,
    closeTourRoutingModal,
    openTourEventModal,
    closeTourEventModal,
    openBuffReplaceModal,
    closeBuffReplaceModal,
    openPileModal,
    renderAll,
    setChangelog,
    showArtStudio: progressionUI.showArtStudio,
    showMissions: progressionUI.showMissions,
    hideMissions: progressionUI.hideMissions,
    showRunEndModal,
    showReceiptCopyStatus,
    showShareStatus,
    showSaveNotice,
    showVoiceLine,
    showRunEndVoice,
    getSelectedLeader: progressionUI.getSelectedLeader,
    getSelectedEncoreLevel: progressionUI.getSelectedEncoreLevel,
    spawnPopup,
    triggerKaijuHitAnim,
    triggerScreenShake
  };
}
