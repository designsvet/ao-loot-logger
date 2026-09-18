const MemoryStorage = require('../../storage/memory-storage')
const Items = require('../../items')
const Logger = require('../../utils/logger')
const ParserError = require('../parser-error')

const name = 'EvNewSiegeBannerItem'

function handle(event) {
  const { objectId, itemNumId, quantity } = parse(event)

  // Local patch: registered as UNKNOWN_<id> when the table cannot name it, like
  // every other item (ev-new-simple-item.js), instead of being dropped.
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

  Logger.debug('EvNewSiegeBannerItem', loot, event.parameters)
}

function parse(event) {
  const objectId = event.parameters[0]

  if (typeof objectId !== 'number') {
    throw new ParserError('EvNewSiegeBannerItem has invalid objectId parameter')
  }

  const itemNumId = event.parameters[1]

  if (typeof itemNumId !== 'number') {
    throw new ParserError('EvNewSiegeBannerItem has invalid itemNumId parameter')
  }

  const quantity = event.parameters[2]

  if (typeof quantity !== 'number') {
    throw new ParserError('EvNewSiegeBannerItem has invalid quantity parameter')
  }

  // craftedBy moved from index 5 to 6 in the current game version
  // and is absent for non-crafted items
  const craftedBy = event.parameters[6]

  if (craftedBy != null && typeof craftedBy !== 'string') {
    throw new ParserError('EvNewSiegeBannerItem has invalid craftedBy parameter')
  }

  return { objectId, itemNumId, quantity }
}

module.exports = { name, handle, parse }
