const test = require('node:test')
const assert = require('node:assert')

const { fresh, useFakeClock, attachEvent, newLootChestEvent, putItemEvent } = require('./helpers')

// Every re-require of loot-logger registers a process exit handler.
process.setMaxListeners(50)

const CHEST = '@CHEST_TREASURE_SOLO_UNCOMMON'

/** A session with an identified character, one tracked ownerless item, and a spy. */
const session = (t) => {
  const mods = fresh()
  const clock = useFakeClock(t)
  const written = []

  mods.LootLogger.write = (row) => written.push(row)

  mods.MemoryStorage.players.self = { playerName: 'Bors', guildName: 'VITRYLA', allianceName: '' }
  // An item with no owner: anything the client did not tell us the origin of —
  // gear you logged in holding, a craft, a purchase.
  mods.MemoryStorage.loots.add({ objectId: 7, itemId: 'T5_BAG', itemName: "Expert's Bag", quantity: 1 })

  delete process.env.LOG_UNKNOWN_SOURCE

  return { ...mods, clock, written }
}

test('an ownerless pickup with no chest in play is not logged', (t) => {
  const s = session(t)

  s.EvInventoryPutItem.handle(putItemEvent(7))

  assert.deepEqual(s.written, [])
})

test('a pickup seconds after a chest names itself is logged under that chest', (t) => {
  const s = session(t)

  s.EvNewLootChest.handle(newLootChestEvent(900, CHEST))
  s.clock.advance(3_000)
  s.EvInventoryPutItem.handle(putItemEvent(7))

  assert.equal(s.written.length, 1)
  assert.equal(s.written[0].lootedFrom.playerName, CHEST)
  assert.equal(s.written[0].lootedBy.playerName, 'Bors')
})

test('an item dropped into the hideout chest after a raid is NOT loot', (t) => {
  const s = session(t)

  // The raid: a real chest, emptied.
  s.EvNewLootChest.handle(newLootChestEvent(900, CHEST))
  s.clock.advance(5_000)

  // The ride home, then the hideout: containers keep attaching the whole way —
  // your bank, a mount bag, and finally the chest being deposited into. Under
  // one clock each of these pushed the chest window forward, so the deposit was
  // attributed to a chest in another zone ten minutes earlier.
  for (let i = 0; i < 60; i++) {
    s.clock.advance(10_000)
    s.EvAttachItemContainer.handle(attachEvent())
  }

  s.EvInventoryPutItem.handle(putItemEvent(7))

  assert.deepEqual(s.written, [], 'a deposit must not be logged as loot')
})

test('an update for a chest we never saw register cannot re-arm attribution', (t) => {
  const s = session(t)

  s.EvNewLootChest.handle(newLootChestEvent(900, CHEST))
  s.clock.advance(s.ChestWindow.WINDOW_MS + 1)

  // A different chest object, never registered, so it carries no name.
  s.EvUpdateLootChest.handle({ parameters: { 0: 901 } })
  s.EvInventoryPutItem.handle(putItemEvent(7))

  assert.deepEqual(s.written, [])
})

test('emptying one chest slowly keeps its own name armed', (t) => {
  const s = session(t)

  s.EvNewLootChest.handle(newLootChestEvent(900, CHEST))

  // Two minutes of taking items — past the window, but the chest keeps saying
  // its contents changed, so it re-arms with its OWN name.
  for (let i = 0; i < 8; i++) {
    s.clock.advance(15_000)
    s.EvUpdateLootChest.handle({ parameters: { 0: 900 } })
  }

  s.EvInventoryPutItem.handle(putItemEvent(7))

  assert.equal(s.written.length, 1)
  assert.equal(s.written[0].lootedFrom.playerName, CHEST)
})

test('a pickup from a corpse is unaffected by any of this', (t) => {
  const s = session(t)

  s.MemoryStorage.loots.add({
    objectId: 8,
    itemId: 'T8_HEAD_CLOTH_SET3',
    itemName: "Elder's Scholar Cowl",
    quantity: 1,
    owner: 'DeadGuy'
  })

  s.EvInventoryPutItem.handle(putItemEvent(8))

  assert.equal(s.written.length, 1)
  assert.equal(s.written[0].lootedFrom.playerName, 'DeadGuy')
})

