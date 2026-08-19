const MemoryStorage = require('../../storage/memory-storage')
const LootLogger = require('../../loot-logger')
const Logger = require('../../utils/logger')
const PendingSelfLoots = require('../../pending-self-loots')
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

  // Local patch: an item whose container never registered has no owner — which
  // happens whenever the logger starts while you are ALREADY standing at the
  // chest (the registration event fired before we were listening), and for
  // container classes that never announce themselves as loot chests. Upstream
  // dropped these outright, so a whole chest run logged nothing.
  //
  // A pickup with an unknown source is still a true pickup: WHO took WHAT is the
  // part the report is built on, and the source column is display only. So it is
  // logged with an explicit placeholder rather than discarded — never invented.
  const source = loot.owner || UNKNOWN_SOURCE

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
