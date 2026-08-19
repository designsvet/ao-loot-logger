const MemoryStorage = require('../../storage/memory-storage')
const PartyLootStorage = require('../../storage/party-loot-storage')
const LootLogger = require('../../loot-logger')
const Items = require('../../items')
const Logger = require('../../utils/logger')
const ParserError = require('../parser-error')

const name = 'EvPartyLootItemTypesRemoved'

/**
 * Local patch: the commit a real chest actually sends.
 *
 * Measured 2026-08-19: a chest assigned 10 items with 10 player names (302) and
 * then sent a stream of THESE, never a single 303. The payload names an item
 * TYPE and an amount — no object id, no player — so the name comes from the
 * assignment cached at 302, matched by (source, type).
 *
 * Two deliberate silences:
 *   - the LOCAL player is skipped, because EvInventoryPutItem already logs our
 *     own pickups under the chest's real name; logging here too would double.
 *   - an ambiguous type (two party members holding an assignment for the same
 *     item type from the same chest) is skipped by the storage layer rather
 *     than guessed.
 */
function handle(event) {
  const { sourceObjectId, itemNumIds, amounts } = parse(event)

  const container = MemoryStorage.containers.getById(sourceObjectId)

  // Bags are EvOtherGrabbedLoot's job — see ev-party-loot-items-removed.js.
  if (container != null && container.type !== 'chest') {
    return
  }

  const chestName = container?.owner ?? `@LOOTCHEST_${sourceObjectId}`
  const selfName = MemoryStorage.players.self?.playerName
  let written = 0
  let skippedSelf = 0
  let ambiguous = 0

  for (let i = 0; i < itemNumIds.length; i++) {
    const pendingItem = PartyLootStorage.takeByType(sourceObjectId, itemNumIds[i])

    if (pendingItem == null) {
      ambiguous += 1

      const pending = PartyLootStorage.pendingFor(sourceObjectId)
      const sameType = pending.find((x) => x.itemNumId === itemNumIds[i])

      Logger.debug('EvPartyLootItemTypesRemoved unmatched', {
        wantedType: itemNumIds[i],
        // Present with >1 name = genuine ambiguity. Absent while other types are
        // pending = the two events disagree about what an "item type" is.
        sameTypePending: sameType ?? null,
        pendingTypes: pending.slice(0, 8).map((x) => x.itemNumId),
        pendingCount: pending.length
      })

      continue
    }

    if (selfName != null && pendingItem.playerName === selfName) {
      skippedSelf += 1
      continue
    }

    const item = Items.get(pendingItem.itemNumId)

    if (item == null) {
      continue
    }

    LootLogger.write({
      date: new Date(),
      itemId: item.itemId,
      itemName: item.itemName,
      quantity: amounts[i] ?? pendingItem.quantity ?? 1,
      lootedBy:
        MemoryStorage.players.getByName(pendingItem.playerName) ??
        MemoryStorage.players.add({ playerName: pendingItem.playerName }),
      lootedFrom:
        MemoryStorage.players.getByName(chestName) ?? MemoryStorage.players.add({ playerName: chestName })
    })

    written += 1
  }

  Logger.debug('EvPartyLootItemTypesRemoved', {
    sourceObjectId,
    types: itemNumIds.length,
    written,
    skippedSelf,
    unmatchedOrAmbiguous: ambiguous
  })
}

const asArray = (value) => (Array.isArray(value) ? value : [])

function parse(event) {
  const sourceObjectId = event.parameters[0]

  if (typeof sourceObjectId !== 'number') {
    throw new ParserError('EvPartyLootItemTypesRemoved has invalid sourceObjectId parameter')
  }

  // Layout read from JPCodeCraft/AlbionDataAvalonia PartyLootItemTypesRemovedEvent.cs:
  // 0 = sourceObjectId, 1 = item type ids, 4 = amounts.
  return {
    sourceObjectId,
    itemNumIds: asArray(event.parameters[1]),
    amounts: asArray(event.parameters[4])
  }
}

module.exports = { name, handle, parse }
