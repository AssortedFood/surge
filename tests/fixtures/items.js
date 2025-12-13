// Test fixtures for item matching tests

export const sampleItems = [
  { id: 1, name: 'Dragon platebody' },
  { id: 2, name: 'Dragon chainbody' },
  { id: 3, name: 'Abyssal whip' },
  { id: 4, name: 'Bandos chestplate' },
  { id: 5, name: 'Armadyl godsword' },
  { id: 6, name: 'Rune' },
  { id: 7, name: 'Gold' },
  { id: 8, name: 'Dragon claws' },
  { id: 9, name: 'Twisted bow' },
  { id: 10, name: 'Elder maul' },
  { id: 11, name: 'Dragon scimitar' },
  { id: 12, name: 'Scythe of vitur' },
  { id: 13, name: 'Saradomin godsword' },
  { id: 14, name: 'Dragon (or)' },
  { id: 15, name: 'Abyssal dagger' },
];

export const samplePostContent = {
  dragonUpdate: `
    We've made some exciting changes to dragon equipment!
    The Dragon platebody has received a significant buff to its defensive stats.
    Players can now smith Dragon chainbody at 90 Smithing.
    Dragon claws special attack now costs 45% instead of 50%.
  `,
  godwarsUpdate: `
    The God Wars Dungeon has been updated with new mechanics.
    Bandos now drops the Bandos chestplate more frequently.
    Armadyl godsword special attack has been improved.
    The Saradomin godsword now heals 10% more.
  `,
  noItemsPost: `
    This is a general game update about quality of life improvements.
    We've added new music tracks and fixed several bugs.
    The quest log interface has been redesigned.
  `,
  singleWordMatch: `
    Gold ore can now be mined faster in the mining guild.
    Rune essence is dropping more frequently from monsters.
  `,
};
