const test = require('node:test')
const assert = require('node:assert')

const { fresh, newLootChestEvent, putItemEvent } = require('./helpers')

// Every re-require of loot-logger registers a process exit handler.
process.setMaxListeners(50)

/**
 * Our own party-chest share: written at assignment, and written ONCE.
 *
 * Replays the Ancient Lands chest of 2026-09-14 from that capture's debug log
 * (15:00:22–15:00:24Z): DRAGON_AREA_OUTSIDE_ISLAND_CHEST_SOLO, container 3221,
 * assigned whole to Bors. The game sent no EvInventoryPutItem and no
 * OpInventoryMoveItem for it — it moved the items into the bag by itself — and
 * the engine, which skipped our own share at assignment, wrote none of it.
 *
 * Every payload is verbatim from that log except the assignment's arrays: the
 * handler logged a summary of the 302 (source 3221, names ['Bors'], self 'Bors',
 * written 0), not its arrays. They are rebuilt from the ten objects the chest
 * delivered in the same millisecond. (That summary counted 14 entries against
 * those ten objects; what the other four were is not recoverable from the log.)
 */

const CHEST_ID = 3221
const CHEST = 'DRAGON_AREA_OUTSIDE_ISLAND_CHEST_SOLO'
const MOB = '@MOB_TEST'

/** EvAttachItemContainer 15:00:22.480Z — the chest's own container, in slot order. */
const CHEST_UUID = [214, 143, 78, 130, 25, 204, 58, 77, 148, 225, 21, 127, 196, 107, 26, 204]
const chestAttach = () => ({
  parameters: {
    0: CHEST_ID,
    1: CHEST_UUID,
    2: [5, 90, 8, 3, 248, 123, 32, 70, 172, 175, 13, 183, 75, 145, 163, 223],
    3: [9747, 9748, 9749, 9750, 9751, 9752, 9753, 9754, 9755, 9756],
    4: 10,
    252: 99
  }
})

/** EvNewSimpleItem 15:00:22.479–480Z — the chest's contents. */
const CHEST_ITEMS = [
  { 0: 9747, 1: 2037, 2: 1, 4: 22822989, 252: 32 },
  { 0: 9748, 1: 2022, 2: 1, 4: 6745708, 252: 32 },
  { 0: 9749, 1: 2007, 2: 3, 4: 4013397, 252: 32 },
  { 0: 9750, 1: 2014, 2: 5, 4: 2041196, 252: 32 },
  { 0: 9751, 1: 2021, 2: 3, 4: 1410858, 252: 32 },
  { 0: 9752, 1: 2006, 2: 6, 4: 995013, 252: 32 },
  { 0: 9753, 1: 2013, 2: 9, 4: 388038, 252: 32 },
  { 0: 9754, 1: 2005, 2: 21, 4: 109653, 252: 32 },
  { 0: 9755, 1: 507, 2: 8, 252: 32 },
  { 0: 9756, 1: 194, 2: 1, 4: 44752748, 252: 32 }
]

/**
 * EvNewSimpleItem 15:00:24.326–328Z — what the game sent INSTEAD of a pickup:
 * the two objects that kept their ids, and the stacks the other eight merged
 * into (each merged object was deleted, code 27, in between).
 */
const BAG_REFRESH = [
  { 0: 9747, 1: 2037, 2: 1, 4: 22822989, 252: 32 },
  { 0: 6578, 1: 2022, 2: 5, 4: 6745708, 252: 32 },
  { 0: 6580, 1: 2007, 2: 18, 4: 4013397, 252: 32 },
  { 0: 6581, 1: 2014, 2: 22, 4: 2041196, 252: 32 },
  { 0: 6582, 1: 2021, 2: 13, 4: 1410858, 252: 32 },
  { 0: 6583, 1: 2006, 2: 25, 4: 995013, 252: 32 },
  { 0: 6584, 1: 2013, 2: 53, 4: 388038, 252: 32 },
  { 0: 6585, 1: 2005, 2: 103, 4: 109653, 252: 32 },
  { 0: 5210, 1: 507, 2: 20, 252: 32 },
  { 0: 9756, 1: 194, 2: 1, 4: 44752748, 252: 32 }
]

/** The names the engine resolved those type ids to, in the same log. */
const ITEMS = {
  2037: ['T8_RUNE', "Elder's Rune"],
  2022: ['T6_SOUL', "Master's Soul"],
  2007: ['T4_RELIC', "Adept's Relic"],
  2014: ['T5_SOUL', "Expert's Soul"],
  2021: ['T6_RUNE', "Master's Rune"],
  2006: ['T4_SOUL', "Adept's Soul"],
  2013: ['T5_RUNE', "Expert's Rune"],
  2005: ['T4_RUNE', "Adept's Rune"],
  507: ['T4_SKILLBOOK_NONTRADABLE', "Adept's Tome of Insight"],
  194: ['TREASURE_SILVERWARE_RARITY2', 'Silver Mirror']
}

