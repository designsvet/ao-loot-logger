const MemoryStorage = require('../../storage/memory-storage')
const Items = require('../../items')
const Logger = require('../../utils/logger')
const ParserError = require('../parser-error')

const name = 'EvNewEquipmentItem'

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

  Logger.debug('EvNewEquipmentItem', loot, event.parameters)
}

function parse(event) {
  const objectId = event.parameters[0]

  if (typeof objectId !== 'number') {
    throw new ParserError('EvNewEquipmentItem has invalid objectId parameter')
  }

  const itemNumId = event.parameters[1]

  if (typeof itemNumId !== 'number') {
    throw new ParserError('EvNewEquipmentItem has invalid itemNumId parameter')
  }

  const quantity = event.parameters[2]

  if (typeof quantity !== 'number') {
    throw new ParserError('EvNewEquipmentItem has invalid quantity parameter')
  }

  // Parameter layout (current game version):
  //   5: numeric value (optional, purpose unknown)
  //   6: craftedBy (string, absent for non-crafted items e.g. mob drops)
  //   7: quality, 8: durability, 9: spells, 10: passives
  const craftedBy = event.parameters[6]

  if (craftedBy != null && typeof craftedBy !== 'string') {
    throw new ParserError('EvNewEquipmentItem has invalid craftedBy parameter')
  }

  const quality = event.parameters[7] ?? 1
  const durability = event.parameters[8] ?? 0
  const spells = event.parameters[9]
  const passives = event.parameters[10]

  return { objectId, itemNumId, quantity, craftedBy, quality, durability, spells, passives }
}

module.exports = { name, handle, parse }  
