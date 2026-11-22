// Mid-run tour events. Data-driven so new events need no engine changes.
// Options use immediate effects; curses reuse the existing STATUS card path.

import { addInstanceToDeck, removeInstanceFromPiles } from './deck.js';

export const TOUR_EVENTS = Object.freeze([
  {
    id: 'meet_greet',
    name: 'MEET & GREET',
    icon: '🤝',
    description: 'Leona pulled strings for a backstage favour. Pick one — every gift has a price.',
    options: Object.freeze([
      {
        id: 'sign_session',
        label: 'SIGNING SESSION',
        summary: '+15 Max HP and heal 15 HP.',
        tag: '+15 MAX HP'
      },
      {
        id: 'wardrobe_purge',
        label: 'WARDROBE PURGE',
        summary: 'Remove a card from your deck and heal 8 HP.',
        tag: 'REMOVE 1',
        requires: 'canCut'
      },
      {
        id: 'backstage_deal',
        label: 'BACKSTAGE DEAL',
        summary: 'Gain a random relic and take a Stage Fright curse.',
        tag: 'RELIC + CURSE',
        requires: 'hasRelicAvailable'
      }
    ])
  },
  {
    id: 'street_show',
    name: 'ROOFTOP STREET SHOW',
    icon: '🎤',
    description: 'A street crowd begs for an impromptu set. How far do you push it?',
    options: Object.freeze([
      {
        id: 'hype_train',
        label: 'HYPE TRAIN',
        summary: '+20% Crowd Cheer and heal 10 HP.',
        tag: '+20% CHEER'
      },
      {
        id: 'gear_upgrade',
        label: 'SOUNDCHECK TWEAK',
        summary: 'Upgrade a random upgradeable card.',
        tag: 'UPGRADE',
        requires: 'canUpgrade'
      },
      {
        id: 'risky_pyro',
        label: 'RISKY PYRO',
        summary: 'Heal 25 HP and take a Burn curse.',
        tag: 'HEAL + CURSE'
      }
    ])
  },
  {
    id: 'sound_tech',
    name: 'MYSTERIOUS SOUND TECH',
    icon: '🎛️',
    description: 'A hooded tech offers experimental gear. It hums a little too loud.',
    options: Object.freeze([
      {
        id: 'restful_mix',
        label: 'RESTFUL MIX',
        summary: 'Heal 20 HP. No strings attached.',
        tag: '+20 HP'
      },
      {
        id: 'fine_tune',
        label: 'FINE TUNE',
        summary: 'Upgrade a random upgradeable card and lose 8 HP.',
        tag: 'UPGRADE -8 HP',
        requires: 'canTune'
      },
      {
        id: 'cursed_gear',
        label: 'CURSED GEAR',
        summary: 'Gain a random relic and take a Micro-Oxygen curse.',
        tag: 'RELIC + CURSE',
        requires: 'hasRelicAvailable'
      }
    ])
  },
  {
    id: 'street_team',
    name: 'STREET TEAM',
    icon: '📣',
    description: 'Local fans offer to hype the show — for a price, a favour, or a cut of the merch.',
    options: Object.freeze([
      {
        id: 'hype_cannon',
        label: 'HYPE CANNON',
        summary: 'Gain +30% Crowd Cheer now and take a Micro-Oxygen curse.',
        tag: '+CHEER + CURSE'
      },
      {
        id: 'flyer_duty',
        label: 'FLYER DUTY',
        summary: 'Remove a card from your deck and heal 12 HP.',
        tag: 'REMOVE +12 HP',
        requires: 'canCut'
      },
      {
        id: 'busk',
        label: 'BUSK THE CROWD',
        summary: 'Gain 15 Merch Tokens.',
        tag: '+15 🪙'
      }
    ])
  },
  {
    id: 'encore_rehearsal',
    name: 'ENCORE REHEARSAL',
    icon: '🎭',
    description: 'An empty arena, a full rig, one night to get it right.',
    options: Object.freeze([
      {
        id: 'dress_rehearsal',
        label: 'DRESS REHEARSAL',
        summary: 'Gain +25% Crowd Cheer now.',
        tag: '+25% CHEER'
      },
      {
        id: 'pyro_test',
        label: 'PYRO TEST',
        summary: 'Upgrade a random card and take a Burn curse.',
        tag: 'UPGRADE + CURSE',
        requires: 'canTune'
      },
      {
        id: 'vocal_rest',
        label: 'VOCAL REST',
        summary: 'Gain +2 Max HP and lose 10 HP.',
        tag: '+2 MAX HP',
        requires: 'canBleed'
      }
    ])
  }
]);

export function getTourEvent(eventId) {
  return TOUR_EVENTS.find((event) => event.id === eventId) || null;
}

export function rollTourEvent(rng = Math.random) {
  const index = Math.floor(rng() * TOUR_EVENTS.length) % TOUR_EVENTS.length;
  return TOUR_EVENTS[index]?.id || null;
}