test('a chest re-attaching as you empty it keeps its own name armed', (t) => {
  const s = session(t)

  // Measured in a real capture (2026-08-29): a Keeper camp chest logged pickups
  // at 19:02:11 and again at 19:05:08 — 2m23s later, well past the window. The
  // chest's own container re-attaches as its contents change, and only that
  // attach may re-arm: it resolves to the container EvNewLootChest registered,
  // so it carries the chest's name.
  s.EvNewLootChest.handle(newLootChestEvent(900, CHEST))

  for (let i = 0; i < 10; i++) {
    s.clock.advance(15_000)
    s.EvAttachItemContainer.handle(attachEvent(900))
  }

  s.EvInventoryPutItem.handle(putItemEvent(7))

  assert.equal(s.written.length, 1)
  assert.equal(s.written[0].lootedFrom.playerName, CHEST)
})

test('an ownerless container re-attaching never re-arms attribution', (t) => {
  const s = session(t)

  s.EvNewLootChest.handle(newLootChestEvent(900, CHEST))

  // Your bank, a mount bag, a hideout chest: they attach under their own
  // container id and carry no owner, so they are activity and nothing more.
  for (let i = 0; i < 10; i++) {
    s.clock.advance(15_000)
    s.EvAttachItemContainer.handle(attachEvent(4242))
  }

  s.EvInventoryPutItem.handle(putItemEvent(7))

  assert.deepEqual(s.written, [])
})

// --- Deposits and your own moves are never pickups (2026-09-11) ---------------
//
// Reported 2026-09-09: the guild deposited its outpost haul at 15:16 while a
// Keeper camp chest had named itself nearby, and every deposit was written as a
// pickup from that camp chest — the same robe, counted twice.

const { joinEvent, moveEvent, CONTAINER_UUID: OPENED, INVENTORY_UUID, EQUIPMENT_UUID } = require('./helpers')

const CAMP = 'KEEPER_DYNAMIC_CAMP_PERSONAL_SMALL_LC'

test('a deposit into the chest you have open is not loot, even with a chest in play', (t) => {
  const s = session(t)

  s.OpJoin.handle(joinEvent())
  s.EvNewLootChest.handle(newLootChestEvent(900, CAMP))
  s.clock.advance(5_000)

  // The guild chest opens under its own container id, with no owner.
  s.EvAttachItemContainer.handle(attachEvent(4242))
  s.OpInventoryMoveItem.handle(moveEvent(INVENTORY_UUID, OPENED))
  s.EvInventoryPutItem.handle(putItemEvent(7, OPENED))

  assert.deepEqual(s.written, [], 'a deposit must not be logged as loot')
})

test('a deposit is recognised by where it went, before the character is even identified', (t) => {
  const s = session(t)

  s.MemoryStorage.players.self = null
  s.EvNewLootChest.handle(newLootChestEvent(900, CAMP))
  s.EvAttachItemContainer.handle(attachEvent(4242))
  s.EvInventoryPutItem.handle(putItemEvent(7, OPENED))

  assert.deepEqual(s.written, [])
  assert.equal(s.MemoryStorage.loots.getById(7), undefined, 'the item left for the chest; nothing is held for later')
})

test('unequipping near a chest is not loot', (t) => {
  const s = session(t)

  s.OpJoin.handle(joinEvent())
  s.EvNewLootChest.handle(newLootChestEvent(900, CHEST))
  s.OpInventoryMoveItem.handle(moveEvent(EQUIPMENT_UUID, INVENTORY_UUID))
  s.clock.advance(80)
  s.EvInventoryPutItem.handle(putItemEvent(7))

  assert.deepEqual(s.written, [])
})

test('taking an item out of a chest into your inventory is still loot', (t) => {
  const s = session(t)

  s.OpJoin.handle(joinEvent())
  s.EvNewLootChest.handle(newLootChestEvent(900, CHEST))

  // The chest's container attaches under an id that does not match the chest
  // (the case the window exists for), so the item carries no owner.
  s.EvAttachItemContainer.handle(attachEvent(4242))
  s.OpInventoryMoveItem.handle(moveEvent(OPENED, INVENTORY_UUID))
  s.clock.advance(80)
  s.EvInventoryPutItem.handle(putItemEvent(7))

  assert.equal(s.written.length, 1)
  assert.equal(s.written[0].lootedFrom.playerName, CHEST)
})

