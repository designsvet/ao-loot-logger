/**
 * Local patch (Guild Butler, 2026-08-19) — chest loot attribution.
 *
 * Chest pickups are NOT announced by EvOtherGrabbedLoot; that event is
 * corpse/bag scoped. Chests use a two-phase pair instead:
 *
 *   PartyLootItems (302)        — assignment. Parallel arrays: item object ids,
 *                                 item type ids, qualities, amounts, and at
 *                                 parameter 10 a string[] of PLAYER NAMES, one
 *                                 per item. This is the attribution.
 *   PartyLootItemsRemoved (303) — commit. Only source id + item object ids; NO
 *                                 name. The name comes from joining back to the
 *                                 assignment cached here.
 *
 * So a line is written on 303, using what 302 told us. Nothing is written on
 * assignment alone: 302 says who an item is EARMARKED for, 303 says it actually
 * left the chest.
 *
 * Bounded so a long session cannot grow it without limit — a chest that is never
 * emptied simply ages out of the cache.
 */

const MAX_PENDING = 5000;

const pending = new Map();

const put = (itemObjectId, entry) => {
  if (pending.size >= MAX_PENDING) {
    const oldest = pending.keys().next().value;
    pending.delete(oldest);
  }
  pending.set(itemObjectId, entry);
};

const take = (itemObjectId) => {
  const entry = pending.get(itemObjectId);

  if (entry != null) {
    pending.delete(itemObjectId);
  }

  return entry;
};

const size = () => pending.size;

module.exports = { put, take, size };
