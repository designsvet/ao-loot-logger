const MemoryStorage = require('../../storage/memory-storage')
const Items = require('../../items')
const Logger = require('../../utils/logger')
const ParserError = require('../parser-error')

const name = 'EvNewSimpleItem'

/**
 * Local patch: an item the table does not know is still an item.
 *
 * `Items.init()` fetches ao-bin-dumps at startup and falls back to a list
 * frozen at build time, so for a while after every game patch a new item has no
 * name here. Returning was the old behaviour and it is asymmetric in the worst
 * direction: `EvOtherGrabbedLoot` already falls back to `UNKNOWN_<id>` and logs,
 * so ANOTHER player's pickup of a new item was recorded while YOUR OWN vanished
 * with nothing but a warning on a console nobody reads. A member could donate
 * gear that never appeared in their looted column.
 *
 * An unnamed item is honest and joinable by id downstream; a missing one is not
 * recoverable at all.
 */
const withFallback = (item, itemNumId) => {
  return item ?? { itemId: `UNKNOWN_${itemNumId}`, itemName: `Unknown Item (${itemNumId})` }
}

function handle(event) {
  const { objectId, itemNumId, quantity } = parse(event)

  const found = Items.get(itemNumId)

  if (found == null) {
    Logger.warn(`item num id not found`, itemNumId)
  }

  const { itemId, itemName } = withFallback(found, itemNumId)

  let loot = MemoryStorage.loots.getById(objectId)

  if (loot == null) {
    loot = MemoryStorage.loots.add({ objectId, itemId, itemName, quantity })
  }

  if (loot.itemId !== itemId) {
    loot.itemId = itemId
  }

  if (loot.itemName !== itemName) {
    loot.itemName = itemName
  }

  if (loot.quantity !== quantity) {
    loot.quantity = quantity
  }

  Logger.debug('EvNewSimpleItem', loot, event.parameters)
}

function parse(event) {
  const objectId = event.parameters[0]

  if (typeof objectId !== 'number') {
    throw new ParserError('EvNewSimpleItem has invalid objectId parameter')
  }

  const itemNumId = event.parameters[1]

  if (typeof itemNumId !== 'number') {
    throw new ParserError('EvNewSimpleItem has invalid itemNumId parameter')
  }

  const quantity = event.parameters[2]

  if (typeof quantity !== 'number') {
    throw new ParserError('EvNewSimpleItem has invalid quantity parameter')
  }

  const craftedBy = event.parameters[5]

  if (typeof craftedBy === 'string') {
    throw new ParserError('EvNewSimpleItem should not have craftedBy parameter')
  }

  return { objectId, itemNumId, quantity }
}

module.exports = { name, handle, parse }
