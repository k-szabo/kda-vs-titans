import { KEYBIND_ACTIONS, normalizeKeybinds, rebindKey } from './keybinds.js';
import { renderChangelogEntries } from './changelog-ui.js';

export function createOptionsUI({
  getSettings,
  defaultKeybinds,
  getProfileStats,
  getEncounters,
  getAllEncounters,
  onSettingsChange,
  onPlayerNameChange,
  isSoundSupported,
  onTestSound,
  changelog
}) {
  const optionsModal = document.getElementById('optionsModal');
  const howToPlayModal = document.getElementById('howToPlayModal');
  const keybindGrid = document.getElementById('keybindGrid');
  let listeningAction = null;

  function getNormalizedSettings() {
    const settings = getSettings();
    return {
      soundEnabled: settings.soundEnabled,
      keybinds: normalizeKeybinds(settings.keybinds, defaultKeybinds)
    };
  }

  function renderCodex() {
    const profileStats = getProfileStats();
    const encounters = getEncounters();
    const allEncounters = getAllEncounters();
    document.getElementById('optionsHighestWave').textContent =
      `${profileStats.highestWaveCleared} / ${encounters.length}`;
    document.getElementById('optionsFastestWin').textContent = profileStats.fastestWinMs === null
      ? '—'
      : `${Math.floor(profileStats.fastestWinMs / 60000)}m ${Math.floor((profileStats.fastestWinMs % 60000) / 1000)}s`;


    const unlocked = new Set(profileStats.unlockedKaiju);
    const grid = document.getElementById('optionsCodexGrid');
    grid.replaceChildren();
    allEncounters.forEach((encounter) => {
      const cleared = unlocked.has(encounter.id);
      const entry = document.createElement('div');
      entry.className = `rounded-xl border p-3 ${cleared ? 'border-sky-400/35 bg-sky-500/10' : 'border-white/10 bg-black/25'}`;
      const wave = document.createElement('span');
      wave.className = 'block font-display text-[9px] tracking-widest text-slate-400';
      wave.textContent = `WAVE ${encounter.slot ?? '?'} // ${cleared ? 'CONTAINED' : 'UNKNOWN'}`;
      const name = document.createElement('span');
      name.className = `block font-display text-xs font-bold ${cleared ? 'text-sky-200' : 'text-slate-500'}`;
      name.textContent = cleared ? encounter.name : 'UNDISCOVERED KAIJU';
      entry.append(wave, name);
      grid.appendChild(entry);
    });
  }

  function renderSettings() {
    const settings = getNormalizedSettings();
    const nameInput = document.getElementById('optionsPlayerName');
    if (nameInput && document.activeElement !== nameInput) {
      nameInput.value = getProfileStats().playerName || '';
    }
    document.getElementById('playerNameStatus').textContent = '';
    const soundButton = document.getElementById('btnToggleSound');
    const supported = isSoundSupported();
    soundButton.disabled = !supported;
    soundButton.setAttribute('aria-pressed', String(settings.soundEnabled));
    soundButton.textContent = supported
      ? `${settings.soundEnabled ? '🔊 SOUND ON' : '🔇 SOUND OFF'}`
      : '🔇 SOUND UNAVAILABLE';
    soundButton.classList.toggle('opacity-50', !supported);
    soundButton.classList.toggle('cursor-not-allowed', !supported);
    const shareButton = document.getElementById('btnToggleShare');
    if (shareButton) {
      shareButton.setAttribute('aria-pressed', String(settings.shareScores !== false));
      shareButton.textContent = `${settings.shareScores !== false ? '🏆 SHARE ON' : '🚫 SHARE OFF'}`;
    }
    document.getElementById('keybindHint').textContent =
      `Cards ${settings.keybinds.card1}/${settings.keybinds.card2}/${settings.keybinds.card3}/${settings.keybinds.card4}/${settings.keybinds.card5}` +
      ` • ${displayKey(settings.keybinds.endTurn)} End Turn` +
      ` • ${displayKey(settings.keybinds.jointFinale)} Finale` +
      ` • ${displayKey(settings.keybinds.leaderAbility)} Ability`;

    keybindGrid.replaceChildren();
    KEYBIND_ACTIONS.forEach(({ id, label }) => {
      const row = document.createElement('div');
      row.className = 'flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/25 px-3 py-2';
      const name = document.createElement('span');
      name.className = 'text-xs text-slate-200';
      name.textContent = label;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'min-w-20 rounded-lg border border-cyan-300/30 bg-cyan-400/10 px-3 py-1.5 font-display text-[10px] font-bold text-cyan-100 hover:bg-cyan-400/20';
      button.textContent = listeningAction === id ? 'PRESS A KEY…' : displayKey(settings.keybinds[id]);
      button.setAttribute('aria-label', `Change ${label} key`);
      button.setAttribute('aria-pressed', String(listeningAction === id));
      button.addEventListener('click', () => {
        listeningAction = id;
        document.getElementById('keybindStatus').textContent = `Press a key for ${label}. Escape cancels.`;
        renderSettings();
      });
      row.append(name, button);
      keybindGrid.appendChild(row);
    });
  }

  function renderRunHistory() {
    const grid = document.getElementById('optionsRunHistory');
    grid.replaceChildren();
    const history = Array.isArray(getProfileStats().runHistory) ? getProfileStats().runHistory : [];
    if (history.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'text-[11px] text-slate-500';
      empty.textContent = 'No tours yet — finish a run and it will show up here.';
      grid.appendChild(empty);
      return;
    }
    history.forEach((entry) => {
      const item = document.createElement('details');
      item.className = 'rounded-xl border border-white/10 bg-black/30 px-3 py-2';
      const summary = document.createElement('summary');
      summary.className = 'cursor-pointer font-display text-[11px] font-bold text-slate-200';
      const mins = Math.floor((entry.durationMs || 0) / 60000);
      const secs = Math.floor(((entry.durationMs || 0) % 60000) / 1000);
      summary.textContent = `${entry.victory ? '🏆' : '💀'} ${entry.date || ''} · ${(entry.leader || '').toUpperCase()} · ${entry.victory ? '10/10' : `${entry.waves || 0}/10`} · ${mins}m ${secs}s`;
      const receipt = document.createElement('pre');
      receipt.className = 'mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-[10px] leading-relaxed text-slate-300';
      receipt.textContent = entry.receipt || '—';
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'mt-2 rounded-lg border border-white/15 bg-white/5 px-3 py-1 font-display text-[9px] font-bold text-slate-200 hover:bg-white/10';
      copy.textContent = 'COPY RECEIPT';
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(entry.receipt || '');
          copy.textContent = 'COPIED ✓';
          setTimeout(() => { copy.textContent = 'COPY RECEIPT'; }, 1500);
        } catch {
          copy.textContent = 'COPY FAILED';
          setTimeout(() => { copy.textContent = 'COPY RECEIPT'; }, 1500);
        }
      });
      item.append(summary, receipt, copy);
      grid.appendChild(item);
    });
  }

  function showOptions() {
    listeningAction = null;
    renderSettings();
    renderCodex();
    renderRunHistory();
    optionsModal.classList.remove('hidden');
  }

  function hideOptions() {
    listeningAction = null;
    document.getElementById('keybindStatus').textContent = '';
    optionsModal.classList.add('hidden');
    renderSettings();
  }

  function showHowToPlay() {
    howToPlayModal.classList.remove('hidden');
  }

  function hideHowToPlay() {
    howToPlayModal.classList.add('hidden');
  }

  function handleKeydown(event) {
    if (optionsModal.classList.contains('hidden')) {
      if (!howToPlayModal.classList.contains('hidden') && event.key === 'Escape') {
        event.preventDefault();
        hideHowToPlay();
      }
      return;
    }
    if (listeningAction) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === 'Escape') {
        listeningAction = null;
        document.getElementById('keybindStatus').textContent = 'Key change cancelled.';
        renderSettings();
        return;
      }

      const result = rebindKey(
        getSettings().keybinds,
        listeningAction,
        event.key,
        defaultKeybinds
      );
      if (!result) {
        document.getElementById('keybindStatus').textContent = 'Choose a single printable key.';
        return;
      }
      const action = listeningAction;
      const label = KEYBIND_ACTIONS.find(({ id }) => id === action).label;
      listeningAction = null;
      onSettingsChange({
        ...getSettings(),
        keybinds: result.keybinds
      });
      document.getElementById('keybindStatus').textContent = result.swappedAction
        ? `${label} updated; the existing binding was swapped.`
        : `${label} updated.`;
      renderSettings();
      return;
    }

    if (event.key === 'Escape') hideOptions();
  }

  function cleanBoardName(raw) {
    const clean = typeof raw === 'string' ? raw.trim() : '';
    const length = Array.from(clean).length;
    if (length < 3 || length > 16) return null;
    if (!/^[\p{L}\p{N} _-]+$/u.test(clean)) return null;
    return clean;
  }

  document.getElementById('btnCloseOptions').addEventListener('click', hideOptions);
  document.getElementById('btnCloseHowToPlay').addEventListener('click', hideHowToPlay);
  document.getElementById('btnToggleSound').addEventListener('click', () => {
    const settings = getSettings();
    const soundEnabled = !settings.soundEnabled;
    onSettingsChange({ ...settings, soundEnabled });
    if (soundEnabled) onTestSound();
  });
  document.getElementById('btnToggleShare')?.addEventListener('click', () => {
    const settings = getSettings();
    onSettingsChange({ ...settings, shareScores: settings.shareScores === false });
  });
  document.getElementById('btnResetKeybinds').addEventListener('click', () => {    onSettingsChange({
      ...getSettings(),
      keybinds: { ...defaultKeybinds }
    });
    listeningAction = null;
    document.getElementById('keybindStatus').textContent = 'Default keybinds restored.';
    renderSettings();
  });
  document.getElementById('btnSavePlayerName')?.addEventListener('click', () => {
    const statusEl = document.getElementById('playerNameStatus');
    const clean = cleanBoardName(document.getElementById('optionsPlayerName')?.value);
    if (!clean) {
      statusEl.textContent = 'Board name needs 3–16 characters: letters, numbers, space, _ or -.';
      return;
    }
    if (clean === getProfileStats().playerName) {
      statusEl.textContent = 'That is already your board name.';
      return;
    }
    onPlayerNameChange(clean);
    statusEl.textContent = `Board name updated to “${clean}” — your next daily submit keeps the same board row.`;
  });
  window.addEventListener('keydown', handleKeydown, true);
  renderChangelogEntries(document.getElementById('optionsChangelogEntries'), changelog);
  renderSettings();

  return {
    showOptions,
    hideOptions,
    showHowToPlay,
    hideHowToPlay,
    renderSettings,
    isListening: () => listeningAction !== null
  };
}

function displayKey(key) {
  return key === 'space' ? 'SPACE' : key.toUpperCase();
}
