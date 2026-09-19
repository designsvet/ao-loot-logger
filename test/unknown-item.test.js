const test = require('node:test')
const assert = require('node:assert')

const { fresh } = require('./helpers')

process.setMaxListeners(50)

/**
 * An item the table does not know is still an item.
 *
 * For a while after every game patch a new item has no name here, and since
 * 2026-09-18 NO item has one until a current table loads (src/items.js — the
 * frozen fallback named nearly every index wrongly). The two handlers for YOUR
 * OWN items used to return on an unknown item, while `EvOtherGrabbedLoot` fell
 * back to `UNKNOWN_<id>` and logged — so another player's pickup of a new item
 * was recorded and yours vanished with a console warning. A member could donate
 * gear that never appeared in their looted column. The chest assignment and the
 * siege banner still dropped theirs until the same date.
 */

const NEW_TO_THE_GAME = 999_999

const withItems = (t) => {
  const mods = fresh()
  const Items = require('../src/items')
  // A table that knows one item and not the other — the state every game patch
  // puts this process into for a few hours.
  Items.items = { 1: { itemNumId: 1, itemId: 'T4_BAG', itemName: "Adept's Bag" } }
  return mods
}

test('a KNOWN item is registered under its real name', (t) => {
  const s = withItems(t)
  s.EvNewSimpleItem.handle({ parameters: { 0: 10, 1: 1, 2: 1 } })
  const loot = s.MemoryStorage.loots.getById(10)
  assert.equal(loot.itemId, 'T4_BAG')
})

test('an UNKNOWN item is still registered, honestly, instead of vanishing', (t) => {
  const s = withItems(t)
  s.EvNewSimpleItem.handle({ parameters: { 0: 11, 1: NEW_TO_THE_GAME, 2: 3 } })
  const loot = s.MemoryStorage.loots.getById(11)
  assert.ok(loot, 'the pickup must exist at all — this is the bug')
  assert.equal(loot.itemId, `UNKNOWN_${NEW_TO_THE_GAME}`)
  assert.equal(loot.quantity, 3)
})

test('the same holds for equipment, which is most of what a raid loots', (t) => {
  const s = withItems(t)
  s.EvNewEquipmentItem.handle({ parameters: { 0: 12, 1: NEW_TO_THE_GAME, 2: 1 } })
  const loot = s.MemoryStorage.loots.getById(12)
  assert.ok(loot)
  assert.equal(loot.itemId, `UNKNOWN_${NEW_TO_THE_GAME}`)
})

test('an unknown item reaches the log rather than being dropped at the pickup', (t) => {
  const s = withItems(t)
  const written = []
  s.LootLogger.write = (row) => written.push(row)
  s.MemoryStorage.players.self = { playerName: 'Bors', guildName: 'VITRYLA', allianceName: '' }

  s.EvNewSimpleItem.handle({ parameters: { 0: 13, 1: NEW_TO_THE_GAME, 2: 1 } })
  s.MemoryStorage.loots.getById(13).owner = 'DeadGuy'
  s.EvInventoryPutItem.handle({ parameters: { 0: 13, 1: 0, 2: new Array(16).fill(0) } })

  assert.equal(written.length, 1)
  assert.equal(written[0].itemId, `UNKNOWN_${NEW_TO_THE_GAME}`)
})

test('a chest assignment of an item the table does not know is still written, as UNKNOWN_<id>', (t) => {
  const s = withItems(t)
  const written = []
  s.LootLogger.write = (row) => written.push(row)

  // No container registered for 77, so it is taken as a chest; one known item, one new one.
  s.EvPartyLootItems.handle({
    parameters: { 0: 77, 1: [501, 502], 2: [1, NEW_TO_THE_GAME], 9: [1, 2], 10: ['Aly', 'Bors'], 252: 302 }
  })

  assert.deepEqual(
    written.map((row) => [row.lootedBy.playerName, row.itemId, row.quantity]),
    [
      ['Aly', 'T4_BAG', 1],
      ['Bors', `UNKNOWN_${NEW_TO_THE_GAME}`, 2]
    ],
    'the second row used to be skipped without a word'
  )
})

test('a siege banner the table does not know is still registered', (t) => {
  const s = withItems(t)
  const EvNewSiegeBannerItem = require('../src/data-handler/event-data/ev-new-siege-banner-item')

  EvNewSiegeBannerItem.handle({ parameters: { 0: 14, 1: NEW_TO_THE_GAME, 2: 1 } })

  assert.equal(s.MemoryStorage.loots.getById(14)?.itemId, `UNKNOWN_${NEW_TO_THE_GAME}`)
})

test('with NO current table — a startup that could not download one — nothing is named at all', (t) => {
  const s = fresh()
  const written = []
  s.LootLogger.write = (row) => written.push(row)

  assert.equal(s.Items.source, 'none', 'the state a failed startup leaves')

  s.EvOtherGrabbedLoot = require('../src/data-handler/event-data/ev-other-grabbed-loot')
  s.EvOtherGrabbedLoot.handle({ parameters: { 1: 'DeadGuy', 2: 'Aly', 3: false, 4: 3018, 5: 1 } })
  s.EvNewEquipmentItem.handle({ parameters: { 0: 15, 1: 3018, 2: 1 } })

  assert.equal(written[0].itemId, 'UNKNOWN_3018', "another player's pickup")
  assert.equal(s.MemoryStorage.loots.getById(15).itemId, 'UNKNOWN_3018', 'your own')
})

test('a chest assignment entry that is not an item index writes nothing, as before', (t) => {
  const s = withItems(t)
  const written = []
  s.LootLogger.write = (row) => written.push(row)

  // 0, a negative and a fraction are not positions in a list numbered from 1. UNKNOWN_0 would be
  // a pickup that never happened, and UNKNOWN_-1 a line the bot's parser refuses.
  s.EvPartyLootItems.handle({
    parameters: { 0: 78, 1: [601, 602, 603, 604], 2: [0, -1, 1.5, 1], 9: [1, 1, 1, 1], 10: ['Aly', 'Aly', 'Aly', 'Aly'], 252: 302 }
  })

  assert.deepEqual(
    written.map((row) => row.itemId),
    ['T4_BAG']
  )
})
