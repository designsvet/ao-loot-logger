/**
 * Local patch (Guild Butler, 2026-09-28) — a container is keyed by its GUID once it has one.
 *
 * Two events name a container two different ways. EvNewLootChest / EvNewLoot register a
 * chest or a corpse by OBJECT id, with no GUID; EvAttachItemContainer opens one with both,
 * and every later put and detach names it by GUID alone.
 *
 * Upstream kept one entry per object id, which is wrong for a bank: every tab of it attaches
 * under the SAME object id with its own GUID (measured 2026-09-28 in a hideout: four tabs,
 * all id 76). Opening a second tab took over the first tab's entry and rewrote its GUID, so
 * a deposit into the first tab no longer found the container it went into, and the put-item
 * deposit guard (ev-inventory-put-item.js) let it through as loot.
 *
 * So an entry is stored under its GUID once one is known, and under its object id only until
 * then. `getById` still finds either: "which chest is this object" is answered as well by an
 * entry that has since been opened.
 */
const keyOf = ({ uuid, id }) => (uuid != null ? `uuid:${uuid}` : `id:${id}`)

class ContainersStorage {
  constructor() {
    this.containers = {}
  }

  add({ uuid, id, type, owner, items = {} }) {
    const container = { uuid, id, type, owner, items }

    this.containers[keyOf(container)] = container

    return container
  }

  /** Give an id-registered container the GUID it has just attached under. */
  bind(container, uuid) {
    delete this.containers[keyOf(container)]
    container.uuid = uuid
    this.containers[keyOf(container)] = container

    return container
  }

  deleteByUUID(uuid) {
    const container = this.getByUUID(uuid)

    if (container) {
      delete this.containers[keyOf(container)]
    }

    return container
  }

  /** The container registered under this object id, preferring one not yet opened. */
  getById(id) {
    return this.containers[`id:${id}`] ?? Object.values(this.containers).find((c) => c.id === id)
  }

  getByUUID(uuid) {
    return uuid == null ? undefined : this.containers[`uuid:${uuid}`]
  }
}

module.exports = ContainersStorage
