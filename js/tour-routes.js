// Tour routing prototype: Leona, K/DA's manager, offers a stop after each wave.
// Each stop maps onto an existing reward screen so the economy stays unchanged.

export const LEONA_MANAGER_ART =
  'https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Leona_33.jpg';

export const TOUR_ROUTES = Object.freeze([
  {
    id: 'backstage',
    name: 'BACKSTAGE PASS',
    icon: '🎛️',
    rewardMode: 'upgrades',
    summary: 'Upgrade one card for the rest of the tour.',
    tag: 'UPGRADE'
  },
  {
    id: 'merch',
    name: 'MERCH STAND',
    icon: '✦',
    rewardMode: 'relics',
    summary: 'Take a relic and patch up the stage.',
    tag: 'RELIC'
  },
  {
    id: 'fanmeet',
    name: 'FAN MEET',
    icon: '📣',
    rewardMode: 'cards',
    summary: 'Draft a new card and recover HP.',
    tag: 'CARD'
  }
]);

export function getTourRoute(routeId) {
  return TOUR_ROUTES.find((route) => route.id === routeId) || null;
}
