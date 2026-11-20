export const LEADERS = [
  {
    id: 'ahri',
    name: 'Ahri',
    abilityName: 'Spirit Rush',
    abilityDescription: 'Deal 18 damage and restore 12 HP.'
  },
  {
    id: 'akali',
    name: 'Akali',
    abilityName: 'Shuriken Flip',
    abilityDescription: 'Deal 26 damage and gain 8 Holo Shield.'
  },
  {
    id: 'evelynn',
    name: 'Evelynn',
    abilityName: 'Allure',
    abilityDescription: 'Charm the enemy for 3 turns and gain 25% Crowd Cheer.'
  },
  {
    id: 'kaisa',
    name: "Kai'Sa",
    abilityName: 'Killer Instinct',
    abilityDescription: 'Draw 3 cards, gain 2 Hype Energy, and gain 15% Crowd Cheer.'
  }
];

export const LEADER_ART_STYLES = [
  { id: 'popstars', name: 'POP/STARS' },
  { id: 'more', name: 'MORE', winsRequired: 1 },
  { id: 'firestarter', name: 'FIRESTARTER', winsRequired: 2 },
  { id: 'prestige', name: 'PRESTIGE', winsRequired: 3 }
];

export const RANK_TIERS = [
  { id: 'iron', name: 'Iron', color: '#777777' },
  { id: 'bronze', name: 'Bronze', color: '#a97142' },
  { id: 'silver', name: 'Silver', color: '#aeb9c7' },
  { id: 'gold', name: 'Gold', color: '#d8a22e' },
  { id: 'platinum', name: 'Platinum', color: '#54c7c4' },
  { id: 'emerald', name: 'Emerald', color: '#2baf69' },
  { id: 'diamond', name: 'Diamond', color: '#5ebeff' },
  { id: 'master', name: 'Master', color: '#9f50e6' },
  { id: 'grandmaster', name: 'Grandmaster', color: '#d74a4a' },
  { id: 'challenger', name: 'Challenger', color: '#f5d76e' }
];

export function getUnlockedArtStyles(leaderWins) {
  return LEADER_ART_STYLES.filter((style) =>
    style.winsRequired === undefined || leaderWins >= style.winsRequired
  );
}

export function getArtRank(waveClears) {
  const tierIndex = Math.floor(waveClears / 10) - 1;
  return tierIndex < 0 ? null : RANK_TIERS[Math.min(tierIndex, RANK_TIERS.length - 1)];
}
