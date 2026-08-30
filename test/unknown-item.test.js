const test = require('node:test')
const assert = require('node:assert')

const { fresh } = require('./helpers')

process.setMaxListeners(50)

/**
 * An item the table does not know is still an item.
 *
 * `Items.init()` fetches ao-bin-dumps at startup and falls back to a list frozen
 * at build time, so for a while after every game patch a new item has no name.
 * The two handlers for YOUR OWN items used to return on that, while
 * `EvOtherGrabbedLoot` fell back to `UNKNOWN_<id>` and logged — so another
 * player's pickup of a new item was recorded and yours vanished with a console
 * warning. A member could donate gear that never appeared in their looted column.
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
