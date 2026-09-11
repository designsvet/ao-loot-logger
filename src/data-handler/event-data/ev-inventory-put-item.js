const MemoryStorage = require('../../storage/memory-storage')
const LootLogger = require('../../loot-logger')
const Logger = require('../../utils/logger')
const PendingSelfLoots = require('../../pending-self-loots')
const ChestWindow = require('../../storage/chest-window')
const OwnContainers = require('../../storage/own-containers')
const RecentMoves = require('../../storage/recent-moves')
const uuidStringify = require('../../utils/uuid-stringify')
const ParserError = require('../parser-error')

const name = 'EvInventoryPutItem'

/** Stands in for a container we never saw registered — honest about the gap. */
const UNKNOWN_SOURCE = '@UNKNOWN_CONTAINER'

function handle(event) {
  const { objectId, containerUuid } = parse(event)

  // Pair this put with the request that caused it FIRST, whatever happens
  // next: a request left unpaired here could explain a later, unrelated put.
  const from = RecentMoves.sourceOf(containerUuid)

  let loot = MemoryStorage.loots.getById(objectId)

  Logger.debug('EvInventoryPutItem', loot, event.parameters)

  // No tracked item at all: an inventory shuffle, nothing to log.
  if (loot == null) {
    return
  }

  const notPickup = loot.owner ? null : notAPickup(containerUuid, from)

  if (notPickup != null) {
    MemoryStorage.loots.deleteById(objectId)
    Logger.debug('EvInventoryPutItem not a pickup', notPickup, loot)
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

/**
 * Local patch (Guild Butler, 2026-09-11) — a put that cannot be a pickup.
 *
 * The chest window below answers "which chest was this?" for an ownerless item,
 * and it answers it for EVERY ownerless put inside its 90 seconds — including
 * two that are not loot at all. Reported 2026-09-09: a member deposited his
 * outpost haul into the guild chest at 15:16, a Keeper camp chest had named
 * itself nearby moments earlier, and nine deposits were written as nine pickups
 * from that camp chest. The robe he had looted fourteen minutes before now
 * counted twice, and so did the rest of the haul. The guild's own chest log
 * shows the party depositing in that same minute.
 *
 * The put names only its DESTINATION, so the two are told apart by where the
 * item went and where it came from:
 *
 *   1. INTO a container you have open — the chest, bank or hideout chest you
 *      are standing at. A pickup lands in your inventory, and a loot chest cannot
 *      be put into. Measured 2026-09-10: every deposit landed in the container
 *      attached moments before, and your own inventory never attached once in
 *      28 zone changes.
 *   2. FROM one of your own containers, per your own move request — an equip,
 *      an unequip, a shuffle. Measured the same day: a gear swap moved five items
 *      equipment → inventory and back, each put 60–110 ms after its request.
 *
 * Anything else — a put into your inventory from a chest, or with no request at
 * all (take-all) — falls through to the window exactly as before, so this only
 * ever removes lines, and only these two shapes. What it cannot see: a
 * WITHDRAWAL from a guild or bank chest, which lands in your inventory from a
 * container that looks like any other unnamed chest. That gap stays open.
 */
const notAPickup = (containerUuid, from) => {
  if (containerUuid == null) {
    return null
  }

  if (MemoryStorage.containers.getByUUID(containerUuid) != null && !OwnContainers.isOwn(containerUuid)) {
    return 'deposit'
  }

  if (from != null && OwnContainers.isOwn(from)) {
    return 'own-move'
  }

  return null
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

  // The DESTINATION container — the only thing this event says about where the
  // item went. Null rather than a garbage string when it is not a GUID.
  const containerUuid = containerId.length === 16 ? uuidStringify(containerId) : null

  return { objectId, containerUuid }
}

module.exports = { name, handle, parse }
