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
