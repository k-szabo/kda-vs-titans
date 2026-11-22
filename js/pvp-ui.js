// PvP lobby UI: host/join, room code, leader pick, ready states, coin flip.
// Stateless renderer: app.js owns the session and pushes view models via
// setState. No network here; callbacks go back to app.js.
import { LEADERS } from './leader-data.js';

const SCREENS = ['choice', 'lobby', 'relics', 'result'];

export function createPvpUI({ onHost, onJoin, onPickLeader, onReady, onLeave, onToggleRelic, onConfirmRelics, onRematch }) {
  const modal = () => document.getElementById('pvpModal');
  const body = () => document.getElementById('pvpModalBody');
  const status = () => document.getElementById('pvpModalStatus');
  let joinCode = '';
  let lastModel = null;

  function leaderButtons(model) {
    return LEADERS.map((leader) => {
      const selected = model.myLeader === leader.id;
      return `<button type="button" data-pvp-leader="${leader.id}" aria-pressed="${selected}"
        class="rounded-xl border px-3 py-2.5 font-display text-[11px] font-bold transition
        ${selected ? 'border-pink-300 bg-pink-500/25 text-white' : 'border-white/15 bg-white/5 text-slate-200 hover:bg-white/10'}">
        ${leader.name}</button>`;
    }).join('');
  }

  function render(model) {
    lastModel = model;
    const root = body();
    if (!root) return;
    if (model.screen === 'choice') {      root.innerHTML = `
        <div class="grid gap-3">
          <button type="button" data-pvp-action="host"
            class="rounded-xl border border-pink-300/50 bg-pink-500/15 px-4 py-3 text-left font-display text-sm font-black text-white hover:bg-pink-500/25">
            ⚔ HOST A DUEL
            <span class="mt-1 block text-xs font-normal text-slate-300">Get a 4-letter room code to share.</span>
          </button>
          <div class="rounded-xl border border-white/10 bg-black/25 p-3">
            <label for="pvpJoinCode" class="font-display text-[11px] font-black tracking-widest text-slate-300">JOIN WITH CODE</label>
            <div class="mt-2 flex gap-2">
              <input id="pvpJoinCode" maxlength="4" autocomplete="off" spellcheck="false" value="${joinCode}"
                class="w-full rounded-lg border border-white/15 bg-slate-950 px-3 py-2 font-display text-sm font-black uppercase tracking-[0.3em] text-white" placeholder="ABCD" />
              <button type="button" data-pvp-action="join"
                class="rounded-lg border border-cyan-300/40 bg-cyan-400/15 px-4 py-2 font-display text-xs font-black text-white hover:bg-cyan-400/25">JOIN</button>
            </div>
          </div>
        </div>`;
    } else if (model.screen === 'relics') {
      const picked = new Set(model.pickedRelics || []);
      const cards = (model.relicOptions || []).map((relic) => `
        <button type="button" data-pvp-relic="${relic.id}" aria-pressed="${picked.has(relic.id)}"
          class="rounded-xl border px-3 py-3 text-left transition
          ${picked.has(relic.id) ? 'border-emerald-300 bg-emerald-500/20' : 'border-white/15 bg-white/5 hover:bg-white/10'}">
          <span class="block font-display text-xs font-black text-white">${relic.name}</span>
          <span class="mt-1 block text-[11px] text-slate-300">${relic.description}</span>
        </button>`).join('');
      root.innerHTML = `
        <div class="grid gap-3">
          <p class="text-xs text-slate-300">Pick <strong>2 relics</strong> for the duel (${picked.size}/2).</p>
          <div class="grid gap-2">${cards}</div>
          <div class="flex gap-2">
            <button type="button" data-pvp-action="confirm-relics" ${picked.size === 2 ? '' : 'disabled'}
              class="flex-1 rounded-xl border border-emerald-300/40 bg-emerald-400/15 px-4 py-2.5 font-display text-xs font-black text-white hover:bg-emerald-400/25 disabled:cursor-not-allowed disabled:opacity-40">START DUEL</button>
            <button type="button" data-pvp-action="leave"
              class="rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 font-display text-xs font-bold text-slate-200 hover:bg-white/10">LEAVE</button>
          </div>
        </div>`;
    } else if (model.screen === 'result') {
      root.innerHTML = `
        <div class="grid gap-3 text-center">
          <div class="font-display text-2xl font-black ${model.won ? 'text-emerald-300' : 'text-rose-300'}">${model.won ? '🏆 DUEL WON!' : '💀 DUEL LOST'}</div>
          <p class="text-xs text-slate-300">Rounds: you ${model.myWins} — rival ${model.peerWins}.</p>
          <div class="flex gap-2">
            <button type="button" data-pvp-action="rematch"
              class="flex-1 rounded-xl border border-emerald-300/40 bg-emerald-400/15 px-4 py-2.5 font-display text-xs font-black text-white hover:bg-emerald-400/25">REMATCH</button>
            <button type="button" data-pvp-action="leave"
              class="rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 font-display text-xs font-bold text-slate-200 hover:bg-white/10">LEAVE</button>
          </div>
        </div>`;
    } else {
      const peerLine = model.peerPresent
        ? `Rival: <strong>${model.peerLeader ? model.peerLeader.toUpperCase() : 'choosing…'}</strong>${model.peerReady ? ' — READY ✓' : ''}`
        : 'Waiting for rival to join…';
      const canReady = Boolean(model.myLeader) && model.peerPresent && !model.iReady;
      root.innerHTML = `
        <div class="grid gap-3">
          <div class="rounded-xl border border-white/10 bg-black/30 p-3 text-center">
            <div class="text-[10px] font-display tracking-widest text-slate-400">ROOM CODE</div>
            <div class="font-display text-3xl font-black tracking-[0.3em] text-amber-200">${model.roomCode}</div>
            <div class="mt-1 text-[11px] text-slate-400">${peerLine}</div>
          </div>
          <div>
            <div class="mb-2 font-display text-[10px] font-black tracking-widest text-slate-300">YOUR LEADER</div>
            <div class="grid grid-cols-2 gap-2">${leaderButtons(model)}</div>
          </div>
          ${model.flip ? `<div class="rounded-xl border border-amber-300/40 bg-amber-400/10 p-3 text-center text-sm text-amber-100">🪙 ${model.flip === model.role ? 'You' : 'Rival'} (${model.flip}) take the first turn!</div>` : ''}
          <div class="flex gap-2">
            <button type="button" data-pvp-action="ready" ${canReady ? '' : 'disabled'}
              class="flex-1 rounded-xl border border-emerald-300/40 bg-emerald-400/15 px-4 py-2.5 font-display text-xs font-black text-white hover:bg-emerald-400/25 disabled:cursor-not-allowed disabled:opacity-40">
              ${model.iReady ? 'WAITING FOR RIVAL ✓' : 'READY TO DUEL'}</button>
            <button type="button" data-pvp-action="leave"
              class="rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 font-display text-xs font-bold text-slate-200 hover:bg-white/10">LEAVE</button>
          </div>
        </div>`;
    }
    status().textContent = model.error || model.hint || '';
    wire(model);
  }

  function wire(model) {
    const root = body();
    root.querySelector('[data-pvp-action="host"]')?.addEventListener('click', () => onHost());
    root.querySelector('[data-pvp-action="join"]')?.addEventListener('click', () => {
      joinCode = (root.querySelector('#pvpJoinCode')?.value || '').toUpperCase().trim();
      onJoin(joinCode);
    });
    root.querySelectorAll('[data-pvp-leader]').forEach((btn) => {
      btn.addEventListener('click', () => onPickLeader(btn.dataset.pvpLeader));
    });
    root.querySelector('[data-pvp-action="ready"]')?.addEventListener('click', () => onReady());
    root.querySelector('[data-pvp-action="leave"]')?.addEventListener('click', () => onLeave());
    root.querySelectorAll('[data-pvp-relic]').forEach((btn) => {
      btn.addEventListener('click', () => onToggleRelic(btn.dataset.pvpRelic));
    });
    root.querySelector('[data-pvp-action="confirm-relics"]')?.addEventListener('click', () => onConfirmRelics());
    root.querySelector('[data-pvp-action="rematch"]')?.addEventListener('click', () => onRematch());
  }

  document.getElementById('btnPvpClose')?.addEventListener('click', () => {
    modal().classList.add('hidden');
    onLeave();
  });

  return {
    show(choiceHint = '') {
      joinCode = '';
      modal().classList.remove('hidden');
      render({ screen: 'choice', hint: choiceHint });
    },
    hide() { modal().classList.add('hidden'); },
    setState(model) {
      if (!SCREENS.includes(model.screen)) model.screen = 'lobby';
      render(model);
    },
    setError(error) {
      if (lastModel) render({ ...lastModel, error });
      else status().textContent = error;
    }
  };
}
