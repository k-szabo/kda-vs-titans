// Defeat coach: one contextual tip from the lost run's own stats.
// Pure and UI-agnostic: stats in, tip out (or null when nothing applies,
// which never happens — the fallback always matches).
// Stat shape (all optional, missing values fail soft to the fallback):
// { wavesCleared, energyLeft, leaderAbilityUsed, peakDamage, cheer,
//   distinctMembers, totalPlays, upgradesTaken }
const RULES = [
  {
    id: 'early-block',
    matches: (s) => (s.wavesCleared ?? 99) <= 1,
    text: 'Draft Holo Shield early — the opening waves hit harder than they look. Barrier and Smoke Shroud keep you alive while you scale.'
  },
  {
    id: 'spend-energy',
    matches: (s) => (s.energyLeft ?? 0) >= 2,
    text: 'Unspent Hype Energy cannot block. Spend it before ending the turn — leftover energy is lost every round.'
  },
  {
    id: 'leader-ability',
    matches: (s) => s.leaderAbilityUsed === false && (s.wavesCleared ?? 0) >= 2,
    text: 'Your leader ability is free and once per run. Do not take it to the grave — fire it on the hardest wave.'
  },
  {
    id: 'hoarded-cheer',
    matches: (s) => (s.cheer ?? 0) >= 50,
    text: 'You fell with the crowd still roaring. Fire the Joint Finale the moment Cheer hits 100% instead of saving it.'
  },
  {
    id: 'low-damage',
    matches: (s) => (s.peakDamage ?? 99) < 12 && (s.wavesCleared ?? 0) >= 3,
    text: 'Your biggest turn was small. Upgrade attacks at Backstage Pass stops and stack Encore to scale damage.'
  },
  {
    id: 'one-member',
    matches: (s) => (s.distinctMembers ?? 99) <= 1 && (s.totalPlays ?? 0) >= 6,
    text: 'One member cannot carry a tour. Mix all four for Quartet Harmony: +1 Energy, +6 Shield, +10% Crowd Cheer.'
  },
  {
    id: 'no-upgrades',
    matches: (s) => (s.upgradesTaken ?? 1) === 0 && (s.wavesCleared ?? 0) >= 4,
    text: 'No upgraded cards by wave 4+. Take the Backstage Pass upgrade reward — a tuned deck beats a bigger one.'
  },
  {
    id: 'fallback',
    matches: () => true,
    text: 'Every loss tunes the next draft. Check the Codex for the kaiju that got you, then run it back.'
  }
];

export function pickDefeatTip(stats = {}) {
  const safe = stats && typeof stats === 'object' ? stats : {};
  for (const rule of RULES) {
    try {
      if (rule.matches(safe)) return { id: rule.id, text: rule.text };
    } catch {
      continue;
    }
  }
  return { id: 'fallback', text: RULES[RULES.length - 1].text };
}

export const COACH_TIP_RULE_IDS = Object.freeze(RULES.map((rule) => rule.id));
