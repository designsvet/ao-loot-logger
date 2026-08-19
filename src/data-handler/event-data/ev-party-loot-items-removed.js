const PartyLootStorage = require('../../storage/party-loot-storage')
const Logger = require('../../utils/logger')
const ParserError = require('../parser-error')

const name = 'EvPartyLootItemsRemoved'

/**
 * Local patch: a CONSUMER, not a writer.
 *
 * Attribution happens at assignment time (ev-party-loot-items.js) because that
 * is the only event carrying a player name per item. This one reports which item
 * object ids left the chest, so its job is to clear them from the pending cache
 * — writing here too would double every line.
 *
 * Kept wired so the cache cannot grow for a whole session, and because
 * "assigned but never removed" is the signal to audit if assignment-time
 * attribution is ever doubted.
 */
function handle(event) {
  const { sourceObjectId, itemObjectIds } = parse(event)

  let cleared = 0

  for (const itemObjectId of itemObjectIds) {
    if (PartyLootStorage.take(itemObjectId) != null) {
      cleared += 1
    }
  }

  Logger.debug('EvPartyLootItemsRemoved', { sourceObjectId, removed: itemObjectIds.length, cleared })
}

function parse(event) {
  const sourceObjectId = event.parameters[0]

  if (typeof sourceObjectId !== 'number') {
    throw new ParserError('EvPartyLootItemsRemoved has invalid sourceObjectId parameter')
  }

  return { sourceObjectId, itemObjectIds: Array.isArray(event.parameters[1]) ? event.parameters[1] : [] }
}

module.exports = { name, handle, parse }
