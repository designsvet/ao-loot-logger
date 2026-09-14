const MemoryStorage = require('../../storage/memory-storage')
const PartyLootStorage = require('../../storage/party-loot-storage')
const AssignmentWritten = require('../../storage/assignment-written')
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
 *
 * Our OWN share is written here as well (2026-09-14). It used to be skipped, on
 * the assumption that EvInventoryPutItem already logs our own pickups under the
 * chest's real name. Measured in the Ancient Lands that day, it does not: a solo
 * chest (DRAGON_AREA_OUTSIDE_ISLAND_CHEST_SOLO) was assigned whole to us, and no
 * EvInventoryPutItem and no OpInventoryMoveItem followed — two seconds later the
 * game moved its ten objects into our bag by itself (an inventory refresh, the
 * merged objects deleted). 58 items, and this handler's own debug line said
 * `written: 0`.
 *
 * The dedupe rule: every item of ours written here is recorded by object id in
 * storage/assignment-written.js, and EvInventoryPutItem and OpInventoryMoveItem
 * skip — and consume — an id they find there. Where the game does follow a chest
 * assignment with a pickup event (outside the Ancient Lands it did, 2026-08-19),
 * the pickup is written once, here, and not again there.
 */
function handle(event) {
  const { sourceObjectId, itemObjectIds, itemTypeIds, amounts, playerNames } = parse(event)

  const container = MemoryStorage.containers.getById(sourceObjectId)
  // Bags stay EvOtherGrabbedLoot's job — that path covers everyone nearby and
  // fires whether or not you are partied.
  const isChest = container == null || container.type === 'chest'
  const chestName = container?.owner ?? `@LOOTCHEST_${sourceObjectId}`
  const self = MemoryStorage.players.self
  const selfName = self?.playerName

  let written = 0
  let ours = 0

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

    if (!isChest) {
      continue
    }

    const item = Items.get(itemTypeIds[i])

    if (item == null) {
      continue
    }

    const isSelf = playerName === selfName

    // Attributed HERE rather than on removal. Party loot distributes a chest's
    // contents to named members, and this event carries the exact name per item;
    // the removals that follow identify items only by TYPE, which is unmatchable
    // whenever two members are owed the same type — measured 2026-08-19, that
    // lost 11 of 16 removals on a 92-item chest.
    //
    // The trade-off, stated plainly: if a distribution is ever reassigned or
    // abandoned, this logs a pickup that did not happen. That now includes our
    // own share, which used to wait for a pickup event the Ancient Lands never
    // send. Silence for most of a chest is the worse failure for a loot report,
    // and the officer is the judge.
    LootLogger.write({
      date: new Date(),
      itemId: item.itemId,
      itemName: item.itemName,
      quantity: amounts[i] ?? 1,
      lootedBy: isSelf
        ? self
        : MemoryStorage.players.getByName(playerName) ?? MemoryStorage.players.add({ playerName }),
      lootedFrom:
        MemoryStorage.players.getByName(chestName) ?? MemoryStorage.players.add({ playerName: chestName })
    })

    written += 1

    if (isSelf) {
      ours += 1
    }

    // Held back from the pickup handlers, so they do not write it again. Before
    // OpJoin no name can be recognised as ours: every name is then written under
    // the name the chest gave it, as it always was, and every id is held back —
    // those handlers only ever see our own pickups. No pending-self-loots hold is
    // needed on this path: unlike a put-item, the assignment names its looter,
    // and OpJoin adopts that same player record as self.
    if (isSelf || self == null) {
      AssignmentWritten.mark(itemObjectIds[i])
    }
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
    written,
    ours
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
