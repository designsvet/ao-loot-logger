const MemoryStorage = require('../../storage/memory-storage')
const PartyLootStorage = require('../../storage/party-loot-storage')
const LootLogger = require('../../loot-logger')
const Items = require('../../items')
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
 * Attribution happens HERE: this is the only event that names a player per
 * item. The removals that follow only clear the cache — see the long note at
 * the write below for why they cannot attribute.
 */
function handle(event) {
  const { sourceObjectId, itemObjectIds, itemTypeIds, amounts, playerNames } = parse(event)

  const container = MemoryStorage.containers.getById(sourceObjectId)
  // Bags stay EvOtherGrabbedLoot's job — that path covers everyone nearby and
  // fires whether or not you are partied.
  const isChest = container == null || container.type === 'chest'
  const chestName = container?.owner ?? `@LOOTCHEST_${sourceObjectId}`
  const selfName = MemoryStorage.players.self?.playerName

  let written = 0

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

    if (!isChest || playerName === selfName) {
      continue
    }

    const item = Items.get(itemTypeIds[i])

    if (item == null) {
      continue
    }

    // Attributed HERE rather than on removal. Party loot distributes a chest's
    // contents to named members, and this event carries the exact name per item;
    // the removals that follow identify items only by TYPE, which is unmatchable
    // whenever two members are owed the same type — measured 2026-08-19, that
    // lost 11 of 16 removals on a 92-item chest.
    //
    // The trade-off, stated plainly: if a distribution is ever reassigned or
    // abandoned, this logs a pickup that did not happen. Silence for most of a
    // chest is the worse failure for a loot report, and the officer is the judge.
    // The local player is skipped — EvInventoryPutItem already logs our own
    // pickups under the chest's real name.
    LootLogger.write({
      date: new Date(),
      itemId: item.itemId,
      itemName: item.itemName,
      quantity: amounts[i] ?? 1,
      lootedBy:
        MemoryStorage.players.getByName(playerName) ?? MemoryStorage.players.add({ playerName }),
      lootedFrom:
        MemoryStorage.players.getByName(chestName) ?? MemoryStorage.players.add({ playerName: chestName })
    })

    written += 1
  }

  // Log WHOSE names, not just how many. Counting them was the blind spot: a
  // chest assigning 14 items "all named" tells you nothing about whether any of
  // those names belong to someone other than you, which is the entire question.
  Logger.debug('EvPartyLootItems', {
    sourceObjectId,
    source: chestName,
    isChest,
    items: itemObjectIds.length,
    names: [...new Set(playerNames.filter((n) => typeof n === 'string' && n.length > 0))],
    self: selfName ?? '(unknown)',
    written
  })

  // An assignment that parses to nothing is either a silver distribution (silver
  // does not travel in the item arrays) or a payload shape these indices miss.
  // Only the raw keys can tell them apart, so dump them when it happens.
  if (itemObjectIds.length === 0) {
    Logger.debug('EvPartyLootItems EMPTY — raw payload', {
      keys: Object.keys(event.parameters),
      preview: Object.fromEntries(
        Object.entries(event.parameters)
          .slice(0, 12)
          .map(([k, v]) => [k, Array.isArray(v) ? `array(${v.length}): ${v.slice(0, 4).join(',')}` : v])
      )
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
