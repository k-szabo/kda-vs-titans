// Plain-state deck helpers shared by the shop and tour events.
// Every mutation keeps masterDeck coverage and pile placement consistent so
// saved runs always validate: added cards land in the discard pile, removed
// cards leave both their master entry and their active pile.

export function addInstanceToDeck(state, cardId) {
  const instance = {
    instanceId: state.nextCardInstanceId++,
    cardId,
    upgradeLevel: 0
  };
  state.masterDeck.push(instance);
  state.discardPile.push({ ...instance });
  return instance;
}

export function removeInstanceFromPiles(state, instanceId) {
  const deckIndex = state.masterDeck.findIndex((instance) => instance.instanceId === instanceId);
  if (deckIndex < 0) return null;
  const activeBuffIndex = state.buffs.findIndex((buff) => buff.instanceId === instanceId);
  const activePile = [state.drawPile, state.hand, state.discardPile, state.exhaustPile]
    .find((pile) => Array.isArray(pile) && pile.some((instance) => instance.instanceId === instanceId));
  if (activeBuffIndex < 0 && !activePile) return null;
  const [removed] = state.masterDeck.splice(deckIndex, 1);
  if (activeBuffIndex >= 0) {
    state.buffs.splice(activeBuffIndex, 1);
  } else {
    activePile.splice(activePile.findIndex((instance) => instance.instanceId === instanceId), 1);
  }
  return removed.cardId;
}
