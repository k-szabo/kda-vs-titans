// Member keyword identities. Single source of truth for How to Play text
// so card wording cannot drift from the documented rules.

export const MEMBER_KEYWORDS = Object.freeze({
  ahri: Object.freeze({
    name: 'Charm',
    tagline: 'control',
    description: 'Charm weakens the Kaiju: -25% attack damage while Charmed. Ahri cards apply Charm and hit harder when the Kaiju is Charmed.'
  }),
  akali: Object.freeze({
    name: 'Pierce',
    tagline: 'burst',
    description: 'Pierce ignores enemy Block. Pierce 1 ignores all Block; Pierce 50% ignores half. Akali cards spike through stacked Block.'
  }),
  evelynn: Object.freeze({
    name: 'Drain',
    tagline: 'attrition',
    description: 'Drain steals enemy Block as your Holo Shield. Drain 4 steals up to 4 Block. Evelynn wears the Kaiju down while padding your Shield.'
  }),
  kaisa: Object.freeze({
    name: 'Encore',
    tagline: 'scaling',
    description: 'Encore adds +1 damage to every Attack per stack. Kai\u2019Sa cards grant Encore and reward you for holding it.'
  })
});
