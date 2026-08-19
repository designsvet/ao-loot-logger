const PartyLootStorage = require('../../storage/party-loot-storage')
const Logger = require('../../utils/logger')
const ParserError = require('../parser-error')

const name = 'EvPartyLootItems'

/**
 * Local patch: phase ONE of chest attribution — the assignment.
 *
 * Parallel arrays, one entry per item. Parameter 10 is the payload that makes
 * chest loot attributable at all: a player name per item. Layout confirmed by
 * two independent implementations five years apart (JPCodeCraft/AlbionDataAvalonia
 * PartyLootItemsEvent.cs and albion-packet-hooking/AlbionPacketHandler
 * LootEventHandler.cs).
 *
 * Nothing is logged here — an assignment is not a pickup. See
 * ev-party-loot-items-removed.js.
 */
function handle(event) {
  const { sourceObjectId, itemObjectIds, itemTypeIds, amounts, playerNames } = parse(event)

  Logger.debug('EvPartyLootItems', {
    sourceObjectId,
    items: itemObjectIds.length,
    named: playerNames.length
  })

  for (let i = 0; i < itemObjectIds.length; i++) {
    const playerName = playerNames[i]

    // Without a name there is nothing to attribute, so it is not worth caching.
    if (typeof playerName !== 'string' || playerName.length === 0) {
      continue
    }

    PartyLootStorage.put(itemObjectIds[i], {
      sourceObjectId,
      itemNumId: itemTypeIds[i],
      quantity: amounts[i] ?? 1,
      playerName
    })
  }
}

const asArray = (value) => (Array.isArray(value) ? value : [])

function parse(event) {
  const sourceObjectId = event.parameters[0]

  if (typeof sourceObjectId !== 'number') {
    throw new ParserError('EvPartyLootItems has invalid sourceObjectId parameter')
  }

  const itemObjectIds = asArray(event.parameters[1])
  const itemTypeIds = asArray(event.parameters[2])
  const amounts = asArray(event.parameters[9])
  const playerNames = asArray(event.parameters[10])

  return { sourceObjectId, itemObjectIds, itemTypeIds, amounts, playerNames }
}

module.exports = { name, handle, parse }
