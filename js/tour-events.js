// Mid-run tour events. Data-driven so new events need no engine changes.
// Options use immediate effects; curses reuse the existing STATUS card path.

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
        tag: 'UPGRADE'
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
  }
]);

export function getTourEvent(eventId) {
  return TOUR_EVENTS.find((event) => event.id === eventId) || null;
}

export function rollTourEvent(rng = Math.random) {
  const index = Math.floor(rng() * TOUR_EVENTS.length) % TOUR_EVENTS.length;
  return TOUR_EVENTS[index]?.id || null;
}
