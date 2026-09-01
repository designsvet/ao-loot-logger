const path = require('path')

const SRC = path.join(__dirname, '..', 'src')

// These modules hold per-session state (the chest window, the memory storage),
// so a test that inherited another test's clock or containers would be reading
// the previous test's answer. Every test gets its own instances.
const fresh = () => {
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(SRC)) {
      delete require.cache[key]
    }
  }

  return {
    ChestWindow: require('../src/storage/chest-window'),
    GuildIdentity: require('../src/storage/guild-identity'),
    EvGuildState: require('../src/data-handler/event-data/ev-guild-state'),
    OpGuildEnergyDrain: require('../src/data-handler/response-data/op-guild-energy-drain'),
    MemoryStorage: require('../src/storage/memory-storage'),
    LootLogger: require('../src/loot-logger'),
    EvAttachItemContainer: require('../src/data-handler/event-data/ev-attach-item-container'),
    EvInventoryPutItem: require('../src/data-handler/event-data/ev-inventory-put-item'),
    EvNewLootChest: require('../src/data-handler/event-data/ev-new-loot-chest'),
    EvNewSimpleItem: require('../src/data-handler/event-data/ev-new-simple-item'),
    EvNewEquipmentItem: require('../src/data-handler/event-data/ev-new-equipment-item'),
    EvUpdateLootChest: require('../src/data-handler/event-data/ev-update-loot-chest')
  }
}

/** A clock the test drives by hand — the whole subject here is elapsed time. */
const useFakeClock = (t, startAt = 1_700_000_000_000) => {
  const real = Date.now
  let now = startAt

  Date.now = () => now

  t.after(() => {
    Date.now = real
  })

  return {
    advance: (ms) => {
      now += ms
    }
  }
}

const CONTAINER_UUID = new Array(16).fill(0).map((_, i) => i + 1)

/** EvAttachItemContainer's shape: id, uuid bytes, (skipped), inventory, slots. */
const attachEvent = (id = 4242, inventory = []) => ({
  parameters: { 0: id, 1: CONTAINER_UUID, 3: inventory, 4: 20 }
})

/** EvNewLootChest's shape: object id and the chest's own name. */
const newLootChestEvent = (id, owner) => ({ parameters: { 0: id, 3: owner } })

/** EvInventoryPutItem's shape: the item, its slot, the DESTINATION container. */
const putItemEvent = (objectId) => ({
  parameters: { 0: objectId, 1: 0, 2: CONTAINER_UUID }
})

module.exports = { fresh, useFakeClock, attachEvent, newLootChestEvent, putItemEvent, CONTAINER_UUID }
