class LootsStorage {
  constructor() {
    this.loots = {}
  }

  add({ objectId, itemNumId, itemId, itemName, quantity, owner }) {
    this.loots[objectId] = { objectId, itemNumId, itemId, itemName, quantity, owner }

    return this.loots[objectId]
  }

  /**
   * Local patch (2026-09-18): a new item table took over (Items.onZoneChange), so every item
   * still held is named by it. The new map's own objects can arrive BEFORE the OpJoin response
   * that switches tables — see op-join.js — and an item named by the old table would not match
   * a chest share named by the new one.
   */
  rename(resolve) {
    for (const loot of Object.values(this.loots)) {
      if (loot.itemNumId == null) {
        continue
      }

      const { itemId, itemName } = resolve(loot.itemNumId)

      loot.itemId = itemId
      loot.itemName = itemName
    }
  }

  /**
   * Local patch (2026-10-06): a zone change ends every item's tie to a chest.
   *
   * An item's `owner` is the chest or corpse it was attached in, and the item handlers update a
   * known object id in place, so the name outlived the map it belonged to. Object ids belong to
   * one map, and the next map numbers its objects afresh: on the owner's recording of 2026-09-16,
   * object 609 was two Expert's Relics in a boss-lair chest, and 45 minutes and 17 joins later the
   * member's own gauntlets in their island storage — and taking them out was written as a pickup
   * from that chest. A put or move with an owner skips every other guard, so the name alone did it.
   *
   * Only the name goes, never the item. The new map's objects can arrive BEFORE the OpJoin
   * response (op-join.js), and they stay held; an owner is stamped only when a container attaches,
   * and across both full recordings (2026-09-16, 2026-09-21; 113 joins) no attach arrived in the
   * two seconds before a join. Nor is a chest forgotten: a static chest keeps its object id when
   * you come back to the same map, and opening it again names its items again.
   */
  zoneChanged() {
    for (const loot of Object.values(this.loots)) {
      loot.owner = undefined
    }
  }

  deleteById(id) {
    delete this.loots[id]
  }

  getById(objectId) {
    return this.loots[objectId]
  }

  getByUUID(uuid) {
    return Object.values(this.loots).find((l) => l.uuid === uuid)
  }
}

module.exports = LootsStorage
