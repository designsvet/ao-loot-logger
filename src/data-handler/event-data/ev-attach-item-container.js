const MemoryStorage = require('../../storage/memory-storage')
const uuidStringify = require('../../utils/uuid-stringify')
const Logger = require('../../utils/logger')
const ChestWindow = require('../../storage/chest-window')
const AssignmentWritten = require('../../storage/assignment-written')
const ParserError = require('../parser-error')

const name = 'EvAttachItemContainer'

function handle(event) {
  // Activity, not attribution. This fires for EVERY container you open —
  // your bank, a mount bag, the hideout chest you are depositing into — so
  // it may open the debug-dump window and nothing else. It used to extend the
  // chest-name window too, which is how a deposit was logged as chest loot.
  ChestWindow.touch()

  Logger.debug('EvAttachItemContainer', event.parameters)

  const { id, uuid, inventory, slots } = parse(event)

  let container =
    MemoryStorage.containers.getByUUID(uuid) ??
    MemoryStorage.containers.getById(id)

  if (container == null) {
    container = MemoryStorage.containers.add({ uuid, id })
  }

  if (container.uuid !== uuid) {
    container.uuid = uuid
  }

  if (container.id !== id) {
    container.id = id
  }

  const containerSize = inventory.length

  for (let position = 0; position < containerSize; position++) {
    const objectId = inventory[position]
    const loot = MemoryStorage.loots.getById(objectId)

    if (loot == null) {
      continue
    }

    if (!loot.owner) {
      loot.owner = container.owner
    }

    container.items[position] = loot
  }

  // The one attach that MAY re-arm attribution: this container resolved to a
  // chest that named itself (EvNewLootChest registered it and the ids matched).
  // Emptying one chest takes minutes and its contents re-attach as you go, so
  // without this a long chest keeps only a 90-second window. It cannot fire on
  // your bank, a mount bag or a hideout chest: those attach with no owner,
  // which is exactly why an ownerless pickup is dropped in the first place.
  if (container.owner) {
    ChestWindow.named(container.owner)
  }

  // Local patch: our own chest share (storage/assignment-written.js). An attach
  // of the chest it was assigned from means that chest is still being emptied,
  // so its entries stay matchable by type. And the first attach after an
  // assignment of ours says whether this chest holds the objects the assignment
  // named ours — the check behind two open questions: whether an assignment's
  // object ids are the ones the chest and the pickups use, and what an entry
  // beyond the chest's own objects is (2026-09-14: 14 of ours, a 10-object chest).
  AssignmentWritten.touch(id)

  const ours = AssignmentWritten.takeExpected(id)

  if (ours != null) {
    const objects = inventory.filter((objectId) => typeof objectId === 'number' && objectId > 0)
    const held = new Set(objects)
    const report = {
      sourceObjectId: id,
      source: container.owner,
      ours: ours.length,
      objects: objects.length,
      missing: ours.filter((objectId) => !held.has(objectId))
    }

    if (report.missing.length > 0 || report.ours > report.objects) {
      Logger.warn('EvAttachItemContainer: the chest does not hold every object the assignment named ours', report)
    } else {
      Logger.debug('EvAttachItemContainer: the chest holds every object the assignment named ours', report)
    }
  }

  Logger.debug('EvAttachItemContainer', container, event.parameters)
}

function parse(event) {
  const id = event.parameters[0]

  if (typeof id !== 'number') {
    throw new ParserError('EvAttachItemContainer has invalid id parameter')
  }

  const encodedUuid = event.parameters[1]

  if (!Array.isArray(encodedUuid) || encodedUuid.length !== 16) {
    throw new ParserError('EvAttachItemContainer has invalid uuid parameter')
  }

  const inventory = event.parameters[3]

  if (!Array.isArray(inventory)) {
    throw new ParserError('EvAttachItemContainer has invalid inventory parameter')
  }

  const slots = event.parameters[4]

  if (typeof slots !== 'number') {
    throw new ParserError('EvAttachItemContainer has invalid slots parameter')
  }

  const uuid = uuidStringify(encodedUuid)

  return { id, uuid, inventory, slots }
}
module.exports = { name, handle, parse }
