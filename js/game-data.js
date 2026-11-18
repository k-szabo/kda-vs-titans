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
    !Array.isArray(manifest.bosses) ||
    manifest.bosses.length === 0
  ) {
    throw new Error('The asset manifest must define portraits, backdrops, a card file, and at least one boss file.');
  }

  const cardDataUrl = new URL(manifest.cards, DATA_MANIFEST_URL);
  const [cardData, encounters] = await Promise.all([
    loadJson(cardDataUrl),
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
    cardData.cards.some((card) => !card.id || !Array.isArray(card.effects) || !card.log) ||
    cardData.starterDeck.some((cardId) => !cardDatabase[cardId])
  ) {
    throw new Error('The card file contains invalid or duplicate card data.');
  }

  return {
    artAssets: manifest.portraits,
    cardDatabase,
    encounters,
    starterDeck: cardData.starterDeck
  };
}
