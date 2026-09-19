const MemoryStorage = require('../../storage/memory-storage')
const Items = require('../../items')
const Logger = require('../../utils/logger')
const ParserError = require('../parser-error')

const name = 'EvNewSimpleItem'

/**
 * Local patch: an item the table cannot name is still an item.
 *
 * Returning was the old behaviour and it was asymmetric in the worst direction:
 * `EvOtherGrabbedLoot` already fell back to `UNKNOWN_<id>` and logged, so
 * ANOTHER player's pickup of a new item was recorded while YOUR OWN vanished
 * with nothing but a warning on a console nobody reads. A member could donate
 * gear that never appeared in their looted column. `Items.resolve` gives every
 * handler the same answer — and since 2026-09-18 it answers `UNKNOWN_<id>` for
 * EVERY item until a current table is loaded (src/items.js), so dropping here
 * would now drop everything.
 *
 * An unnamed item is honest and joinable by id downstream; a missing one is not
 * recoverable at all.
 */
function handle(event) {
  const { objectId, itemNumId, quantity } = parse(event)

  const { itemId, itemName } = Items.resolve(itemNumId)

  let loot = MemoryStorage.loots.getById(objectId)

  if (loot == null) {
    loot = MemoryStorage.loots.add({ objectId, itemNumId, itemId, itemName, quantity })
  }

  // Local patch: the index too, so a new item table can rename what is held (LootsStorage.rename).
  if (loot.itemNumId !== itemNumId) {
    loot.itemNumId = itemNumId
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
