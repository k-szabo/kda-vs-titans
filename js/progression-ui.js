import { getArtRank, getUnlockedArtStyles, LEADERS, LEADER_ART_STYLES } from './leader-data.js';
import { DAILY_MODIFIERS } from './daily-challenge.js';
import { getCardFinishLevel, getNextFinishLevel } from './card-finishes.js';

const MEMBER_ORDER = ['ahri', 'akali', 'evelynn', 'kaisa', 'squad'];

const ENCORE_TIERS = [
  { level: 0, name: 'Normal', description: 'Standard 10-wave setlist. No Encore modifiers.' },
  { level: 1, name: 'Encore 1', description: 'E1: Bosses have +15% maximum HP.' },
  { level: 2, name: 'Encore 2', description: 'E1–E2: Boss HP +15%; post-draft healing is only +12 HP.' },
  { level: 3, name: 'Encore 3', description: 'E1–E3: Boss HP +15%, heal +12, and bosses start with +1 Strength.' },
  { level: 4, name: 'Encore 4', description: 'E1–E4: All prior modifiers, plus one Stage Fright curse in the starter deck.' },
  { level: 5, name: 'Encore 5', description: 'E1–E5: Prior modifiers, +4 to interrupt thresholds, and boss Phase 2 begins at 60% HP.' }
];

export function createProgressionUI({
  getArtAssets,
  getLeaderArts,
  getCardDatabase,
  getRelicDatabase,
  getProfileStats,
  getEncounters,
  getDailyChallenge,
  onSelectLeaderArt,
  onUpgradeCardFinish
}) {
  let selectedLeader = LEADERS[0].id;
  let selectedEncoreLevel = 0;

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
      const nextLocked = LEADER_ART_STYLES.find((style) =>
        style.winsRequired !== undefined &&
        !unlockedStyles.some(({ id: unlockedId }) => unlockedId === style.id)
      );
      progress.textContent = nextLocked
        ? `${leaderWins} full ${leaderWins === 1 ? 'clear' : 'clears'} // ${nextLocked.winsRequired - leaderWins} more to ${nextLocked.name}`
        : `${leaderWins} full ${leaderWins === 1 ? 'clear' : 'clears'} // all art unlocked`;
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

    grid.appendChild(buildCardAtelier());

    document.getElementById('artStudioModal').classList.remove('hidden');
  }

  function buildCardAtelier() {
    const profileStats = getProfileStats();
    const cardDatabase = getCardDatabase();
    const shards = profileStats.finishTokens ?? 0;
    const section = document.createElement('section');
    section.className = 'rounded-2xl bg-black/35 border border-white/10 p-4';
    const heading = document.createElement('div');
    heading.className = 'flex flex-wrap items-baseline justify-between gap-2 mb-1';
    const title = document.createElement('h3');
    title.className = 'font-display text-sm font-black text-white';
    title.textContent = '✨ CARD ATELIER';
    const balance = document.createElement('p');
    balance.className = 'font-display text-xs font-black text-amber-200';
    balance.textContent = `${shards} ✦ SPOTLIGHT SHARDS`;
    heading.append(title, balance);
    const hint = document.createElement('p');
    hint.className = 'mb-3 text-[11px] text-slate-400';
    hint.textContent = 'Earn shards by clearing waves (+1) and tours (+3). Finishes are permanent: basic → shiny (2) → platinum (3) → holo (5).';
    section.append(heading, hint);

    const finishable = Object.values(cardDatabase).filter((card) => card.draftable !== false);
    MEMBER_ORDER.forEach((member) => {
      const group = finishable.filter((card) => card.member === member);
      if (group.length === 0) return;
      const groupTitle = document.createElement('h4');
      groupTitle.className = 'mt-3 mb-1.5 font-display text-[10px] font-black tracking-widest text-slate-300';
      groupTitle.textContent = member === 'squad' ? 'K/DA SQUAD' : member === 'kaisa' ? "KAI'SA" : member.toUpperCase();
      const rows = document.createElement('div');
      rows.className = 'grid gap-1.5';
      group.sort((a, b) => a.name.localeCompare(b.name)).forEach((card) => {
        const level = getCardFinishLevel(profileStats.cardFinishes, card.id);
        const next = getNextFinishLevel(level);
        const row = document.createElement('div');
        row.className = 'flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/25 px-3 py-2';
        const name = document.createElement('span');
        name.className = 'min-w-0 flex-1 truncate text-xs text-slate-200';
        const pips = [1, 2, 3].map((tier) => (tier <= level ? '●' : '○')).join('');
        name.textContent = `${card.name} ${pips}`;
        row.appendChild(name);
        if (!next) {
          const maxed = document.createElement('span');
          maxed.className = 'font-display text-[10px] font-black text-amber-200';
          maxed.textContent = 'HOLO MAX';
          row.appendChild(maxed);
        } else {
          const button = document.createElement('button');
          button.type = 'button';
          const affordable = shards >= next.cost;
          button.disabled = !affordable;
          button.className = affordable
            ? 'rounded-lg border border-amber-300/40 bg-amber-500/15 px-3 py-1.5 font-display text-[10px] font-bold text-amber-100 transition hover:bg-amber-500/25'
            : 'rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 font-display text-[10px] font-bold text-slate-500 cursor-not-allowed';
          button.textContent = `${next.name} · ${next.cost} ✦`;
          if (affordable) {
            button.addEventListener('click', () => {
              onUpgradeCardFinish(card.id);
              showArtStudio();
            });
          }
          row.appendChild(button);
        }
        rows.appendChild(row);
      });
      section.append(groupTitle, rows);
    });
    return section;
  }

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

  return {
    showMainMenu,
    hideMainMenu,
    showArtStudio,
    openLeaderSelection,
    getSelectedLeader: () => selectedLeader,
    getSelectedEncoreLevel: () => selectedEncoreLevel
  };
}