test('a move request explains one put, not the next', (t) => {
  const s = session(t)

  s.OpJoin.handle(joinEvent())
  s.EvNewLootChest.handle(newLootChestEvent(900, CHEST))
  s.OpInventoryMoveItem.handle(moveEvent(EQUIPMENT_UUID, INVENTORY_UUID))
  s.EvInventoryPutItem.handle(putItemEvent(7))

  // A take-all right after: no request of its own, so the unequip's request
  // must already be spent rather than excusing this one too.
  s.MemoryStorage.loots.add({ objectId: 8, itemId: 'T6_RELIC', itemName: "Master's Relic", quantity: 10 })
  s.EvInventoryPutItem.handle(putItemEvent(8))

  assert.equal(s.written.length, 1)
  assert.equal(s.written[0].itemId, 'T6_RELIC')
})

test('a request too old to be this put is ignored', (t) => {
  const s = session(t)

  s.OpJoin.handle(joinEvent())
  s.EvNewLootChest.handle(newLootChestEvent(900, CHEST))
  s.OpInventoryMoveItem.handle(moveEvent(EQUIPMENT_UUID, INVENTORY_UUID))
  s.clock.advance(s.RecentMoves.PAIR_MS + 1)
  s.EvInventoryPutItem.handle(putItemEvent(7))

  assert.equal(s.written.length, 1)
})

test('the 2026-09-09 deposit, replayed, writes nothing', (t) => {
  const s = session(t)
  const haul = [
    ['T7_ARMOR_CLOTH_ROYAL', "Grandmaster's Royal Robe", 1],
    ['T8_RUNE', "Elder's Rune", 1],
    ['T8_SOUL', "Elder's Soul", 1],
    ['T7_BAG_INSIGHT@1', "Grandmaster's Satchel of Insight", 1],
    ['T5_HEAD_CLOTH_SET3@1', "Expert's Mage Cowl", 1],
    ['T7_RELIC', "Grandmaster's Relic", 1],
    ['T4_ARTEFACT_2H_BOW_HELL', "Adept's Demonic Arrowheads", 1],
    ['T6_RELIC', "Master's Relic", 10],
    ['T7_MEAL_OMELETTE@1', 'Pork Omelette', 1]
  ]

  s.OpJoin.handle(joinEvent())
  s.EvNewLootChest.handle(newLootChestEvent(900, CAMP))
  s.EvAttachItemContainer.handle(attachEvent(4242))

  haul.forEach(([itemId, itemName, quantity], slot) => {
    const objectId = 1000 + slot

    // The server re-creates each item inside the chest, then puts it there.
    s.MemoryStorage.loots.add({ objectId, itemId, itemName, quantity })
    s.OpInventoryMoveItem.handle(moveEvent(INVENTORY_UUID, OPENED, slot, slot))
    s.clock.advance(80)
    s.EvInventoryPutItem.handle(putItemEvent(objectId, OPENED))
    s.clock.advance(400)
  })

  assert.deepEqual(s.written, [])
})

test('your own containers are learned from every 16-byte GUID the join carries', (t) => {
  const s = session(t)
  const uuid = require('../src/utils/uuid-stringify')

  s.OwnContainers.learnFromJoin({ 2: 'Bors', 51: EQUIPMENT_UUID, 54: INVENTORY_UUID, 60: [1, 2, 3] })

  assert.equal(s.OwnContainers.isOwn(uuid(INVENTORY_UUID)), true)
  assert.equal(s.OwnContainers.isOwn(uuid(EQUIPMENT_UUID)), true)
  assert.equal(s.OwnContainers.isOwn(uuid(OPENED)), false)

  // A join with no GUIDs says nothing new, so it must not forget the inventory.
  s.OwnContainers.learnFromJoin({ 2: 'Bors' })

  assert.equal(s.OwnContainers.isOwn(uuid(INVENTORY_UUID)), true)
})
