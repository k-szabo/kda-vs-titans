// PvP net checks: join/ready, ordered delivery, gap resync, disconnect.
// Uses an in-memory bus pair — no network. Run: node scripts/check-pvp-net.mjs
import assert from 'node:assert/strict';
import { createPvpRoom } from '../js/pvp-net.js';
import { createPvpActionLog, nextPvpAction } from '../js/pvp-protocol.js';

// In-memory bus pair: A.send delivers to B and vice versa, presence shared.
function createBusPair() {
  const buses = [];
  const peers = new Map();
  function makeBus(owner) {
    const bus = {
      owner,
      inbox: [],
      messageCb: null,
      presenceCb: null,
      send(message) {
        for (const other of buses) {
          if (other !== bus) other.inbox.push(message);
        }
        flush();
      },
      onMessage(cb) { bus.messageCb = cb; },
      trackPresence(state) {
        peers.set(owner, state);
        for (const other of buses) {
          if (other.presenceCb) other.presenceCb([...peers.values()]);
        }
      },
      onPresenceChange(cb) { bus.presenceCb = cb; },
      close() { peers.delete(owner); }
    };
    buses.push(bus);
    return bus;
  }
  function flush() {
    for (const bus of buses) {
      while (bus.inbox.length > 0 && bus.messageCb) {
        bus.messageCb(bus.inbox.shift());
      }
    }
  }
  return [makeBus('host'), makeBus('guest')];
}

const [hostBus, guestBus] = createBusPair();
const hostEvents = []; const guestEvents = [];
const host = createPvpRoom({ roomCode: 'ABCD', playerId: 'host', bus: hostBus, onEvent: (e) => hostEvents.push(e) });
const guest = createPvpRoom({ roomCode: 'ABCD', playerId: 'guest', bus: guestBus, onEvent: (e) => guestEvents.push(e) });

host.join('ahri'); guest.join('akali');
assert.ok(hostEvents.some((e) => e.type === 'peers' && e.peers.some((p) => p.playerId === 'guest')));
assert.ok(guestEvents.some((e) => e.type === 'peers' && e.peers.some((p) => p.playerId === 'host')));

guest.setReady(true, 'akali');
assert.ok(hostEvents.some((e) => e.type === 'opponentReady'), 'host sees guest ready');

// Ordered actions arrive in order.
const log = createPvpActionLog();
host.sendAction(nextPvpAction(log, 'cardPlayed', { cardId: 'foxfire_chord' }));
host.sendAction(nextPvpAction(log, 'turnEnded', {}));
const received = guestEvents.filter((e) => e.type === 'action').map((e) => e.action);
assert.deepEqual(received.map((a) => a.type), ['cardPlayed', 'turnEnded']);
assert.deepEqual(received.map((a) => a.seq), [1, 2]);

// Gap triggers a snapshot request; duplicates are ignored.
host.sendAction(nextPvpAction(log, 'cardPlayed', { cardId: 'skip-me' })); // seq 3 arrives...
// Simulate loss: deliver seq 5 while 4 is missing by sending direct.
hostBus.send({ from: 'host', data: { kind: 'action', action: { seq: 99, type: 'turnEnded', payload: {} } } });
assert.ok(guestEvents.some((e) => e.type === 'resync'), 'gap triggers resync');
// Duplicate of an old seq is dropped, not re-emitted.
const before = guestEvents.filter((e) => e.type === 'action').length;
hostBus.send({ from: 'host', data: { kind: 'action', action: { seq: 2, type: 'turnEnded', payload: {} } } });
assert.equal(guestEvents.filter((e) => e.type === 'action').length, before, 'duplicates dropped');

// Snapshot round-trip advances the expected sequence.
guestEvents.length = 0;
host.sendSnapshot({ hp: 60 }, 100);
assert.ok(guestEvents.some((e) => e.type === 'snapshot' && e.snapshot.hp === 60));

// Disconnect surfaces.
guest.close();
hostBus.trackPresence({ playerId: 'host', leader: 'ahri', ready: true });
assert.ok(hostEvents.some((e) => e.type === 'opponentLeft'), 'host sees guest leave');

// Bad room codes rejected.
assert.throws(() => createPvpRoom({ roomCode: 'NOPE!', playerId: 'x', bus: hostBus, onEvent: () => {} }));

console.log('PASS: join/ready, ordered actions, gap resync, snapshot, disconnect, code validation.');
