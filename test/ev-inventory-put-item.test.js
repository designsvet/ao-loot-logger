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