// Between-wave event flow. Created once per boot with app callbacks; all run
// mutations go through here so pile coverage and save validity stay in one
// place. Depends on showRouting/isRewardAvailable/getAvailableRouteIds to
// hand off to Leona's routing after the event resolves.
export function createTourEvents(deps) {
  const {
    getState,
    getCardDatabase,
    getRelicDatabase,
    shuffle,
    addLog,
    saveRunState,
    openEventModal,
    closeEventModal,
    showRouting,
    isRewardAvailable,
    getAvailableRouteIds,
    getTourRoute
  } = deps;

  function getUnownedRelicIds(allowLeader = false) {
    const state = getState();
    const owned = new Set(state.relics);
    return Object.keys(getRelicDatabase()).filter((id) =>
      !owned.has(id) && (allowLeader || !getRelicDatabase()[id].leaderId)
    );
  }

  function getUpgradeableInstances() {
    const state = getState();
    const seen = new Set();
    return state.masterDeck.filter((instance) => {
      if (instance.upgradeLevel !== 0 || !getCardDatabase()[instance.cardId]?.upgrade) return false;
      if (seen.has(instance.cardId)) return false;
      seen.add(instance.cardId);
      return true;
    });
  }

  function isEventOptionAvailable(option) {
    const state = getState();
    if (!option || !option.requires) return true;
    if (option.requires === 'canCut') return !state.modifiers?.limitedRemovals && state.masterDeck.length > 1;
    if (option.requires === 'hasRelicAvailable') return getUnownedRelicIds(state.modifiers?.chaosDraft === true).length > 0;
    if (option.requires === 'canUpgrade') return getUpgradeableInstances().length > 0;
    if (option.requires === 'canBleed') return state.player.hp > 10;
    if (option.requires === 'canTune') {
      return getUpgradeableInstances().length > 0 && state.player.hp > 8;
    }
    return true;
  }

  function getAvailableEventOptions(eventId) {
    const event = getTourEvent(eventId);
    if (!event) return [];
    const base = Array.isArray(event.options) ? event.options : [];
    return base.filter(isEventOptionAvailable);
  }

  let pendingRemoval = null;

  function addCurseToDeck(cardId) {
    const state = getState();
    const card = getCardDatabase()[cardId];
    if (!card || card.type !== 'STATUS' || card.draftable !== false) {
      throw new Error(`Invalid curse card: ${cardId}`);
    }
    addInstanceToDeck(state, cardId);
  }

  function upgradeRandomCard() {
    const state = getState();
    const candidates = getUpgradeableInstances();
    if (candidates.length === 0) return null;
    const picked = shuffle(candidates)[0];
    const master = state.masterDeck.find((instance) => instance.instanceId === picked.instanceId);
    if (master) master.upgradeLevel = 1;
    [state.drawPile, state.hand, state.discardPile, state.exhaustPile].forEach((pile) => {
      const copy = Array.isArray(pile) ? pile.find((instance) => instance.instanceId === picked.instanceId) : null;
      if (copy) copy.upgradeLevel = 1;
    });
    const buff = state.buffs.find((entry) => entry.instanceId === picked.instanceId);
    if (buff) buff.upgradeLevel = 1;
    return picked;
  }

  function finishTourEvent(message) {
    const state = getState();
    state.tourEventId = null;
    saveRunState();
    closeEventModal();
    if (message) addLog(message, 'text-amber-300');
    showRouting();
  }

  function chooseTourEventOption(eventId, optionId) {
    const state = getState();
    if (state.runStatus !== 'draft' || state.tourEventId !== eventId) return;
    const event = getTourEvent(eventId);
    const option = event?.options?.find((entry) => entry.id === optionId);
    if (!option || !isEventOptionAvailable(option)) {
      state.tourEventId = getTourEvent(eventId) ? eventId : null;
      saveRunState();
      openEventModal(event, getAvailableEventOptions(eventId), state.masterDeck);
      addLog('🎫 Leona rerouted K/DA: that event option sold out.', 'text-amber-300');
      return;
    }
    if (optionId === 'wardrobe_purge') {
      pendingRemoval = { heal: 8, label: 'Wardrobe purge' };
      return;
    }
    if (optionId === 'flyer_duty') {
      pendingRemoval = { heal: 12, label: 'Flyer duty' };
      return;
    }
    applyTourEventOption(optionId);
  }

  function pruneStaleRelicChoices() {
    const state = getState();
    const owned = new Set(state.relics);
    const before = state.relicChoices.length;
    state.relicChoices = state.relicChoices.filter((id) => !owned.has(id));
    if (state.relicChoices.length !== before) {
      state.routeChoices = state.routeChoices.filter((id) => {
        const route = getTourRoute(id);
        return route && isRewardAvailable(route.rewardMode);
      });
      if (state.routeChoices.length === 0) state.routeChoices = getAvailableRouteIds();
    }
  }

  function applyTourEventOption(optionId) {
    const state = getState();
    const cardDatabase = getCardDatabase();
    const relicDatabase = getRelicDatabase();
    switch (optionId) {
      case 'sign_session': {
        state.player.maxHp += 15;
        state.player.hp = Math.min(state.player.maxHp, state.player.hp + 15);
        finishTourEvent('🤝 Meet & Greet signing session: +15 Max HP and healed 15 HP!');
        break;
      }
      case 'backstage_deal': {
        const pool = getUnownedRelicIds(state.modifiers?.chaosDraft === true);
        if (pool.length === 0) return;
        const relicId = shuffle(pool)[0];
        state.relics.push(relicId);
        addCurseToDeck('stage_fright');
        pruneStaleRelicChoices();
        finishTourEvent(`🤝 Backstage deal: gained ${relicDatabase[relicId].name} and took Stage Fright!`);
        break;
      }
      case 'hype_train': {
        state.player.cheer = Math.min(100, state.player.cheer + 20);
        state.player.hp = Math.min(state.player.maxHp, state.player.hp + 10);
        finishTourEvent('🎤 Rooftop hype train: +20% Crowd Cheer and healed 10 HP!');
        break;
      }
      case 'gear_upgrade': {
        const upgraded = upgradeRandomCard();
        finishTourEvent(upgraded
          ? `🎤 Soundcheck tweak: upgraded ${cardDatabase[upgraded.cardId].name}!`
          : '🎤 Soundcheck tweak fizzled: nothing left to upgrade.');
        break;
      }
      case 'risky_pyro': {
        state.player.hp = Math.min(state.player.maxHp, state.player.hp + 25);
        addCurseToDeck('burn');
        finishTourEvent('🎤 Risky pyro healed 25 HP but left a Burn curse in the deck!');
        break;
      }
      case 'restful_mix': {
        state.player.hp = Math.min(state.player.maxHp, state.player.hp + 20);
        finishTourEvent('🎛️ Restful mix: healed 20 HP. No strings attached.');
        break;
      }
      case 'fine_tune': {
        const upgraded = upgradeRandomCard();
        state.player.hp = Math.max(1, state.player.hp - 8);
        finishTourEvent(upgraded
          ? `🎛️ Fine tune: upgraded ${cardDatabase[upgraded.cardId].name} for 8 HP!`
          : '🎛️ Fine tune fizzled: nothing left to upgrade.');
        break;
      }
      case 'cursed_gear': {
        const pool = getUnownedRelicIds(state.modifiers?.chaosDraft === true);
        if (pool.length === 0) return;
        const relicId = shuffle(pool)[0];
        state.relics.push(relicId);
        addCurseToDeck('micro_oxygen');
        pruneStaleRelicChoices();
        finishTourEvent(`🎛️ Cursed gear: gained ${relicDatabase[relicId].name} and took Micro-Oxygen!`);
        break;
      }
      case 'hype_cannon': {
        state.player.cheer = Math.min(100, state.player.cheer + 30);
        addCurseToDeck('micro_oxygen');
        finishTourEvent('📣 Hype cannon: +30% Crowd Cheer and a Micro-Oxygen curse in the deck!');
        break;
      }
      case 'busk': {
        state.merchTokens = Math.min(9999, state.merchTokens + 15);
        finishTourEvent('📣 Busking paid off: +15 Merch Tokens!');
        break;
      }
      case 'dress_rehearsal': {
        state.player.cheer = Math.min(100, state.player.cheer + 25);
        finishTourEvent('🎭 Dress rehearsal: +25% Crowd Cheer and a flawless run-through!');
        break;
      }
      case 'pyro_test': {
        const upgraded = upgradeRandomCard();
        addCurseToDeck('burn');
        finishTourEvent(upgraded
          ? `🎭 Pyro test: upgraded ${cardDatabase[upgraded.cardId].name} and took a Burn curse!`
          : '🎭 Pyro test fizzled into a Burn curse.');
        break;
      }
      case 'vocal_rest': {
        state.player.maxHp += 2;
        state.player.hp = Math.max(1, state.player.hp - 10);
        finishTourEvent('🎭 Vocal rest: +2 Max HP for 10 HP of strain.');
        break;
      }
      default:
        throw new Error(`Unknown tour event option: ${optionId}`);
    }
  }

  function removeEventCard(instanceId) {
    const state = getState();
    if (state.runStatus !== 'draft' || !state.tourEventId) return;
    if (state.modifiers?.limitedRemovals) return;
    if (state.masterDeck.length <= 1) return;
    const removedCardId = removeInstanceFromPiles(state, instanceId);
    if (!removedCardId) return;
    const { heal, label } = pendingRemoval || { heal: 8, label: 'Wardrobe purge' };
    pendingRemoval = null;
    state.player.hp = Math.min(state.player.maxHp, state.player.hp + heal);
    finishTourEvent(`🤝 ${label}: removed ${getCardDatabase()[removedCardId].name} and healed ${heal} HP!`);
  }

  return {
    getUnownedRelicIds,
    getUpgradeableInstances,
    isEventOptionAvailable,
    getAvailableEventOptions,
    addCurseToDeck,
    upgradeRandomCard,
    finishTourEvent,
    chooseTourEventOption,
    pruneStaleRelicChoices,
    applyTourEventOption,
    removeEventCard
  };
}
