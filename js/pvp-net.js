// PvP net layer: room join/ready, sequenced action exchange, gap-triggered
// snapshot resync, presence-driven disconnect. Transport-agnostic: the
// caller injects a bus ({ send, onMessage, getPresence, onPresenceChange });
// production passes a Supabase Realtime Broadcast channel (see
// createSupabasePvpBus), tests pass an in-memory pair. No DOM here.

import { isValidPvpAction, isValidRoomCode } from './pvp-protocol.js';

export const PVP_CHANNEL_PREFIX = 'pvp-';

// A bus must implement:
//   send(message)                     -> deliver {from, data} to the peer(s)
//   onMessage(callback)               -> callback({from, data}) per message
//   trackPresence(state)              -> publish {playerId, leader, ready}
//   onPresenceChange(callback)        -> callback(peers[]) on join/leave/update
//   close()
export function createPvpRoom({ roomCode, playerId, bus, onEvent }) {
  if (!isValidRoomCode(roomCode)) throw new Error('Invalid PvP room code.');
  if (!playerId || !bus || typeof onEvent !== 'function') throw new Error('PvP room needs playerId, bus, onEvent.');

  const peers = new Map();
  let started = false;
  let closed = false;
  let expectedSeq = 1;
  let lastSnapshotRequest = 0;

  function emit(type, detail) {
    onEvent({ type, ...detail });
  }

  function refreshPeers(states) {
    peers.clear();
    for (const state of states || []) {
      if (state && state.playerId && state.playerId !== playerId) peers.set(state.playerId, state);
    }
    emit('peers', { peers: [...peers.values()] });
    if (!started) {
      const ready = [...peers.values()].filter((p) => p.ready);
      if (ready.length > 0) emit('opponentReady', { peer: ready[0] });
    }
  }

  bus.onMessage(({ from, data }) => {
    if (closed || !data || from === playerId) return;
    if (data.kind === 'action') {
      if (!isValidPvpAction(data.action)) return;
      const { action } = data;
      if (action.seq < expectedSeq) return; // duplicate/replay
      if (action.seq > expectedSeq) {
        // Gap: ask for a full snapshot (throttled to one per 2s).
        const now = Date.now();
        if (now - lastSnapshotRequest > 2000) {
          lastSnapshotRequest = now;
          bus.send({ from: playerId, data: { kind: 'snapshotRequest', atSeq: expectedSeq } });
          emit('resync', { atSeq: expectedSeq });
        }
        return;
      }
      expectedSeq += 1;
      emit('action', { action, from });
    } else if (data.kind === 'snapshotRequest') {
      emit('snapshotRequested', { from, atSeq: data.atSeq });
    } else if (data.kind === 'snapshotState') {
      if (Number.isInteger(data.nextSeq) && data.nextSeq > expectedSeq) expectedSeq = data.nextSeq;
      emit('snapshot', { from, snapshot: data.snapshot });
    }
  });

  bus.onPresenceChange((states) => {
    if (closed) return;
    const before = peers.size;
    refreshPeers(states);
    if (before > 0 && peers.size === 0) emit('opponentLeft', {});
  });

  return {
    get roomCode() { return roomCode; },
    get playerId() { return playerId; },
    join(leader) {
      bus.trackPresence({ playerId, leader, ready: false });
    },
    setReady(ready, leader) {
      bus.trackPresence({ playerId, leader, ready: Boolean(ready) });
      if (ready) emit('ready', {});
    },
    sendAction(action) {
      bus.send({ from: playerId, data: { kind: 'action', action } });
    },
    sendSnapshot(snapshot, nextSeq) {
      bus.send({ from: playerId, data: { kind: 'snapshotState', snapshot, nextSeq } });
    },
    start() { started = true; },
    close() { closed = true; bus.close(); }
  };
}

// Production bus backed by a Supabase Realtime Broadcast channel.
// channelFactory: async () => channel with .send/.on/.track/.subscribe —
// defaults to a dynamic supabase-js import so browsers without connectivity
// fail at join time, not at page load.
export async function createSupabasePvpBus({ roomCode, supabase, channelFactory }) {
  const factory = channelFactory || (async () => {
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    const client = createClient(supabase.url, supabase.publishableKey);
    return client.channel(`${PVP_CHANNEL_PREFIX}${roomCode}`, { config: { broadcast: { ack: true } } });
  });
  const channel = await factory();
  const listeners = { message: [], presence: [] };
  let presenceState = {};
  channel.on('broadcast', { event: 'pvp' }, ({ payload }) => {
    for (const cb of listeners.message) cb(payload);
  });
  channel.on('presence', { event: 'sync' }, () => {
    presenceState = channel.presenceState();
    const states = Object.values(presenceState).flat().map((s) => s);
    for (const cb of listeners.presence) cb(states);
  });
  channel.on('presence', { event: 'join' }, () => {
    presenceState = channel.presenceState();
    for (const cb of listeners.presence) cb(Object.values(presenceState).flat());
  });
  channel.on('presence', { event: 'leave' }, (left) => {
    presenceState = channel.presenceState();
    for (const cb of listeners.presence) cb(Object.values(presenceState).flat(), left);
  });
  await new Promise((resolve, reject) => {
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') resolve();
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(new Error(`PvP channel failed: ${status}`));
    });
  });
  return {
    send(message) { channel.send({ type: 'broadcast', event: 'pvp', payload: message }); },
    onMessage(cb) { listeners.message.push(cb); },
    trackPresence(state) { channel.track(state); },
    onPresenceChange(cb) { listeners.presence.push(cb); },
    close() { channel.unsubscribe(); }
  };
}
