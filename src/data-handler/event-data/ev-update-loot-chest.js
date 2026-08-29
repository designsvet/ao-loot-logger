const MemoryStorage = require('../../storage/memory-storage')
const Logger = require('../../utils/logger')
const ChestWindow = require('../../storage/chest-window')
const ParserError = require('../parser-error')

const name = 'EvUpdateLootChest'

function handle(event) {
  const { id } = parse(event)

  let container = MemoryStorage.containers.getById(id)

  const type = 'chest'

  if (container == null) {
    container = MemoryStorage.containers.add({ id, type })
  }

  if (container.type !== type) {
    container.type = type
  }

  // A chest's contents changed. Re-arm attribution while you are emptying it —
  // but with THIS chest's name, and only if it has one. An update for a chest we
  // never saw register carries no name, and must not prolong another chest's.
  ChestWindow.named(container.owner)

  Logger.debug('EvUpdateLootChest', container)
}

function parse(event) {
  const id = event.parameters[0]

  if (typeof id !== 'number') {
    throw new ParserError('EvUpdateLootChest has invalid id parameter')
  }

  return { id }
}

module.exports = { name, handle, parse }
