const PartyLootStorage = require('../../storage/party-loot-storage')
const Logger = require('../../utils/logger')
const ParserError = require('../parser-error')

const name = 'EvPartyLootItemTypesRemoved'

/**
 * Local patch: a CONSUMER, not a writer.
 *
 * This is what a real chest actually sends after an assignment — removal by item
 * TYPE and amount, with no object id and no player name. It was briefly the
 * attribution path, joining back to the assignment by (source, type), but that
 * cannot work when two party members are owed the SAME type: measured
 * 2026-08-19, a 92-item chest lost 11 of 16 removals that way. Attribution moved
 * to the assignment, which names every item exactly, and this now only clears
 * the cache.
 */
function handle(event) {
  const { sourceObjectId, itemNumIds } = parse(event)

  let cleared = 0

  for (const itemNumId of itemNumIds) {
    if (PartyLootStorage.takeByType(sourceObjectId, itemNumId) != null) {
      cleared += 1
    }
  }

  Logger.debug('EvPartyLootItemTypesRemoved', { sourceObjectId, types: itemNumIds.length, cleared })
}

function parse(event) {
  const sourceObjectId = event.parameters[0]

  if (typeof sourceObjectId !== 'number') {
    throw new ParserError('EvPartyLootItemTypesRemoved has invalid sourceObjectId parameter')
  }

  // Layout from JPCodeCraft/AlbionDataAvalonia PartyLootItemTypesRemovedEvent.cs:
  // 0 = sourceObjectId, 1 = item type ids, 4 = amounts.
  return { sourceObjectId, itemNumIds: Array.isArray(event.parameters[1]) ? event.parameters[1] : [] }
}

module.exports = { name, handle, parse }
