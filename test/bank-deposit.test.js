const test = require('node:test')
const assert = require('node:assert')

const {
  fresh,
  useFakeClock,
  attachEvent,
  legacyAttachEvent,
  detachEvent,
  newLootChestEvent,
  putItemEvent,
  joinEvent,
  moveEvent,
  INVENTORY_UUID
} = require('./helpers')

// Every re-require of loot-logger registers a process exit handler.
process.setMaxListeners(50)

// Reported 2026-09-28: after a raid, about 30 items went into a hideout bank tab that
// three members had open. Two of their capture apps wrote every one as their OWN pickup
// from a Morgana camp chest — the same items twice over in one session. The third
// (the owner's Mac) wrote nothing, and its debug log is where the sequence below is from.
//
// Three faults lined up:
//   1. every EvAttachItemContainer threw (the slot count moved from parameter 4 to 5), so
//      no container registered and the deposit guard had nothing to match;
//   2. even parsed, bank tabs share one object id (76 here), and opening a second tab took
//      over the first tab's entry — the tab being deposited into was lost;
//   3. the chest window outlived the zone change, so the camp chest outside still named
//      whatever happened in the hideout.

const CAMP = 'MORGANA_DYNAMIC_CAMP_PERSONAL_SMALL_LC'
const BANK_ID = 76

// The four hideout bank tabs, by GUID, in the order they attached.
const TAB_A = new Array(16).fill(0).map((_, i) => 216 - i)
const TAB_B = new Array(16).fill(0).map((_, i) => 7 + i)
const TAB_C = new Array(16).fill(0).map((_, i) => 128 - i)
const TAB_D = new Array(16).fill(0).map((_, i) => 52 + i)

const session = (t) => {
  const mods = fresh()
  const clock = useFakeClock(t)
  const written = []

  mods.LootLogger.write = (row) => written.push(row)
  delete process.env.LOG_UNKNOWN_SOURCE

  return { ...mods, clock, written }
}

/** Someone else's deposit, as a watcher sees it: the item appears, then lands in the tab. */
const depositInto = (s, tab, objectId, itemId, itemName) => {
  s.MemoryStorage.loots.add({ objectId, itemId, itemName, quantity: 1 })
  s.EvInventoryPutItem.handle(putItemEvent(objectId, tab))
  s.clock.advance(400)
}

const HAUL = [
  ['T8_MAIN_ROCKMACE_KEEPER', "Elder's Bedrock Mace"],
  ['T7_MOUNT_ARMORED_SWAMPDRAGON_BATTLE', 'Venom Basilisk'],
  ['T4_CAPEITEM_FW_LYMHURST@2', "Adept's Lymhurst Cape"],
  ['UNIQUE_MOUNT_GIANT_HORSE_ADC', 'Gallant Horse'],
  ['T6_2H_TOOL_SIEGEHAMMER', "Master's Siege Hammer"]
]

test('an attach in the post-patch shape registers its container', (t) => {
  const s = session(t)
  const uuid = require('../src/utils/uuid-stringify')

  s.EvAttachItemContainer.handle(attachEvent(BANK_ID, [], TAB_C))

  assert.notEqual(s.MemoryStorage.containers.getByUUID(uuid(TAB_C)), undefined)
})

test('an attach in the pre-patch shape still registers its container', (t) => {
  const s = session(t)
  const uuid = require('../src/utils/uuid-stringify')

  s.EvAttachItemContainer.handle(legacyAttachEvent(BANK_ID, [], TAB_C))

  assert.notEqual(s.MemoryStorage.containers.getByUUID(uuid(TAB_C)), undefined)
})

test('bank tabs sharing one object id stay separate containers', (t) => {
  const s = session(t)
  const uuid = require('../src/utils/uuid-stringify')

  s.EvAttachItemContainer.handle(attachEvent(BANK_ID, [], TAB_C))
  s.EvAttachItemContainer.handle(attachEvent(BANK_ID, [], TAB_A))
  s.EvDetachItemContainer.handle(detachEvent(TAB_A))

  assert.notEqual(s.MemoryStorage.containers.getByUUID(uuid(TAB_C)), undefined, 'tab C is still open')
  assert.equal(s.MemoryStorage.containers.getByUUID(uuid(TAB_A)), undefined, 'tab A closed')
})

