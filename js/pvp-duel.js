// PvP duel: lobby, room flow, alternating-turn combat vs the remote snapshot.
// Created once via createPvpDuel(deps); the host app owns run state and the
// combat primitives, passed in as explicit dependencies (same pattern as
// shop.js / tour-events.js). All duel state is ephemeral, never saved.
import {
  generateRoomCode,
  isValidRoomCode,
  pvpCoinFlip,
  buildPvpDeck,
  pickPvpRelicOptions,
  createPvpActionLog,
  nextPvpAction
} from './pvp-protocol.js';
import { createPvpRoom, createSupabasePvpBus } from './pvp-net.js';
import { createPvpUI } from './pvp-ui.js';
import { getBoardConfig } from './leaderboard.js';
import { LEADERS } from './leader-data.js';
import { MAX_HAND_SIZE, createTurnMemberState, getWaveStrengthBonus } from './combat-rules.js';

const PVP_TURN_MS = 90000;
const PVP_HP = 80;
const PVP_DECK_SIZE = 20;

export function createPvpDuel(deps) {
  const {
    getState,
    setState,
    setMainMenuOpen,
    getCardDB,
    getRelicDB,
    getStarterDecks,
    getArtAssets,
    takeEndlessBoss,
    beginStage,
    shuffle,
    nextRandom,
    applyDamageToPlayer,
    discardBuffEntry,
    getBuffAmount,
    tickBuffsAtTurnStart,
    drawCards,
    applyRelicEffects,
    uiHideMainMenu,
    uiHideRunModals,
    addLog,
    renderAll
  } = deps;

  let pvp = null; // active duel session or null
  let pvpUI = null;

  const CARD_DB = () => getCardDB();
  const RELIC_DB = () => getRelicDB();

  // ---------------------------------------------------------------- lobby ---
  function pvpViewModel(hint = '', error = '') {
    if (!pvp) return { screen: 'choice', hint, error };
    return {
      screen: 'lobby',
      role: pvp.role,
      roomCode: pvp.roomCode,
      myLeader: pvp.myLeader,
      peerLeader: pvp.peerLeader,
      peerPresent: pvp.peerPresent,
      peerReady: pvp.peerReady,
      iReady: pvp.iReady,
      flip: pvp.flip,
      relicOptions: pvpRelicOptions(),
      pickedRelics: [...(pvp.relicPicks || [])],
      hint,
      error
    };
  }

  function pvpRelicOptions() {
    if (!pvp || !pvp.myLeader) return [];
    return pickPvpRelicOptions(pvp.roomCode, pvp.roundIndex, pvp.myLeader, RELIC_DB())
      .map((id) => ({ id, name: RELIC_DB()[id]?.name || id, description: RELIC_DB()[id]?.description || '' }));
  }

  async function createPvpSession(role, roomCode) {
    const config = await getBoardConfig();
    if (!config) {
      throw new Error('PvP needs the community board backend (Supabase) configured. Check Options → Leaderboard.');
    }
    const playerId = `pvp-${Math.random().toString(36).slice(2, 10)}`;
    const bus = await createSupabasePvpBus({
      roomCode,
      supabase: { url: config.url, publishableKey: config.publishableKey }
    });
    const session = {
      role, roomCode, playerId, bus, room: null,
      myLeader: null, peerLeader: null, peerPresent: false, peerReady: false,
      iReady: false, flip: null, roundIndex: 0, pendingEvents: [],
      relicPicks: [], relicIds: null, myWins: 0, peerWins: 0,
      rivalId: null, timerId: null, roundDecided: false, matchOver: false,
      actionLog: createPvpActionLog(), isMyTurn: false,
      duelStarted: false, duelTimer: null, roundTimer: null,
      rematchMe: false, rematchPeer: false, advancedFromRound: -1
    };
    session.room = createPvpRoom({
      roomCode, playerId, bus,
      onEvent: (event) => handlePvpEvent(session, event)
    });
    return session;
  }

  function handlePvpEvent(session, event) {
    if (session !== pvp) return; // stale session
    if (event.type === 'peers' || event.type === 'opponentReady') {
      const peer = (event.peers || []).find((p) => p.playerId !== session.playerId) ||
        (event.peer && event.peer.playerId !== session.playerId ? event.peer : null);
      session.peerPresent = Boolean(peer);
      session.peerLeader = peer?.leader || null;
      session.peerReady = peer?.ready === true;
      if (peer) session.rivalId = peer.playerId;
      if (session.peerPresent && !session.flip) checkPvpStart(session);
      if (!session.flip) {
        pvpUI?.setState(pvpViewModel(session.peerPresent ? '' : 'Waiting for rival to join…'));
      }
    } else if (event.type === 'opponentLeft') {
      session.peerPresent = false;
      session.peerLeader = null;
      session.peerReady = false;
      const state = getState();
      if (state && state.runStatus === 'pvp' && !session.matchOver) {
        session.myWins = 2;
        addLog('🏳️ Rival disconnected — duel awarded to you.', 'text-amber-300 font-bold');
        pvpEndMatch(true);
      } else {
        pvpUI?.setState(pvpViewModel('Rival left. Share the code again or leave.'));
      }
    } else if (event.type === 'action') {
      if (session.matchOver) return;
      const action = event.action;
      if (!action) return;
      pvpAdoptScore(action.payload?.score);
      if (session.roundDecided || action.payload?.round !== session.roundIndex) return;
      if (action.type === 'cardPlayed') applyRemoteCardPlayed(action.payload);
      else if (action.type === 'turnEnded') pvpOnTurnEnded(action.payload);
      else if (action.type === 'roundEnd') pvpOnRoundEnd(action.payload);
      else if (action.type === 'rematch') pvpOnRematch();
    } else if (event.type === 'snapshot') {
      if (session.matchOver || session.roundDecided) return;
      pvpAdoptScore(event.snapshot?.score);
      if (event.snapshot?.round !== session.roundIndex) return;
      pvpAdoptSnapshot(event.snapshot);
      renderAll();
    } else if (event.type === 'snapshotRequested') {
      if (session.matchOver || session.roundDecided) return;
      session.room.sendSnapshot({
        ...pvpFullSnapshot(),
        round: session.roundIndex,
        score: { me: session.myWins, rival: session.peerWins }
      }, session.actionLog.nextSeq);
    } else if (event.type === 'resync') {
      addLog('🔄 Sync gap — requesting full state…', 'text-slate-400');
    }
  }

  function checkPvpStart(session) {
    if (session.flip || !session.iReady || !session.peerReady) return false;
    if (!session.myLeader || !session.peerLeader) return false;
    if ((session.relicPicks || []).length !== 2) return false;
    session.flip = pvpCoinFlip(session.roomCode, session.roundIndex);
    session.relicIds = [...session.relicPicks];
    session.room.start();
    session.duelStarted = false;
    const first = session.flip === session.role ? 'me' : 'rival';
    pvpUI?.show('');
    pvpUI?.setState({ screen: 'flip', first, round: session.roundIndex + 1 });
    addLog(`🪙 Coin flip: ${session.flip} — ${first === 'me' ? 'you' : 'rival'} take${first === 'me' ? '' : 's'} the first turn!`, 'text-amber-300 font-bold');
    clearTimeout(session.duelTimer);
    session.duelTimer = setTimeout(() => startPvpDuel(), 3000);
    return true;
  }

  function startPvpDuel() {
    if (!pvp || pvp.duelStarted) return;
    pvp.duelStarted = true;
    clearTimeout(pvp.duelTimer);
    startPvpRound();
  }

  function continuePvpRound() {
    if (!pvp || pvp.matchOver) return;
    // Timer and CONTINUE button race — advance exactly once per round.
    if (pvp.advancedFromRound === pvp.roundIndex) return;
    pvp.advancedFromRound = pvp.roundIndex;
    clearTimeout(pvp.roundTimer);
    pvp.roundIndex += 1;
    pvp.roundDecided = false;
    pvp.duelStarted = false;
    pvp.flip = pvpCoinFlip(pvp.roomCode, pvp.roundIndex);
    const first = pvp.flip === pvp.role ? 'me' : 'rival';
    pvpUI?.show('');
    pvpUI?.setState({ screen: 'flip', first, round: pvp.roundIndex + 1 });
    addLog(`🪙 Round ${pvp.roundIndex + 1} coin: ${first === 'me' ? 'you' : 'rival'} start${first === 'me' ? '' : 's'}!`, 'text-amber-300 font-bold');
    clearTimeout(pvp.duelTimer);
    pvp.duelTimer = setTimeout(() => startPvpDuel(), 3000);
  }

  function togglePvpRelic(relicId) {
    if (!pvp || !RELIC_DB()[relicId]) return;
    pvp.relicPicks = (pvp.relicPicks || []).filter((id) => id !== relicId);
    if (pvp.relicPicks.length < 2 && !pvp.relicPicks.includes(relicId)) pvp.relicPicks.push(relicId);
    pvpUI?.setState(pvpViewModel(''));
  }

  function rematchPvp() {
    if (!pvp || !pvp.matchOver || pvp.rematchMe) return;
    pvp.rematchMe = true;
    pvpSend('rematch', {});
    if (pvp.rematchPeer) {
      doRematchReset();
    } else {
      pvpUI?.show('');
      pvpUI?.setState(pvpViewModel('Rematch sent — waiting for rival…'));
    }
  }

  function pvpOnRematch() {
    if (!pvp || !pvp.matchOver) return;
    if (pvp.rematchMe) {
      doRematchReset();
    } else {
      pvp.rematchPeer = true;
      pvpUI?.show('');
      pvpUI?.setState({ screen: 'result', won: pvp.myWins >= 2, myWins: pvp.myWins, peerWins: pvp.peerWins, hint: 'Rival wants a rematch — hit REMATCH to accept!' });
    }
  }

  function doRematchReset() {
    pvp.myWins = 0;
    pvp.peerWins = 0;
    pvp.advancedFromRound = -1;
    pvp.roundIndex = 0;
    pvp.roundDecided = false;
    pvp.matchOver = false;
    pvp.relicPicks = [];
    pvp.relicIds = null;
    pvp.flip = null;
    pvp.duelStarted = false;
    pvp.rematchMe = false;
    pvp.rematchPeer = false;
    pvp.iReady = false;
    try {
      pvp.room.setReady(false, pvp.myLeader);
    } catch { /* presence update is best-effort */ }
    pvpUI?.show('');
    pvpUI?.setState(pvpViewModel('Rematch! Pick relics and ready up.'));
  }

  async function hostPvpDuel() {
    try {
      pvpUI?.setState({ screen: 'lobby', role: 'host', roomCode: '…', hint: 'Opening room…' });
      pvp = await createPvpSession('host', generateRoomCode());
      pvp.room.join(null);
      pvpUI?.setState(pvpViewModel('Share the code with your rival.'));
    } catch (error) {
      pvp = null;
      pvpUI?.setError(error?.message || 'Could not open the duel room.');
    }
  }

  async function joinPvpDuel(code) {
    if (!isValidRoomCode(code)) {
      pvpUI?.setError('Enter the 4-letter room code.');
      return;
    }
    try {
      pvpUI?.setState({ screen: 'lobby', role: 'guest', roomCode: code, hint: 'Joining…' });
      pvp = await createPvpSession('guest', code);
      pvp.room.join(null);
      pvpUI?.setState(pvpViewModel('Joined! Pick your leader.'));
    } catch (error) {
      pvp = null;
      pvpUI?.setState({ screen: 'choice', hint: '', error: error?.message || 'Could not join the room.' });
    }
  }

  function pickPvpLeader(leaderId) {
    if (!pvp || !LEADERS.some(({ id }) => id === leaderId)) return;
    pvp.myLeader = leaderId;
    pvp.iReady = false;
    try {
      pvp.room.setReady(false, leaderId);
    } catch { /* presence update is best-effort */ }
    pvpUI?.setState(pvpViewModel(''));
  }

  function readyPvpDuel() {
    if (!pvp || !pvp.myLeader || !pvp.peerPresent || pvp.iReady) return;
    if ((pvp.relicPicks || []).length !== 2) {
      pvpUI?.setState(pvpViewModel('Pick 2 relics first!'));
      return;
    }
    pvp.iReady = true;
    try {
      pvp.room.setReady(true, pvp.myLeader);
    } catch { /* presence update is best-effort */ }
    if (!checkPvpStart(pvp)) {
      pvpUI?.setState(pvpViewModel('Waiting for rival to ready up…'));
    }
  }

  function copyPvpCode() {
    if (!pvp) return;
    const code = pvp.roomCode;
    const show = () => {
      if (pvp) pvpUI?.setState(pvpViewModel('Code copied — send it to your rival!'));
    };
    const fallback = () => {
      try {
        const ta = document.createElement('textarea');
        ta.value = code;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        show();
      } catch {
        pvpUI?.setError(`Copy failed — the code is ${code}`);
      }
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(code).then(show, fallback);
    else fallback();
  }

  function pushEndlessBoss() {
    const state = getState();
    if (!state || !state.endless) return false;
    const taken = deps.takeEndlessBoss(state.stageIndex + 1);
    if (!taken) return false;
    state.encounterOrder.push(taken.id);
    return true;
  }

  function keepTouring() {
    const state = getState();
    if (!state || state.runStatus !== 'victory' || state.dailyChallenge) return;
    state.endless = true;
    if (!pushEndlessBoss()) return;
    const nextIndex = state.stageIndex + 1;
    setState({ ...state, runStatus: 'playing' });
    uiHideRunModals();
    addLog(`🔁 ENDLESS TOUR: wave ${nextIndex + 1} approaches…`, 'text-amber-300 font-bold');
    beginStage(nextIndex);
  }

  function leavePvpDuel() {
    pvpClearTimer();
    if (pvp) {
      clearTimeout(pvp.roundTimer);
      clearTimeout(pvp.duelTimer);
    }
    try {
      pvp?.room.close();
    } catch { /* already closed */ }
    const state = getState();
    if (state && state.runStatus === 'pvp') setState(null);
    pvp = null;
    pvpSyncButtons();
    pvpUI?.hide();
  }

  function openPvpLobby() {
    if (!pvpUI) {
      pvpUI = createPvpUI({
        onHost: hostPvpDuel,
        onJoin: joinPvpDuel,
        onPickLeader: pickPvpLeader,
        onReady: readyPvpDuel,
        onLeave: leavePvpDuel,
        onToggleRelic: togglePvpRelic,
        onStartDuel: startPvpDuel,
        onContinueRound: continuePvpRound,
        onRematch: rematchPvp,
        onCopyCode: copyPvpCode
      });
    }
    if (pvp) {
      try { pvp.room.close(); } catch { /* stale session */ }
      pvp = null;
    }
    pvpUI.show('');
  }

  // ------------------------------------------------------------ duel engine ---
  function pvpPublicSnapshot() {
    const state = getState();
    return {
      hp: state.player.hp,
      block: state.player.block,
      cheer: state.player.cheer,
      encore: state.player.statuses.encore || 0,
      weak: state.player.statuses.weak || 0
    };
  }

  function pvpSend(type, payload = {}) {
    if (!pvp || !pvp.room || !pvp.actionLog) return;
    pvp.room.sendAction(nextPvpAction(pvp.actionLog, type, {
      ...payload,
      round: pvp.roundIndex,
      score: { me: pvp.myWins, rival: pvp.peerWins }
    }));
  }

  function pvpAdoptScore(score) {
    if (!pvp || !score) return;
    let changed = false;
    if (Number.isInteger(score.me) && score.me > pvp.peerWins) {
      pvp.peerWins = score.me;
      changed = true;
    }
    if (Number.isInteger(score.rival) && score.rival > pvp.myWins) {
      pvp.myWins = score.rival;
      changed = true;
    }
    if (changed) {
      addLog(`🔄 Score synced with rival (you ${pvp.myWins} — rival ${pvp.peerWins}).`, 'text-slate-400');
    }
  }

  function pvpRefreshIntent() {
    const state = getState();
    if (!state || state.runStatus !== 'pvp') return;
    state.enemy.patterns = [{
      type: 'muster',
      label: pvp && pvp.isMyTurn ? '⚔ Your move — rival awaits.' : '⏳ Rival is thinking…'
    }];
    state.enemy.patternStep = 0;
  }

  function pvpSyncButtons() {
    const btn = document.getElementById('btnEndTurn');
    if (!btn) return;
    const state = getState();
    if (state && state.runStatus === 'pvp') btn.disabled = !(pvp && pvp.isMyTurn && !pvp.matchOver);
    else btn.disabled = false;
  }

  function pvpClearTimer() {
    if (pvp && pvp.timerId) {
      clearInterval(pvp.timerId);
      pvp.timerId = null;
    }
    document.getElementById('pvpTimerWrap')?.classList.add('hidden');
  }

  // One persistent 1s match clock: countdown on your turn (auto-ends at
  // zero), count-up while the rival thinks. Both players always see it.
  function pvpStartClock() {
    if (!pvp) return;
    pvp.turnStartStamp = Date.now();
    if (pvp.timerId) clearInterval(pvp.timerId);
    document.getElementById('pvpTimerWrap')?.classList.remove('hidden');
    pvpTickClock();
    pvp.timerId = setInterval(pvpTickClock, 1000);
  }

  function pvpTickClock() {
    const banner = document.getElementById('pvpTimerBanner');
    const state = getState();
    if (!pvp || !state || state.runStatus !== 'pvp' || pvp.matchOver) {
      pvpClearTimer();
      return;
    }
    const elapsed = Date.now() - (pvp.turnStartStamp || Date.now());
    if (pvp.isMyTurn) {
      const remaining = Math.max(0, PVP_TURN_MS - elapsed);
      if (banner) {
        const secs = Math.ceil(remaining / 1000);
        banner.textContent = `⏳ ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
        banner.classList.toggle('text-rose-300', remaining <= 15000);
        banner.classList.toggle('text-white', remaining > 15000);
      }
      if (remaining <= 0) {
        addLog('⏱️ Turn timer expired — turn auto-ended.', 'text-amber-300 font-bold');
        endPvpTurn();
      }
    } else if (banner) {
      const secs = Math.floor(elapsed / 1000);
      banner.textContent = `⌛ RIVAL ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
      banner.classList.remove('text-rose-300');
      banner.classList.add('text-white');
    }
  }

  // Turn-boundary invariant check: every master-deck instance must live in
  // exactly one pile (hand cap respected). Logs and self-heals instead of
  // silently losing cards — the guest-side disappearance diagnostic.
  function pvpVerifyPiles(where) {
    const state = getState();
    if (!state || state.runStatus !== 'pvp' || !pvp) return;
    const seen = new Map();
    const problems = [];
    const masterIds = new Set(state.masterDeck.map((instance) => instance?.instanceId));
    const isExempt = (instance) => {
      const card = instance && getCardDB()[instance.cardId];
      return card && card.type === 'STATUS' && card.draftable === false;
    };
    const piles = [['draw', state.drawPile], ['hand', state.hand], ['discard', state.discardPile], ['exhaust', state.exhaustPile]];
    for (const [name, pile] of piles) {
      for (const instance of pile) {
        if (!instance || (!masterIds.has(instance.instanceId) && !isExempt(instance))) {
          problems.push(`${name} holds unknown instance ${instance?.instanceId}`);
          continue;
        }
        if (seen.has(instance.instanceId)) problems.push(`instance ${instance.instanceId} in ${seen.get(instance.instanceId)} and ${name}`);
        else seen.set(instance.instanceId, name);
      }
    }
    for (const buff of state.buffs) {
      if (seen.has(buff.instanceId)) problems.push(`buff ${buff.instanceId} also in ${seen.get(buff.instanceId)}`);
      else seen.set(buff.instanceId, 'buffs');
    }
    for (const id of masterIds) {
      if (!seen.has(id)) problems.push(`instance ${id} missing from all piles`);
    }
    if (state.hand.length > (state.handLimit ?? MAX_HAND_SIZE)) {
      problems.push(`hand ${state.hand.length} over limit ${state.handLimit}`);
    }
    if (problems.length > 0) {
      addLog(`⚠️ Duel state mismatch (${where}): ${problems.slice(0, 3).join('; ')}${problems.length > 3 ? '…' : ''}`, 'text-rose-300 font-bold');
      const keep = new Set();
      state.hand = state.hand.filter((instance) => {
        if (!instance || keep.has(instance.instanceId)) {
          if (instance) state.drawPile.push(instance);
          return false;
        }
        keep.add(instance.instanceId);
        return true;
      });
      while (state.hand.length > (state.handLimit ?? MAX_HAND_SIZE)) state.drawPile.push(state.hand.pop());
      renderAll();
    }
  }

  function pvpAdoptSnapshot(snap) {
    const state = getState();
    if (!snap || !state) return;
    state.enemy.hp = Math.max(0, Math.min(state.enemy.maxHp, snap.hp ?? state.enemy.hp));
    state.enemy.block = Math.max(0, snap.block ?? state.enemy.block);
    state.enemy.cheer = snap.cheer ?? state.enemy.cheer;
    state.enemy.encore = snap.encore ?? 0;
    state.enemy.weak = snap.weak ?? 0;
    if (Number.isInteger(snap.charm)) state.enemy.statuses.charm = Math.max(0, snap.charm);
    if (Number.isInteger(snap.marked)) state.enemy.statuses.marked = Math.max(0, snap.marked);
  }

  function pvpFullSnapshot() {
    const state = getState();
    return {
      ...pvpPublicSnapshot(),
      charm: state.enemy.statuses.charm || 0,
      marked: state.enemy.statuses.marked || 0
    };
  }

  function startPvpRound() {
    const peerName = (LEADERS.find((l) => l.id === pvp.peerLeader)?.name || 'RIVAL').toUpperCase();
    const deckIds = buildPvpDeck(pvp.roomCode, pvp.roundIndex, pvp.myLeader, { cards: getCardDB(), starterDecks: getStarterDecks() }, PVP_DECK_SIZE);
    let nextId = 1;
    const masterDeck = deckIds.map((cardId) => ({ instanceId: nextId++, cardId, upgradeLevel: 0 }));
    setState({
      runStatus: 'pvp',
      stageIndex: pvp.roundIndex,
      turn: 0,
      wavesCleared: 0,
      damageDealtThisTurn: 0,
      peakSingleTurnDamage: 0,
      skillsPlayedThisTurn: 0,
      cardsPlayedThisTurn: 0,
      relicTriggersThisTurn: {},
      handLimit: MAX_HAND_SIZE,
      keptCardInstanceId: null,
      energyPenalty: 0,
      cardPlayCounts: {},
      ...createTurnMemberState(),
      leader: pvp.myLeader,
      encoreLevel: 0,
      dailyChallenge: null,
      rngState: null,
      leaderAbilityUsed: false,
      startedAt: Date.now(),
      nextCardInstanceId: nextId,
      draftChoices: [],
      relicChoices: [],
      routeChoices: [],
      rewardMode: null,
      tourEventId: null,
      encounterOrder: [],
      modifiers: { chaosDraft: false, limitedRemovals: false, doubleHazards: false },
      secondHazard: null,
      merchTokens: 0,
      shop: null,
      relics: [...pvp.relicIds],
      isPlayerTurn: false,
      masterDeck,
      drawPile: shuffle([...masterDeck]),
      hand: [],
      discardPile: [],
      exhaustPile: [],
      buffs: [],
      player: {
        hp: PVP_HP, maxHp: PVP_HP, block: 0, energy: 3, maxEnergy: 3, cheer: 0,
        statuses: { encore: 0, weak: 0, charm: 0, marked: 0 }
      },
      enemy: {
        id: 'pvp-rival',
        name: `${peerName} (RIVAL)`,
        subtitle: `DUEL · ROUND ${pvp.roundIndex + 1} · FIRST TO 2`,
        hp: PVP_HP, maxHp: PVP_HP, block: 0, strength: 0,
        statuses: { charm: 0, marked: 0 },
        passives: [],
        patterns: [{ type: 'muster', label: '⏳ Rival is thinking…' }],
        patternStep: 0,
        stageEffect: null,
        enrageTriggered: false,
        reflectUsedThisTurn: false,
        assets: { backdrop: '', illustration: getArtAssets()[pvp.peerLeader] || '' },
        visuals: { background: 'radial-gradient(circle at 50% 30%, #4c1d95, #020617)' },
        encore: 0, weak: 0, cheer: 0
      },
      logs: []
    });
    setMainMenuOpen(false);
    uiHideMainMenu();
    pvpUI.hide();
    applyRelicEffects('stageStart');
    if (pvp.roundIndex === 0) getState().pvpRoundWinners = [];
    pvp.roundDecided = false;
    pvp.pendingEvents = [];
    addLog(`⚔ ROUND ${pvp.roundIndex + 1} — ${pvp.myWins} : ${pvp.peerWins}. Rival: ${peerName} (${pvp.peerLeader.toUpperCase()}).`, 'text-amber-300 font-bold');
    const first = pvpCoinFlip(pvp.roomCode, pvp.roundIndex) === pvp.role;
    addLog(`🪙 Coin: ${first ? 'you' : 'rival'} take${first ? '' : 's'} the first turn.`, 'text-sky-300');
    if (first) {
      beginPvpTurn();
    } else {
      const state = getState();
      pvp.isMyTurn = false;
      state.isPlayerTurn = false;
      pvpSyncButtons();
      pvpRefreshIntent();
      pvpStartClock();
      renderAll();
    }
  }

  function beginPvpTurn() {
    if (!pvp || pvp.roundDecided || pvp.matchOver) return;
    const state = getState();
    state.turn += 1;
    state.damageDealtThisTurn = 0;
    state.skillsPlayedThisTurn = 0;
    state.cardsPlayedThisTurn = 0;
    state.relicTriggersThisTurn = {};
    state.handLimit = MAX_HAND_SIZE;
    state.keptCardInstanceId = null;
    state.energyPenalty = 0;
    Object.assign(state, createTurnMemberState());
    // Statuses age once per round-trip on each side.
    for (const key of ['weak', 'charm']) {
      state.player.statuses[key] = Math.max(0, (state.player.statuses[key] || 0) - 1);
    }
    for (const key of ['charm', 'marked']) {
      state.enemy.statuses[key] = Math.max(0, (state.enemy.statuses[key] || 0) - 1);
    }
    if (state.player.block > 0) {
      const decayed = Math.floor(state.player.block / 2);
      if (decayed < state.player.block) {
        addLog(`🛡️ Unused Holo Shield decayed ${state.player.block} → ${decayed}.`, 'text-cyan-300');
      }
      state.player.block = decayed;
    }
    state.player.energy = state.player.maxEnergy;
    tickBuffsAtTurnStart();
    state.isPlayerTurn = true;
    pvp.isMyTurn = true;
    pvpSyncButtons();
    pvpRefreshIntent();
    drawCards(5);
    pvpStartClock();
    pvpVerifyPiles('turn start');
    renderAll();
  }

  function endPvpTurn() {
    const state = getState();
    if (!state || state.runStatus !== 'pvp' || !pvp || !pvp.isMyTurn || pvp.roundDecided) return;
    pvpClearTimer();
    // Discard non-retained hand like a normal turn end.
    const retained = [];
    while (state.hand.length > 0) {
      const instance = state.hand.pop();
      const card = getCardDB()[instance.cardId];
      if (card?.retain || card?.retainInHand || instance.instanceId === state.keptCardInstanceId) retained.unshift(instance);
      else state.discardPile.push(instance);
    }
    state.hand.push(...retained);
    state.keptCardInstanceId = null;
    // Combos don't carry into the rival's turn — same as PvE turn flow.
    Object.assign(state, createTurnMemberState());
    pvp.isMyTurn = false;
    state.isPlayerTurn = false;
    pvp.turnStartStamp = Date.now();
    pvpSend('turnEnded', { snapshot: pvpPublicSnapshot() });
    addLog('⏳ Turn ended — rival is thinking…', 'text-sky-300');
    pvpRefreshIntent();
    pvpSyncButtons();
    pvpVerifyPiles('turn end');
    renderAll();
  }

  // ------------------------------------------ remote plays & round flow ---
  function applyRemoteDamage(base, pierce, remote) {
    const state = getState();
    let dmg = base + (remote.encore || 0);
    if ((remote.weak || 0) > 0) dmg = Math.floor(dmg * 0.75);
    // Charm the rival carries weakens their hits; I track what I applied.
    if ((state.enemy.statuses.charm || 0) > 0) dmg = Math.floor(dmg * 0.75);
    if ((state.player.statuses.marked || 0) > 0) dmg = Math.ceil(dmg * 1.5);
    applyDamageToPlayer(Math.max(0, dmg), pierce);
  }

  function matchesRemoteWhen(when, remote) {
    if (!when) return true;
    const state = getState();
    if (when.target === 'player') return (remote[when.status] || 0) > 0;
    return (state.player.statuses[when.status] || 0) > 0;
  }

  function applyRemoteCardPlayed(payload) {
    const state = getState();
    if (!state || state.runStatus !== 'pvp' || !pvp || pvp.roundDecided || pvp.matchOver) return;
    if (payload.round !== pvp.roundIndex) return; // stale round
    const remote = payload.snapshot || {};
    const leader = payload.leader;
    if (payload.cardId === '__finale') {
      applyRemoteDamage(28, 0, remote);
      state.player.statuses.charm = (state.player.statuses.charm || 0) + 2;
      addLog('🌟 Rival unleashed their Joint Finale! (+2 Charm on you)', 'text-rose-300 font-bold');
    } else if (payload.cardId === '__leader') {
      if (leader === 'ahri') {
        applyRemoteDamage(18, 0, remote);
        addLog('🦊 Rival Ahri used Spirit Rush!', 'text-pink-300 font-bold');
      } else if (leader === 'akali') {
        applyRemoteDamage(26, 0, remote);
        addLog('🥷 Rival Akali used Shuriken Flip!', 'text-cyan-300 font-bold');
      } else if (leader === 'evelynn') {
        state.player.statuses.charm = (state.player.statuses.charm || 0) + 3;
        addLog('💜 Rival Evelynn used Allure: you are Charmed!', 'text-purple-300 font-bold');
      } else if (leader === 'kaisa') {
        addLog('✨ Rival Kai\'Sa used Killer Instinct!', 'text-indigo-300 font-bold');
      }
    } else {
      const card = getCardDB()[payload.cardId];
      if (!card) return;
      addLog(`⚔ Rival played ${card.name}.`, card.log?.colorClass || 'text-slate-300');
      for (const effect of card.effects || []) {
        if (!matchesRemoteWhen(effect.when, remote)) continue;
        const amount = effect.amount === undefined
          ? undefined
          : effect.amount + (effect.upgradeAmount || 0) * (payload.upgradeLevel || 0);
        switch (effect.type) {
          case 'damage':
            applyRemoteDamage(amount, effect.pierce || 0, remote);
            break;
          case 'applyEnemyStatus':
            if (effect.status === 'charm' || effect.status === 'marked') {
              state.player.statuses[effect.status] = (state.player.statuses[effect.status] || 0) + (effect.turns || 0);
              addLog(`⚠️ Rival applied ${effect.turns} ${effect.status === 'charm' ? 'Charm' : 'Marked'} to you!`, 'text-rose-300');
            }
            break;
          case 'stealBlock': {
            const stolen = Math.min(state.player.block, amount);
            state.player.block -= stolen;
            if (stolen > 0) addLog(`🌀 Rival siphoned ${stolen} of your Holo Shield!`, 'text-purple-300');
            break;
          }
          default:
            break; // rival-side gains are already in their snapshot
        }
      }
    }
    pvpAdoptSnapshot(remote);
    pvpCheckDefeat();
    pvpVerifyPiles('rival play');
    renderAll();
  }

  function pvpCheckDefeat() {
    const state = getState();
    if (state.player.hp > 0) return;
    // Revive buffs work exactly like PvE: consume, stay alive.
    const reviveIndex = state.buffs.findIndex((buff) =>
      getCardDB()[buff.cardId]?.buff?.effect === 'revive'
    );
    if (reviveIndex >= 0) {
      const [consumed] = state.buffs.splice(reviveIndex, 1);
      const reviveHp = getBuffAmount(consumed);
      state.player.hp = Math.min(state.player.maxHp, Math.max(1, reviveHp));
      discardBuffEntry(consumed);
      addLog(`👼 ${getCardDB()[consumed.cardId]?.name || 'Buff'} revived you at ${state.player.hp} HP!`, 'text-emerald-300 font-bold');
      renderAll();
      return;
    }
    pvpRoundEnd(false);
  }

  function pvpRoundEnd(won) {
    if (!pvp || pvp.roundDecided || pvp.matchOver) return;
    pvp.roundDecided = true;
    pvpClearTimer();
    if (won) {
      // Local kill detection is authoritative for our own wins; the
      // broadcast score carries the final totals so the rival adopts.
      pvp.myWins += 1;
      pvpSend('roundEnd', { winner: pvp.playerId });
    }
    const state = getState();
    if (state && state.pvpRoundWinners) state.pvpRoundWinners[pvp.roundIndex] = won ? 'me' : 'rival';
    addLog(won ? `🏆 ROUND ${pvp.roundIndex + 1} YOURS! (${pvp.myWins} : ${pvp.peerWins})` : `💀 ROUND ${pvp.roundIndex + 1} LOST. (${pvp.myWins} : ${pvp.peerWins})`, 'text-amber-300 font-bold');
    if (pvp.myWins >= 2 || pvp.peerWins >= 2) {
      pvpEndMatch(pvp.myWins >= 2);
      return;
    }
    pvpUI?.show('');
    pvpUI?.setState({ screen: 'roundresult', round: pvp.roundIndex + 1, won, myWins: pvp.myWins, peerWins: pvp.peerWins });
    if (state) {
      state.isPlayerTurn = false;
      pvp.isMyTurn = false;
      pvpSyncButtons();
      renderAll();
    }
    clearTimeout(pvp.roundTimer);
    pvp.roundTimer = setTimeout(() => continuePvpRound(), 4000);
  }

  function pvpEndMatch(won) {
    pvp.matchOver = true;
    pvpClearTimer();
    clearTimeout(pvp.roundTimer);
    clearTimeout(pvp.duelTimer);
    pvp.isMyTurn = false;
    const state = getState();
    if (state) {
      state.isPlayerTurn = false;
      pvpSyncButtons();
      renderAll();
    }
    pvpUI.show('');
    pvpUI.setState({ screen: 'result', won, myWins: pvp.myWins, peerWins: pvp.peerWins });
    addLog(won ? '🏆 DUEL WON! Best of 3 yours!' : '💀 DUEL LOST. Best of 3 to the rival.', 'text-amber-300 font-bold');
  }

  function pvpOnTurnEnded(payload) {
    const state = getState();
    if (!state || state.runStatus !== 'pvp' || !pvp || pvp.roundDecided || pvp.matchOver) return;
    if (payload.round !== pvp.roundIndex) return; // stale round
    pvpAdoptSnapshot(payload.snapshot);
    addLog('⚔ Rival ended their turn — your move!', 'text-emerald-300');
    beginPvpTurn();
  }

  function pvpOnRoundEnd(payload) {
    if (!pvp || pvp.matchOver || pvp.roundDecided) return;
    // The winner's broadcast carries final totals — adopt, never increment
    // here, or the win counts twice (once locally, once from the message).
    pvpAdoptScore(payload?.score);
    pvp.roundDecided = true;
    const won = payload?.winner === pvp.playerId;
    const state = getState();
    if (state && state.runStatus === 'pvp' && state.pvpRoundWinners) {
      state.pvpRoundWinners[pvp.roundIndex] = won ? 'me' : 'rival';
    }
    addLog(won ? `🏆 ROUND ${pvp.roundIndex + 1} YOURS! (${pvp.myWins} : ${pvp.peerWins})` : `💀 ROUND ${pvp.roundIndex + 1} LOST. (${pvp.myWins} : ${pvp.peerWins})`, 'text-amber-300 font-bold');
    if (pvp.myWins >= 2 || pvp.peerWins >= 2) {
      pvpEndMatch(pvp.myWins >= 2);
      return;
    }
    pvpUI?.show('');
    pvpUI?.setState({ screen: 'roundresult', round: pvp.roundIndex + 1, won, myWins: pvp.myWins, peerWins: pvp.peerWins });
    if (state && state.runStatus === 'pvp') {
      state.isPlayerTurn = false;
      pvp.isMyTurn = false;
      pvpSyncButtons();
      renderAll();
    }
    clearTimeout(pvp.roundTimer);
    pvp.roundTimer = setTimeout(() => continuePvpRound(), 4000);
  }

  function broadcastPvpPlay(card, upgradeLevel) {
    const state = getState();
    pvpSend('cardPlayed', {
      cardId: card.id, upgradeLevel, leader: state.leader, snapshot: pvpPublicSnapshot()
    });
  }

  function broadcastPvpSpecial(kind) {
    const state = getState();
    pvpSend('cardPlayed', {
      cardId: kind, upgradeLevel: 0, leader: state.leader, snapshot: pvpPublicSnapshot()
    });
  }

  // ---------------------------------------------------------- public API ---
  return {
    openLobby: openPvpLobby,
    leave: leavePvpDuel,
    broadcastPlay: broadcastPvpPlay,
    broadcastSpecial: broadcastPvpSpecial,
    onLocalKill() { pvpRoundEnd(true); },
    endTurn() { endPvpTurn(); }
  };
}
