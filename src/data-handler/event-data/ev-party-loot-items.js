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
 * chest (DRAGON_AREA_OUTSIDE_ISLAND_CHEST_SOLO) was assigned to us, every name in
 * the assignment ours, and no EvInventoryPutItem and no OpInventoryMoveItem
 * followed. Two seconds later the game moved the chest's ten objects, 58 items,
 * into our bag by itself (an inventory refresh, the merged objects deleted), and
 * this handler's own debug line said `written: 0`. That line counted 14 entries
 * against those ten objects. The arrays were not logged, so what the other four
 * were is not known; whenever an assignment names us, they are logged in full now.
 *
 * Where the game does follow a chest assignment with a pickup event (outside the
 * Ancient Lands it did, 2026-08-19), storage/assignment-written.js keeps that
 * pickup from writing our share a second time. It matches by object id, which
 * ASSUMES that parameter 1 holds the ids the pickup will carry (no captured packet
 * has shown that yet), and otherwise by chest and item type within the chest
 * window. The second match is required: a pickup event carries the id of the
 * object in the DESTINATION slot (measured 2026-09-14), so a chest item that
 * merges into or splits from one of our stacks never arrives under its own id. A
 * pickup under another id that arrives after the window can still write a second
 * row.
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
  const marked = []

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

    // Not an item index at all: a payload shape these indices miss.
    if (typeof itemTypeIds[i] !== 'number') {
      continue
    }

    // An item the table cannot name is still assigned to someone. It used to be
    // skipped here, which was a silently missing line for anything newer than
    // the table — and, since there is no fallback table any more (src/items.js),
    // would be every line until a current one loads. Written as UNKNOWN_<id>.
    const item = Items.resolve(itemTypeIds[i])

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
    // send. An entry whose object the chest never delivers is written the same
    // way: the one real assignment of ours (2026-09-14) named 14 entries against
    // a 10-object chest. The chest's first attach after the assignment warns when
    // that happens, with the ids (ev-attach-item-container.js). Silence for most
    // of a chest is the worse failure for a loot report, and the officer is the
    // judge.
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
    // the name the chest gave it, as it always was, and every entry is held back —
    // those handlers only ever see our own pickups. No pending-self-loots hold is
    // needed on this path: unlike a put-item, the assignment names its looter,
    // and OpJoin adopts that same player record as self.
    if (isSelf || self == null) {
      AssignmentWritten.mark({ objectId: itemObjectIds[i], sourceObjectId, chestName, itemId: item.itemId })
      marked.push(itemObjectIds[i])
    }
  }

  if (marked.length > 0) {
    AssignmentWritten.expectInChest(sourceObjectId, marked)
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

  // An assignment of ours, raw. The summary above was all the 2026-09-14 capture
  // kept, and it could not say what four of its 14 entries were, nor whether
  // parameter 1 holds the ids the pickups carry. Joined, so a long chest is not
  // cut short by the formatter.
  if (marked.length > 0 || (selfName != null && playerNames.includes(selfName))) {
    Logger.debug('EvPartyLootItems our share, raw arrays 1/2/9/10', {
      sourceObjectId,
      source: chestName,
      1: itemObjectIds.join(','),
      2: itemTypeIds.join(','),
      9: amounts.join(','),
      10: playerNames.join(',')
    })
  }

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
