// PvP lobby UI: host/join, room code, leader pick, ready states, coin flip.
// Stateless renderer: app.js owns the session and pushes view models via
// setState. No network here; callbacks go back to app.js.
import { LEADERS } from './leader-data.js';

const SCREENS = ['choice', 'lobby', 'flip', 'roundresult', 'result'];

export function createPvpUI({ onHost, onJoin, onPickLeader, onToggleRelic, onReady, onLeave, onStartDuel, onContinueRound, onRematch, onCopyCode }) {
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
    } else if (model.screen === 'flip') {
      const youFirst = model.first === 'me';
      root.innerHTML = `
        <div class="grid gap-3 text-center">
          <div class="rounded-xl border border-amber-300/40 bg-amber-400/10 p-5">
            <div class="text-4xl">🪙</div>
            <div class="mt-2 font-display text-xl font-black text-amber-100">${youFirst ? 'YOU START!' : 'RIVAL STARTS'}</div>
            <p class="mt-1 text-xs text-slate-300">Round ${model.round} — ${youFirst ? 'your' : 'rival’s'} turn first. Best of 3.</p>
          </div>
          <button type="button" data-pvp-action="start-duel"
            class="rounded-xl border border-emerald-300/40 bg-emerald-400/15 px-4 py-2.5 font-display text-xs font-black text-white hover:bg-emerald-400/25">⚔ START ROUND ${model.round}</button>
        </div>`;
    } else if (model.screen === 'roundresult') {
      root.innerHTML = `
        <div class="grid gap-3 text-center">
          <div class="rounded-xl border ${model.won ? 'border-emerald-300/40 bg-emerald-400/10' : 'border-rose-300/40 bg-rose-400/10'} p-5">
            <div class="text-4xl">${model.won ? '🏆' : '💀'}</div>
            <div class="mt-2 font-display text-xl font-black ${model.won ? 'text-emerald-100' : 'text-rose-100'}">ROUND ${model.round} — ${model.won ? 'YOU WON!' : 'RIVAL WON'}</div>
            <p class="mt-1 text-xs text-slate-300">You ${model.myWins} — ${model.peerWins} rival. Next round starts automatically…</p>
          </div>
          <button type="button" data-pvp-action="continue-round"
            class="rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 font-display text-xs font-bold text-slate-200 hover:bg-white/10">CONTINUE NOW</button>
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
      const pickedCount = (model.pickedRelics || []).length;
      const canReady = Boolean(model.myLeader) && pickedCount >= 2 && model.peerPresent && !model.iReady;
      root.innerHTML = `
        <div class="grid gap-3">
          <div class="rounded-xl border border-white/10 bg-black/30 p-3 text-center">
            <div class="text-[10px] font-display tracking-widest text-slate-400">ROOM CODE</div>
            <div class="font-display text-3xl font-black tracking-[0.3em] text-amber-200 select-text">${model.roomCode}</div>
            <button type="button" data-pvp-action="copy-code"
              class="mt-2 rounded-lg border border-amber-300/40 bg-amber-400/10 px-3 py-1.5 font-display text-[10px] font-bold text-amber-100 hover:bg-amber-400/20">📋 COPY CODE</button>
            <div class="mt-1 text-[11px] text-slate-400">${peerLine}</div>
          </div>
          <div>
            <div class="mb-2 font-display text-[10px] font-black tracking-widest text-slate-300">YOUR LEADER</div>
            <div class="grid grid-cols-2 gap-2">${leaderButtons(model)}</div>
          </div>
          <div>
            <div class="mb-2 font-display text-[10px] font-black tracking-widest text-slate-300">YOUR RELICS (PICK 2)</div>
            ${model.relicOptions && model.relicOptions.length > 0 ? `
            <div class="grid gap-2">${model.relicOptions.map((relic) => {
              const picked = (model.pickedRelics || []).includes(relic.id);
              return `<button type="button" data-pvp-relic="${relic.id}" aria-pressed="${picked}"
                class="rounded-xl border px-3 py-2.5 text-left transition
                ${picked ? 'border-emerald-300 bg-emerald-500/20' : 'border-white/15 bg-white/5 hover:bg-white/10'}">
                <span class="block font-display text-xs font-black text-white">${relic.name}</span>
                <span class="mt-0.5 block text-[11px] text-slate-300">${relic.description}</span>
              </button>`;
            }).join('')}</div>` : '<p class="text-[11px] text-slate-400">Pick a leader first to see relic options.</p>'}
          </div>
          ${model.flip ? `<div class="rounded-xl border border-amber-300/40 bg-amber-400/10 p-3 text-center text-sm text-amber-100">🪙 ${model.flip === model.role ? 'You' : 'Rival'} (${model.flip}) take the first turn!</div>` : ''}
          <div class="flex gap-2">
            <button type="button" data-pvp-action="ready" ${canReady ? '' : 'disabled'}
              class="flex-1 rounded-xl border border-emerald-300/40 bg-emerald-400/15 px-4 py-2.5 font-display text-xs font-black text-white hover:bg-emerald-400/25 disabled:cursor-not-allowed disabled:opacity-40">
              ${model.iReady ? 'WAITING FOR RIVAL ✓' : !model.myLeader ? 'PICK A LEADER' : pickedCount < 2 ? `PICK ${2 - pickedCount} MORE RELIC${pickedCount === 1 ? '' : 'S'}` : 'READY TO DUEL'}</button>
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
    root.querySelector('[data-pvp-action="copy-code"]')?.addEventListener('click', () => onCopyCode());
    root.querySelector('[data-pvp-action="start-duel"]')?.addEventListener('click', () => onStartDuel());
    root.querySelector('[data-pvp-action="continue-round"]')?.addEventListener('click', () => onContinueRound());
    root.querySelectorAll('[data-pvp-relic]').forEach((btn) => {
      btn.addEventListener('click', () => onToggleRelic(btn.dataset.pvpRelic));
    });
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
