const MemoryStorage = require('../../storage/memory-storage')
const LootLogger = require('../../loot-logger')
const Logger = require('../../utils/logger')
const PendingSelfLoots = require('../../pending-self-loots')
const ChestWindow = require('../../storage/chest-window')
const ParserError = require('../parser-error')

const name = 'EvInventoryPutItem'

/** Stands in for a container we never saw registered — honest about the gap. */
const UNKNOWN_SOURCE = '@UNKNOWN_CONTAINER'

function handle(event) {
  const { objectId } = parse(event)

  let loot = MemoryStorage.loots.getById(objectId)

  Logger.debug('EvInventoryPutItem', loot, event.parameters)

  // No tracked item at all: an inventory shuffle, nothing to log.
  if (loot == null) {
    return
  }

  // Local patch: an item whose container never registered has no owner. That
  // covers real loot (a chest that never announced itself) AND ordinary guild
  // or territory STORAGE, which is a building with access control, not a loot
  // chest — measured 2026-08-19: every container attach there was surrounded by
  // NewBuilding / AccessStatus / NewFortificationBuilding and no loot event.
  //
  // Logging storage withdrawals as loot is actively harmful downstream: it
  // inflates what a member "looted" and so drags their donation compliance down
  // for gear they merely took out of the chest. And it is redundant — the game's
  // own per-chest log already records those withdrawals WITH player names, for
  // everyone, which is strictly better than capture.
  //
  // So unknown-source pickups are opt-in. With the flag they are logged honestly
  // rather than invented; without it they are dropped, as upstream does.
  // A chest that announced itself seconds ago is a far better answer than
  // dropping the pickup: EvNewLootChest registers by OBJECT id while the items
  // arrive under a CONTAINER id, and when those do not match the item carries no
  // owner. Measured 2026-08-19: five pickups from a real chest logged nothing.
  //
  // This event fires for EVERY container the client is watching, not just your
  // backpack, and carries no direction — "I took this out of the chest" and "I
  // dropped this into the chest" arrive identically. All that keeps a deposit out
  // of the log is the guard below: no owner, no recent chest, nothing written.
  // So the chest window has to be a real window. Reported 2026-08-29: items
  // dropped into a hideout chest were logged as loot, because every container
  // attach extended the window and a chest name from an earlier raid never went
  // stale. Fixed in chest-window.js — attribution is armed by a named chest and
  // by nothing else.
  const recentChest = ChestWindow.recentChestName()

  if (!loot.owner && recentChest == null && !process.env.LOG_UNKNOWN_SOURCE) {
    return
  }

  const source = loot.owner || recentChest || UNKNOWN_SOURCE

  const lootedBy = MemoryStorage.players.self
  const lootedFrom =
    MemoryStorage.players.getByName(source) ?? MemoryStorage.players.add({ playerName: source })
  const { quantity, itemId, itemName } = loot
  const date = new Date()

  MemoryStorage.loots.deleteById(objectId)

  if (lootedBy == null) {
    // Local patch: hold it until OpJoin identifies us, instead of dropping it.
    return PendingSelfLoots.push({ date, itemId, quantity, itemName, lootedFrom })
  }

  LootLogger.write({
    date,
    itemId,
    quantity,
    itemName,
    lootedBy,
    lootedFrom
  })
}

function parse(event) {
  const objectId = event.parameters[0]

  if (typeof objectId !== 'number') {
    throw new ParserError('EvInventoryPutItem has invalid objectId parameter')
  }

  const slotId = event.parameters[1] ?? 0

  if (typeof slotId !== 'number') {
    throw new ParserError('EvInventoryPutItem has invalid slotId parameter')
  }

  const containerId = event.parameters[2]

  if (!Array.isArray(containerId)) {
    throw new ParserError('EvInventoryPutItem has invalid containerId parameter')
  }

  return { objectId }
}

module.exports = { name, handle, parse }
