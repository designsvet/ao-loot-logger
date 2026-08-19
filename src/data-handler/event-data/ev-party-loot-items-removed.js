const MemoryStorage = require('../../storage/memory-storage')
const PartyLootStorage = require('../../storage/party-loot-storage')
const LootLogger = require('../../loot-logger')
const Items = require('../../items')
const Logger = require('../../utils/logger')
const ParserError = require('../parser-error')

const name = 'EvPartyLootItemsRemoved'

/**
 * Local patch: phase TWO of chest attribution — the commit.
 *
 * This event carries only the source and the item object ids; the NAME is not
 * repeated. Joining back to the assignment cached by EvPartyLootItems is what
 * turns "an item left the chest" into "PlayerX took it" — and that join is the
 * whole reason chest loot can be attributed at all, since EvOtherGrabbedLoot
 * never fires for chests.
 */
function handle(event) {
  const { sourceObjectId, itemObjectIds } = parse(event)

  const container = MemoryStorage.containers.getById(sourceObjectId)
  // The chest's own identifier if EvNewLootChest registered it, else a stable
  // placeholder — the looted_from column must never be blank.
  const chestName = container?.owner ?? `@LOOTCHEST_${sourceObjectId}`

  let written = 0

  for (const itemObjectId of itemObjectIds) {
    const pendingItem = PartyLootStorage.take(itemObjectId)

    // Not ours to attribute: either the assignment predates this logger, or the
    // item was assigned with no name. Silence beats a guess.
    if (pendingItem == null) {
      continue
    }

    const item = Items.get(pendingItem.itemNumId)

    if (item == null) {
      Logger.debug('EvPartyLootItemsRemoved unknown item', pendingItem.itemNumId)
      continue
    }

    LootLogger.write({
      date: new Date(),
      itemId: item.itemId,
      itemName: item.itemName,
      quantity: pendingItem.quantity,
      lootedBy:
        MemoryStorage.players.getByName(pendingItem.playerName) ??
        MemoryStorage.players.add({ playerName: pendingItem.playerName }),
      lootedFrom:
        MemoryStorage.players.getByName(chestName) ?? MemoryStorage.players.add({ playerName: chestName })
    })

    written += 1
  }

  Logger.debug('EvPartyLootItemsRemoved', { sourceObjectId, removed: itemObjectIds.length, written })
}

function parse(event) {
  const sourceObjectId = event.parameters[0]

  if (typeof sourceObjectId !== 'number') {
    throw new ParserError('EvPartyLootItemsRemoved has invalid sourceObjectId parameter')
  }

  const itemObjectIds = Array.isArray(event.parameters[1]) ? event.parameters[1] : []

  return { sourceObjectId, itemObjectIds }
}

module.exports = { name, handle, parse }