const IDS = CHEST_ITEMS.map((p) => p[0])
const TYPES = CHEST_ITEMS.map((p) => p[1])
const AMOUNTS = CHEST_ITEMS.map((p) => p[2])
/** 58 — the tome's 8 among them, which the bot leaves out of its totals. */
const TOTAL = AMOUNTS.reduce((sum, n) => sum + n, 0)

const ALL_OURS = IDS.map(() => 'Bors')

/** EvPartyLootItems (302): 0 source, 1 item object ids, 2 type ids, 9 amounts, 10 names. */
const assignmentEvent = (names) => ({
  parameters: { 0: CHEST_ID, 1: IDS, 2: TYPES, 9: AMOUNTS, 10: names, 252: 302 }
})

/** EvPartyLootItemTypesRemoved (304) 15:00:22.541Z: source 3221, ten types, all cleared. */
const typesRemovedEvent = () => ({ parameters: { 0: CHEST_ID, 1: TYPES, 252: 304 } })

/** OpInventoryMoveItem, in the shape of the one at 15:49:00.283Z: from slot/container, to slot/container. */
const OUR_BAG_UUID = [27, 71, 39, 120, 43, 7, 27, 74, 181, 17, 15, 78, 207, 75, 150, 142]
const moveEvent = (fromSlot, fromUuid) => ({
  parameters: { 0: fromSlot, 1: fromUuid, 2: 2, 3: 0, 4: OUR_BAG_UUID, 5: 2, 253: 30 }
})

/** EvNewLoot: a mob's loot bag registering under the same object id. */
const newLootEvent = (owner) => ({ parameters: { 0: CHEST_ID, 3: owner, 4: [0, 0] } })

/** OpJoin: 2 name, 58 guild, 79 alliance. */
const joinEvent = (playerName) => ({ parameters: { 2: playerName, 58: 'VITRYLA', 79: '', 253: 2 } })

const session = (t, { identified = true } = {}) => {
  const mods = fresh()
  const written = []

  mods.LootLogger.write = (row) => written.push(row)
  mods.Items.items = Object.fromEntries(
    Object.entries(ITEMS).map(([num, [itemId, itemName]]) => [num, { itemNumId: Number(num), itemId, itemName }])
  )

  if (identified) {
    mods.MemoryStorage.players.self = { playerName: 'Bors', guildName: 'VITRYLA', allianceName: '' }
  }

  delete process.env.LOG_UNKNOWN_SOURCE

  return { ...mods, written }
}

/** The chest as it happened: named, assigned, filled, cleared by type. */
const replayChest = (s, names = ALL_OURS) => {
  s.EvNewLootChest.handle(newLootChestEvent(CHEST_ID, CHEST))
  s.EvPartyLootItems.handle(assignmentEvent(names))

  for (const parameters of CHEST_ITEMS) {
    s.EvNewSimpleItem.handle({ parameters })
  }

  s.EvAttachItemContainer.handle(chestAttach())
  s.EvPartyLootItemTypesRemoved.handle(typesRemovedEvent())
}

test('our own share of a chest is written at assignment, under us and the chest', (t) => {
  const s = session(t)

  replayChest(s)

  // What the Ancient Lands sent instead of a pickup. None of it is one.
  for (const parameters of BAG_REFRESH) {
    s.EvNewSimpleItem.handle({ parameters })
  }

  assert.equal(s.written.length, 10)
  assert.ok(s.written.every((row) => row.lootedBy === s.MemoryStorage.players.self))
  assert.ok(s.written.every((row) => row.lootedFrom.playerName === CHEST))
  assert.deepEqual(
    s.written.map((row) => row.itemId),
    TYPES.map((num) => ITEMS[num][0])
  )
  assert.equal(
    s.written.reduce((sum, row) => sum + row.quantity, 0),
    TOTAL
  )
})

test('a put-item for the same objects writes nothing more', (t) => {
  const s = session(t)

  replayChest(s)

  // Where the game does follow the assignment with pickups: every object once.
  for (const id of IDS) {
    s.EvInventoryPutItem.handle(putItemEvent(id))
  }

  assert.equal(s.written.length, 10, 'one assignment, one row — not two')
  assert.equal(s.AssignmentWritten.size(), 0, 'each id is consumed by the pickup it stood for')
})

test('a move out of the chest and the put-item behind it still make one row', (t) => {
  const s = session(t)

  replayChest(s)

  // The request first, the event ~100 ms later — the order seen at 15:49:00Z. A
  // move out of a CHEST writes nothing, so it must not consume the id either:
  // the put-item behind it is the one that has to be skipped.
  s.OpInventoryMoveItem.handle(moveEvent(0, CHEST_UUID))
  s.EvInventoryPutItem.handle(putItemEvent(IDS[0]))

  assert.equal(s.written.length, 10)
})

