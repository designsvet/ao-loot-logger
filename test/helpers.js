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
    EvFestivitiesUpdate: require('../src/data-handler/event-data/ev-festivities-update'),
    OpGuildEnergyDrain: require('../src/data-handler/response-data/op-guild-energy-drain'),
    OpGuildLogPage: require('../src/data-handler/response-data/op-guild-log-page'),
    OpGuildLogRequest: require('../src/data-handler/request-data/op-guild-log-request'),
    DumpWindow: require('../src/storage/dump-window'),
    PacketDump: require('../src/utils/packet-dump'),
    MemoryStorage: require('../src/storage/memory-storage'),
    LootLogger: require('../src/loot-logger'),
    EvAttachItemContainer: require('../src/data-handler/event-data/ev-attach-item-container'),
    EvInventoryPutItem: require('../src/data-handler/event-data/ev-inventory-put-item'),
    EvNewLootChest: require('../src/data-handler/event-data/ev-new-loot-chest'),
    EvNewSimpleItem: require('../src/data-handler/event-data/ev-new-simple-item'),
    EvNewEquipmentItem: require('../src/data-handler/event-data/ev-new-equipment-item'),
    EvUpdateLootChest: require('../src/data-handler/event-data/ev-update-loot-chest'),
    EvNewLoot: require('../src/data-handler/event-data/ev-new-loot'),
    EvPartyLootItems: require('../src/data-handler/event-data/ev-party-loot-items'),
    EvPartyLootItemTypesRemoved: require('../src/data-handler/event-data/ev-party-loot-item-types-removed'),
    OpInventoryMoveItem: require('../src/data-handler/request-data/op-inventory-move-item'),
    OpJoin: require('../src/data-handler/response-data/op-join'),
    PendingSelfLoots: require('../src/pending-self-loots'),
    AssignmentWritten: require('../src/storage/assignment-written'),
    OwnContainers: require('../src/storage/own-containers'),
    RecentMoves: require('../src/storage/recent-moves'),
    Items: require('../src/items'),
    Logger: require('../src/utils/logger')
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

/** Your own containers, as OpJoin announces them — distinct from any container you open. */
const INVENTORY_UUID = new Array(16).fill(0).map((_, i) => 100 + i)
const EQUIPMENT_UUID = new Array(16).fill(0).map((_, i) => 200 + i)

/** EvAttachItemContainer's shape: id, uuid bytes, (skipped), inventory, slots. */
const attachEvent = (id = 4242, inventory = []) => ({
  parameters: { 0: id, 1: CONTAINER_UUID, 3: inventory, 4: 20 }
})

/** EvNewLootChest's shape: object id and the chest's own name. */
const newLootChestEvent = (id, owner) => ({ parameters: { 0: id, 3: owner } })

/**
 * EvInventoryPutItem's shape: the item, its slot, the DESTINATION container.
 *
 * Defaults to your INVENTORY, which is where a pickup lands. It used to default
 * to the same GUID `attachEvent` gives the container you open, which modelled
 * every pickup as a put into the chest it came out of — the one shape a real
 * pickup never has, and exactly what a deposit looks like.
 */
const putItemEvent = (objectId, destination = INVENTORY_UUID) => ({
  parameters: { 0: objectId, 1: 0, 2: destination }
})

/** OpJoin's shape: your name, guild, alliance, and your own containers' GUIDs. */
const joinEvent = (playerName = 'Bors') => ({
  parameters: {
    1: new Array(16).fill(7),
    2: playerName,
    51: EQUIPMENT_UUID,
    54: INVENTORY_UUID,
    58: 'VITRYLA',
    79: ''
  }
})

/** OpInventoryMoveItem's shape: your own request to move slot → slot, container → container. */
const moveEvent = (from, to, fromSlot = 0, toSlot = 0) => ({
  parameters: { 0: fromSlot, 1: from, 3: toSlot, 4: to }
})

module.exports = {
  fresh,
  useFakeClock,
  attachEvent,
  newLootChestEvent,
  putItemEvent,
  joinEvent,
  moveEvent,
  CONTAINER_UUID,
  INVENTORY_UUID,
  EQUIPMENT_UUID
}
