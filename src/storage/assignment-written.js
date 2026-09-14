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
 * So the assignment writes, and records here the item object ids it wrote. The
 * two self-pickup handlers look an id up before writing and skip the pickup when
 * the assignment already wrote it — consuming the id, so one assignment stands
 * for one pickup and no more.
 *
 * Cleared on OpJoin: object ids belong to one map, and the next map numbers its
 * objects afresh (measured 2026-09-14: our own T6_SOUL stack was 6578 before a
 * zone change and 4604 after). An id the Ancient Lands never consumed must not
 * silence a real pickup somewhere else. Bounded as well, because "held forever"
 * is its own leak.
 */

const MAX_TRACKED = 5000

/** Insertion-ordered, so the first value is the oldest. */
const written = new Set()

const mark = (itemObjectId) => {
  if (written.size >= MAX_TRACKED) {
    written.delete(written.values().next().value)
  }

  written.add(itemObjectId)
}

/** Did the assignment already write this item? Answers once: the id is consumed. */
const consume = (itemObjectId) => written.delete(itemObjectId)

const clear = () => written.clear()

const size = () => written.size

module.exports = { mark, consume, clear, size, MAX_TRACKED }
