const DATA_MANIFEST_URL = new URL('../assets/data.json', import.meta.url);

async function loadJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

export async function loadGameData() {
  const manifest = await loadJson(DATA_MANIFEST_URL);
  if (
    !manifest.portraits ||
    !manifest.backdrops ||
    !manifest.cards ||
    !manifest.relics ||
    !Array.isArray(manifest.bosses) ||
    manifest.bosses.length === 0
  ) {
    throw new Error('The asset manifest must define portraits, backdrops, card and relic files, and at least one boss file.');
  }

  const cardDataUrl = new URL(manifest.cards, DATA_MANIFEST_URL);
  const relicDataUrl = new URL(manifest.relics, DATA_MANIFEST_URL);
  const [cardData, relicData, encounters] = await Promise.all([
    loadJson(cardDataUrl),
    loadJson(relicDataUrl),
    Promise.all(manifest.bosses.map(async (bossPath) => {
      const bossUrl = new URL(bossPath, DATA_MANIFEST_URL);
      const boss = await loadJson(bossUrl);
      const backdrop = boss.assets && manifest.backdrops[boss.assets.backdrop];
      if (!backdrop || !boss.assets.illustration || !boss.visuals || !boss.visuals.background) {
        throw new Error(`Boss data is missing required assets or visuals: ${bossPath}`);
      }
      return {
        ...boss,
        assets: {
          backdrop: new URL(backdrop, DATA_MANIFEST_URL).href,
          illustration: new URL(boss.assets.illustration, DATA_MANIFEST_URL).href
        }
      };
    }))
  ]);

  if (!Array.isArray(cardData.cards) || !Array.isArray(cardData.starterDeck) || cardData.cards.length === 0) {
    throw new Error('The card file must define cards and a starter deck.');
  }
  const cardDatabase = Object.fromEntries(cardData.cards.map((card) => [card.id, card]));
  if (
    Object.keys(cardDatabase).length !== cardData.cards.length ||
    cardData.cards.some((card) =>
      typeof card.id !== 'string' ||
      !Array.isArray(card.effects) ||
      !card.log ||
      (card.upgrade !== undefined && (
        !card.upgrade ||
        typeof card.upgrade !== 'object' ||
        typeof card.upgrade.description !== 'string' ||
        (card.upgrade.costReduction !== undefined &&
          (!Number.isInteger(card.upgrade.costReduction) ||
            card.upgrade.costReduction < 0 ||
            card.upgrade.costReduction > card.cost))
      )) ||
      card.effects.some((effect) =>
        !effect ||
        typeof effect !== 'object' ||
        effect.upgradeAmount !== undefined &&
        (!Number.isFinite(effect.upgradeAmount) || effect.upgradeAmount < 0)
      )
    ) ||
    cardData.starterDeck.some((cardId) => !Object.hasOwn(cardDatabase, cardId))
  ) {
    throw new Error('The card file contains invalid or duplicate card data.');
  }

  if (!Array.isArray(relicData.relics) || relicData.relics.length === 0) {
    throw new Error('The relic file must define at least one relic.');
  }
  const relicDatabase = Object.fromEntries(relicData.relics.map((relic) => [relic.id, relic]));
  const supportedRelicEffects = [
    { trigger: 'stageStart', type: 'startingEnergy' },
    { trigger: 'attackPlayed', type: 'gainBlock' }
  ];
  if (
    Object.keys(relicDatabase).length !== relicData.relics.length ||
    relicData.relics.some((relic) =>
      typeof relic.id !== 'string' ||
      typeof relic.name !== 'string' ||
      typeof relic.description !== 'string' ||
      !Array.isArray(relic.effects) ||
      relic.effects.some((effect) =>
        !effect ||
        typeof effect !== 'object' ||
        !supportedRelicEffects.some((supported) =>
          supported.trigger === effect.trigger && supported.type === effect.type
        ) ||
        !Number.isFinite(effect.amount) ||
        effect.amount <= 0
      )
    )
  ) {
    throw new Error('The relic file contains invalid or duplicate relic data.');
  }

  return {
    artAssets: manifest.portraits,
    cardDatabase,
    encounters,
    relicDatabase,
    starterDeck: cardData.starterDeck
  };
}
