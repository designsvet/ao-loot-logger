/**
 * Local patch (Guild Butler, 2026-09-14) — our own chest share, written once.
 *
 * EvPartyLootItems names the player every chest item is assigned to, and our own
 * share is written at that moment like everyone else's (ev-party-loot-items.js).
 * Whether the game follows up with a pickup event of its own depends on the zone:
 *
 *   - the Ancient Lands, measured 2026-09-14: nothing. No EvInventoryPutItem, no
 *     OpInventoryMoveItem — the game moved the items into our bag by itself, so
 *     the assignment is the only record there will ever be;
 *   - elsewhere, measured 2026-08-19: EvInventoryPutItem logged our own chest
 *     pickups, which is why our share used to be skipped at assignment.
 *
 * So the assignment writes, and records each entry of ours here. The two
 * self-pickup handlers look a pickup up before writing it and skip it when the
 * assignment already wrote it, consuming the entry: one entry, one skip. Two ways
 * to match, because the first rests on an assumption:
 *
 *   1. By item OBJECT id. ASSUMED, not measured: that the assignment's parameter
 *      1 holds the ids the chest container and the pickup events use later. No
 *      captured assignment naming anyone has yet been followed by a pickup
 *      event, and the one real assignment of ours (2026-09-14) counted 14 entries
 *      against a 10-object chest, so parameter 1 is not simply the chest's
 *      inventory. The chest's first attach after an assignment logs whether it
 *      holds the ids (ev-attach-item-container.js).
 *   2. By chest name and item type, within WINDOW_MS of the assignment or of that
 *      chest's last attach. Needed even where (1) holds. Measured 2026-09-14, a
 *      pickup event carries the id of the object that ends up in the
 *      DESTINATION slot: chest objects that merged into our existing stacks came
 *      back as those stacks (9748 as 6578, and so on), and a split arrived as a
 *      new object (4690) while the source stack was sent again. No id match can
 *      see either, and the put-item would write the stack's TOTAL as a second
 *      row.
 *
 * The window keeps (2) from silencing a real pickup. A chest name is a type, not
 * an instance (one map holds many DRAGON_AREA_*_CHEST_SOLO), and in the Ancient
 * Lands nothing ever consumes an entry, so without it every later same-named
 * chest looted without an assignment would lose its matching types. The limit
 * that remains: a pickup under another id that arrives after the window is
 * written a second time.
 *
 * Cleared on OpJoin: object ids belong to one map, and the next map numbers its
 * objects afresh (measured 2026-09-14: our own T6_SOUL stack was 6578 before a
 * zone change and 4604 after). An id the Ancient Lands never consumed must not
 * silence a real pickup somewhere else. Bounded as well, because "held forever"
 * is its own leak.
 */

const { WINDOW_MS } = require('./chest-window')

const MAX_TRACKED = 5000
const MAX_EXPECTED = 100

/** itemObjectId -> entry. Insertion-ordered, so the first value is the oldest. */
const byId = new Map()
/** `${chestName}|${itemId}` -> entry[], oldest first. */
const byType = new Map()
/** sourceObjectId -> the object ids the assignment named ours, for one check. */
const expected = new Map()

const typeKey = (chestName, itemId) => `${chestName}|${itemId}`

const unlink = (entry) => {
  byId.delete(entry.objectId)

  const key = typeKey(entry.chestName, entry.itemId)
  const queue = byType.get(key)

  if (queue == null) {
    return
  }

  const at = queue.indexOf(entry)

  if (at >= 0) {
    queue.splice(at, 1)
  }

  if (queue.length === 0) {
    byType.delete(key)
  }
}

/** The assignment wrote this entry of ours. */
const mark = ({ objectId, sourceObjectId, chestName, itemId }) => {
  const previous = byId.get(objectId)

  if (previous != null) {
    unlink(previous)
  } else if (byId.size >= MAX_TRACKED) {
    unlink(byId.values().next().value)
  }

  const entry = { objectId, sourceObjectId, chestName, itemId, at: Date.now() }

  byId.set(objectId, entry)

  const key = typeKey(chestName, itemId)
  const queue = byType.get(key)

  if (queue == null) {
    byType.set(key, [entry])
  } else {
    queue.push(entry)
  }
}

/** Match (1), the exact object. Answers once: the entry is consumed. */
const consume = (objectId) => {
  const entry = byId.get(objectId)

  if (entry == null) {
    return false
  }

  unlink(entry)

  return true
}

/** Match (2), the same chest and item type inside the window, oldest first. */
const consumeByType = (chestName, itemId) => {
  const queue = byType.get(typeKey(chestName, itemId))

  if (queue == null) {
    return false
  }

  const now = Date.now()
  const entry = queue.find((e) => now - e.at <= WINDOW_MS)

  if (entry == null) {
    return false
  }

  unlink(entry)

  return true
}

/** That chest attached again, so it is still being emptied: re-arm its entries. */
const touch = (sourceObjectId) => {
  const now = Date.now()

  for (const entry of byId.values()) {
    if (entry.sourceObjectId === sourceObjectId) {
      entry.at = now
    }
  }
}

/** Remember which objects the assignment named ours, for the chest's next attach. */
const expectInChest = (sourceObjectId, objectIds) => {
  if (!expected.has(sourceObjectId) && expected.size >= MAX_EXPECTED) {
    expected.delete(expected.keys().next().value)
  }

  expected.set(sourceObjectId, [...(expected.get(sourceObjectId) ?? []), ...objectIds])
}

/** Those object ids, once: the check runs at the first attach after the assignment. */
const takeExpected = (sourceObjectId) => {
  const objectIds = expected.get(sourceObjectId)

  expected.delete(sourceObjectId)

  return objectIds
}

const clear = () => {
  byId.clear()
  byType.clear()
  expected.clear()
}

const size = () => byId.size

module.exports = {
  mark,
  consume,
  consumeByType,
  touch,
  expectInChest,
  takeExpected,
  clear,
  size,
  MAX_TRACKED,
  WINDOW_MS
}