test('the 2026-09-28 hideout deposit, replayed with a camp chest in the window, writes nothing', (t) => {
  const s = session(t)

  s.OpJoin.handle(joinEvent('Flaiton'))

  // Named AFTER the join, so the window is live and only the container fixes stand
  // between these deposits and the log.
  s.EvNewLootChest.handle(newLootChestEvent(41150, CAMP))
  s.clock.advance(5_000)

  // The tab sequence from the owner's log, 18:20:17 → 18:20:29.
  s.EvAttachItemContainer.handle(attachEvent(BANK_ID, [], TAB_A))
  s.EvDetachItemContainer.handle(detachEvent(TAB_A))
  s.EvAttachItemContainer.handle(attachEvent(BANK_ID, [], TAB_B))
  s.EvDetachItemContainer.handle(detachEvent(TAB_B))
  s.EvAttachItemContainer.handle(attachEvent(BANK_ID, [], TAB_C))
  s.EvAttachItemContainer.handle(attachEvent(BANK_ID, [], TAB_A))

  depositInto(s, TAB_C, 22873, ...HAUL[0])

  s.EvDetachItemContainer.handle(detachEvent(TAB_A))
  s.EvAttachItemContainer.handle(attachEvent(BANK_ID, [], TAB_D))

  HAUL.slice(1).forEach(([itemId, itemName], i) => depositInto(s, TAB_C, 23100 + i, itemId, itemName))

  assert.deepEqual(s.written, [], 'a deposit into an open bank tab is not loot')
})

test('a camp chest from the last map does not name a bank withdrawal in this one', (t) => {
  const s = session(t)

  s.OpJoin.handle(joinEvent())
  s.EvNewLootChest.handle(newLootChestEvent(41150, CAMP))
  s.clock.advance(20_000)

  // Into the hideout, well inside 90 seconds, and straight to the bank.
  s.OpJoin.handle(joinEvent())
  s.clock.advance(10_000)
  s.EvAttachItemContainer.handle(attachEvent(BANK_ID, [], TAB_C))

  s.MemoryStorage.loots.add({ objectId: 500, itemId: 'T7_2H_KNUCKLES_SET3@3', itemName: "Grandmaster's Spiked Gauntlets", quantity: 1 })
  s.OpInventoryMoveItem.handle(moveEvent(TAB_C, INVENTORY_UUID))
  s.clock.advance(80)
  s.EvInventoryPutItem.handle(putItemEvent(500))

  assert.deepEqual(s.written, [], 'a withdrawal after a zone change is not chest loot')
})

test('a chest in the new map still names its own pickups', (t) => {
  const s = session(t)

  s.OpJoin.handle(joinEvent())
  s.EvNewLootChest.handle(newLootChestEvent(900, '@CHEST_OLD_MAP'))
  s.OpJoin.handle(joinEvent())
  s.EvNewLootChest.handle(newLootChestEvent(41150, CAMP))
  s.clock.advance(3_000)

  s.MemoryStorage.loots.add({ objectId: 7, itemId: 'T5_BAG', itemName: "Expert's Bag", quantity: 1 })
  s.EvInventoryPutItem.handle(putItemEvent(7))

  assert.equal(s.written.length, 1)
  assert.equal(s.written[0].lootedFrom.playerName, CAMP)
})

test('opening a registered chest binds it, and its contents carry its name', (t) => {
  const s = session(t)

  s.OpJoin.handle(joinEvent())
  s.EvNewLootChest.handle(newLootChestEvent(41150, CAMP))

  s.MemoryStorage.loots.add({ objectId: 8, itemId: 'T6_BAG', itemName: "Master's Bag", quantity: 1 })
  s.EvAttachItemContainer.handle(attachEvent(41150, [8], TAB_C))

  // Past the window: the name now comes from the item's owner, not from the clock.
  s.clock.advance(120_000)
  s.EvInventoryPutItem.handle(putItemEvent(8))

  assert.equal(s.written.length, 1)
  assert.equal(s.written[0].lootedFrom.playerName, CAMP)
  assert.equal(s.MemoryStorage.containers.getById(41150).owner, CAMP)
})