test('a move out of a source that turned out to be a bag writes nothing more', (t) => {
  const s = session(t)

  // The assignment arrives before its source registers, so it counts as a chest
  // and is written; then the source announces itself as a mob's loot bag. The bag
  // branch of OpInventoryMoveItem is the one that writes, so it must skip this.
  s.EvPartyLootItems.handle(assignmentEvent(ALL_OURS))
  s.EvNewLoot.handle(newLootEvent(MOB))

  for (const parameters of CHEST_ITEMS) {
    s.EvNewSimpleItem.handle({ parameters })
  }

  s.EvAttachItemContainer.handle(chestAttach())

  assert.equal(s.written.length, 10)

  s.OpInventoryMoveItem.handle(moveEvent(0, CHEST_UUID))

  assert.equal(s.written.length, 10)
  assert.equal(s.MemoryStorage.loots.getById(IDS[0]), undefined, 'forgotten, as a write would')
})

test("other members' assignments are unchanged", (t) => {
  const s = session(t)

  // The same chest split between us and a party-mate.
  replayChest(
    s,
    IDS.map((_, i) => (i % 2 === 0 ? 'Bors' : 'PartyMate'))
  )

  const theirs = s.written.filter((row) => row.lootedBy.playerName === 'PartyMate')
  const ours = s.written.filter((row) => row.lootedBy === s.MemoryStorage.players.self)

  assert.equal(theirs.length, 5)
  assert.equal(ours.length, 5)
  assert.ok(theirs.every((row) => row.lootedBy === s.MemoryStorage.players.getByName('PartyMate')))
  assert.ok(theirs.every((row) => row.lootedFrom.playerName === CHEST))
  assert.equal(s.AssignmentWritten.size(), 5, 'only our own ids are held back from the pickup handlers')
})

test("a bag's assignment is still left to the bag's own events", (t) => {
  const s = session(t)

  s.EvNewLoot.handle(newLootEvent(MOB))
  s.EvPartyLootItems.handle(assignmentEvent(ALL_OURS))

  assert.deepEqual(s.written, [])
  assert.equal(s.AssignmentWritten.size(), 0)

  // So our pickup from it is written the way it always was: once, by the pickup.
  for (const parameters of CHEST_ITEMS) {
    s.EvNewSimpleItem.handle({ parameters })
  }

  s.EvAttachItemContainer.handle(chestAttach())
  s.EvInventoryPutItem.handle(putItemEvent(IDS[0]))

  assert.equal(s.written.length, 1)
  assert.equal(s.written[0].lootedFrom.playerName, MOB)
})

test('before OpJoin our share is written under the name the chest gave it, and only once', (t) => {
  const s = session(t, { identified: false })

  replayChest(s)

  assert.equal(s.written.length, 10, 'the assignment names its looter, so nothing needs holding')
  assert.ok(s.written.every((row) => row.lootedBy.playerName === 'Bors'))

  // Where put-items follow, they must not be held for OpJoin and written again —
  // which is what happened before: the assignment row, then the flushed pickup.
  for (const id of IDS) {
    s.EvInventoryPutItem.handle(putItemEvent(id))
  }

  assert.equal(s.PendingSelfLoots.size(), 0)

  s.OpJoin.handle(joinEvent('Bors'))

  assert.equal(s.written.length, 10)
  assert.equal(s.MemoryStorage.players.self, s.written[0].lootedBy, 'OpJoin adopts the record the rows used')
  assert.equal(s.MemoryStorage.players.self.guildName, 'VITRYLA')
})

test('a zone change forgets the ids: the next map numbers its objects afresh', (t) => {
  const s = session(t)

  // The Ancient Lands: no pickup event ever consumes these ids.
  replayChest(s)
  s.OpJoin.handle(joinEvent('Bors'))

  // A new map, and a new object that happens to carry 9748 — a corpse's cowl.
  s.MemoryStorage.loots.add({
    objectId: 9748,
    itemId: 'T8_HEAD_CLOTH_SET3',
    itemName: "Elder's Scholar Cowl",
    quantity: 1,
    owner: 'DeadGuy'
  })
  s.EvInventoryPutItem.handle(putItemEvent(9748))

  assert.equal(s.written.length, 11)
  assert.equal(s.written[10].lootedFrom.playerName, 'DeadGuy')
})

test('the record is bounded, oldest first', () => {
  const { AssignmentWritten } = fresh()

  for (let id = 1; id <= AssignmentWritten.MAX_TRACKED + 1; id++) {
    AssignmentWritten.mark(id)
  }

  assert.equal(AssignmentWritten.size(), AssignmentWritten.MAX_TRACKED)
  assert.equal(AssignmentWritten.consume(1), false, 'the oldest went first')
  assert.equal(AssignmentWritten.consume(2), true)
})
