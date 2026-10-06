const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const {
  fresh,
  useFakeClock,
  attachEvent,
  newLootChestEvent,
  putItemEvent,
  joinEvent,
  moveEvent,
  INVENTORY_UUID
} = require('./helpers')

// Every re-require of loot-logger registers a process exit handler.
process.setMaxListeners(80)

/**
 * Object 609 of the owner's recording of 2026-09-16, from the dungeon to the island — and the line
 * the engine wrote for it at 17:44:49.958Z: the member picked up four Elder's Spiked Gauntlets from
 * BOSSLAIR_CHEST_UNDEAD_VETERAN_RARE. They had taken them out of their own island storage.
 *
 * 609 was three objects in three maps:
 *   16:56:59  a random dungeon: Expert's Relic ×2 in the boss-lair chest (container 5). Not picked up.
 *   17:42:32  the first island: Master Animal Skinner Tome ×1.
 *   17:44:44  the second island: Elder's Spiked Gauntlets ×4 crafted by the member, in a storage tab,
 *             moved to the inventory at 17:44:49.958.
 * Seventeen zone joins lie between the first and the last. The item handlers updated 609 in place
 * each time and kept the chest's name, and the storage attach does not overwrite a name already
 * held, so the move out of the storage tab was written as a pickup from the boss-lair chest.
 *
 * The fixture was cut by tools/extract-object-fixture.js: the member is "Me", every GUID and
 * instance id is faked, numbers are as recorded. Item names come from the table the engine had
 * cached on 2026-09-21 — positional, so the next patch renumbers it.
 */

const FIXTURE = path.join(__dirname, 'fixtures', 'object-609-2026-09-16.jsonl')
const ITEMS = {
  465: { itemId: 'T6_SKILLBOOK_GATHER_HIDE', itemName: 'Master Animal Skinner Tome' },
  2015: { itemId: 'T5_RELIC', itemName: "Expert's Relic" },
  9484: { itemId: 'T8_2H_KNUCKLES_SET3', itemName: "Elder's Spiked Gauntlets" }
}
const CHEST = 'BOSSLAIR_CHEST_UNDEAD_VETERAN_RARE'

const records = fs
  .readFileSync(FIXTURE, 'utf8')
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line))

const session = (t) => {
  const mods = fresh()
  const clock = useFakeClock(t)
  const written = []
  const DataHandler = require('../src/data-handler/data-handler')

  mods.Logger.debug = () => {}
  mods.Logger.warn = () => {}
  mods.LootLogger.write = (row) => written.push(row)
  mods.Items.use({
    items: Object.fromEntries(Object.entries(ITEMS).map(([index, entry]) => [index, { itemNumId: Number(index), ...entry }])),
    count: Object.keys(ITEMS).length,
    digest: 'fixture',
    etag: 'fixture'
  })
  delete process.env.LOG_UNKNOWN_SOURCE

  const feed = (list) => {
    for (const record of list) {
      Date.now = () => Date.parse(record.at)

      const parameters = record.payload

      if (record.kind === 'event') {
        DataHandler.handleEventData({ parameters })
      } else if (record.kind === 'request') {
        DataHandler.handleRequestData({ parameters })
      } else {
        DataHandler.handleResponseData({ parameters, returnCode: 0 })
      }
    }
  }

  return { ...mods, clock, written, feed }
}

const until = (at) => records.filter((r) => r.at <= at)
const isJoin = (r) => r.kind === 'response' && r.id === 2
const rows = (written) =>
  written.map(({ itemId, quantity, lootedBy, lootedFrom }) => ({
    itemId,
    quantity,
    lootedBy: lootedBy.playerName,
    lootedFrom: lootedFrom.playerName
  }))

test('the 2026-09-16 island storage withdrawal is not written as boss-lair loot', (t) => {
  const s = session(t)

  s.feed(records)

  assert.deepEqual(rows(s.written), [], 'gauntlets out of our own storage are not a chest pickup')
})

test('the boss-lair chest still names what is taken from it while it is open', (t) => {
  const s = session(t)

  // Up to 609's second announcement in the chest (same item, same index), before the chest closed.
  s.feed(until('2026-09-16T16:57:02.060Z'))
  Date.now = () => Date.parse('2026-09-16T16:57:02.300Z')
  s.EvInventoryPutItem.handle(putItemEvent(609, records[0].payload['54']))

  assert.deepEqual(rows(s.written), [{ itemId: 'T5_RELIC', quantity: 2, lootedBy: 'Me', lootedFrom: CHEST }])
})

test('an object id announced as another item keeps no chest, even when the zone joins were not decoded', (t) => {
  const s = session(t)

  // A game update that moves OpJoin's fields makes every join fail to parse (src/storage/parse-health.js).
  // Only the dungeon's own joins are kept, so nothing tells the engine the map ever changed.
  const lastDungeonJoin = '2026-09-16T16:56:02.802Z'

  s.feed(records.filter((r) => !isJoin(r) || r.at <= lastDungeonJoin))

  assert.deepEqual(rows(s.written), [])
})

test('an object id reused for the same item in the next map keeps no chest either', (t) => {
  const s = session(t)
  const BANK_TAB = new Array(16).fill(0).map((_, i) => 40 + i)

  // Measured on the same recording: 2,826 announcements carried an id last announced in an earlier
  // map, as the SAME item index — no index change for the item handlers to notice.
  s.OpJoin.handle(joinEvent('Me'))
  s.EvNewLootChest.handle(newLootChestEvent(5, CHEST))
  s.EvNewSimpleItem.handle({ parameters: { 0: 611, 1: 2015, 2: 2 } })
  s.EvAttachItemContainer.handle(attachEvent(5, [610, 611, 612]))
  s.clock.advance(15_000)

  s.OpJoin.handle(joinEvent('Me'))
  s.clock.advance(120_000)
  s.EvNewSimpleItem.handle({ parameters: { 0: 611, 1: 2015, 2: 40 } })
  s.EvAttachItemContainer.handle(attachEvent(265, [611], BANK_TAB))
  s.OpInventoryMoveItem.handle(moveEvent(BANK_TAB, INVENTORY_UUID))
  s.clock.advance(80)
  s.EvInventoryPutItem.handle(putItemEvent(611))

  assert.deepEqual(rows(s.written), [], 'relics out of our own bank are not a chest pickup')
})
