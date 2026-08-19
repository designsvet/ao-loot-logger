/**
 * Local patch (Guild Butler, 2026-08-19) — chest loot attribution.
 *
 * Chest pickups are NOT announced by EvOtherGrabbedLoot; that event is
 * corpse/bag scoped. Chests use an assignment/removal pair instead:
 *
 *   PartyLootItems (302)          — assignment. Parallel arrays: item object
 *                                   ids, item TYPE ids, amounts, and at
 *                                   parameter 10 a string[] of PLAYER NAMES,
 *                                   one per item. This is the attribution.
 *   PartyLootItemsRemoved (303)   — commit BY OBJECT ID. Rare in practice.
 *   PartyLootItemTypesRemoved(304)— commit BY TYPE, no object id and no name.
 *                                   This is what a real chest actually sends
 *                                   (measured 2026-08-19: a 10-item assignment
 *                                   was followed by a stream of 304s and not a
 *                                   single 303).
 *
 * So assignments are indexed BOTH ways: by object id for the 303 path, and by
 * (source, item type) for the 304 path, which can only match on type.
 *
 * Bounded, because "held forever" is its own leak.
 */

const MAX_PENDING = 5000;

/** itemObjectId -> entry */
const byObjectId = new Map();
/** `${sourceObjectId}|${itemNumId}` -> entry[] (FIFO, oldest assignment first) */
const byType = new Map();

const typeKey = (sourceObjectId, itemNumId) => `${sourceObjectId}|${itemNumId}`;

const put = (itemObjectId, entry) => {
  if (byObjectId.size >= MAX_PENDING) {
    const oldest = byObjectId.keys().next().value;
    take(oldest);
  }

  byObjectId.set(itemObjectId, entry);

  const key = typeKey(entry.sourceObjectId, entry.itemNumId);
  const queue = byType.get(key);

  if (queue == null) {
    byType.set(key, [{ ...entry, itemObjectId }]);
  } else {
    queue.push({ ...entry, itemObjectId });
  }
};

/** Consume by object id (the 303 path). */
const take = (itemObjectId) => {
  const entry = byObjectId.get(itemObjectId);

  if (entry == null) {
    return undefined;
  }

  byObjectId.delete(itemObjectId);

  const key = typeKey(entry.sourceObjectId, entry.itemNumId);
  const queue = byType.get(key);

  if (queue != null) {
    const at = queue.findIndex((q) => q.itemObjectId === itemObjectId);

    if (at >= 0) {
      queue.splice(at, 1);
    }

    if (queue.length === 0) {
      byType.delete(key);
    }
  }

  return entry;
};

/**
 * Consume by (source, type) — the 304 path.
 *
 * Returns undefined when the pending assignments for that type name MORE THAN
 * ONE player: the removal says an item of this type left the chest, not which
 * copy, so with two claimants there is no honest answer. A wrong name in a loot
 * report is worse than a missing row.
 */
const takeByType = (sourceObjectId, itemNumId) => {
  const key = typeKey(sourceObjectId, itemNumId);
  const queue = byType.get(key);

  if (queue == null || queue.length === 0) {
    return undefined;
  }

  const distinctNames = new Set(queue.map((q) => q.playerName));

  if (distinctNames.size > 1) {
    return undefined;
  }

  const entry = queue.shift();

  if (queue.length === 0) {
    byType.delete(key);
  }

  byObjectId.delete(entry.itemObjectId);

  return entry;
};

const size = () => byObjectId.size;

/** Diagnostics: what is still pending for a source, so an unmatched removal can
 *  say WHY — an id-space mismatch looks nothing like genuine ambiguity. */
const pendingFor = (sourceObjectId) => {
  const out = [];

  for (const [key, queue] of byType) {
    const [source, itemNumId] = key.split('|');

    if (Number(source) === sourceObjectId) {
      out.push({ itemNumId: Number(itemNumId), names: [...new Set(queue.map((q) => q.playerName))] });
    }
  }

  return out;
};

module.exports = { put, take, takeByType, size, pendingFor };
