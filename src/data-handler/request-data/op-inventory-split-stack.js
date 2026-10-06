const uuidStringify = require('../../utils/uuid-stringify')
const Logger = require('../../utils/logger')
const RecentMoves = require('../../storage/recent-moves')
const ParserError = require('../parser-error')

const name = 'OpInventorySplitStack'

/**
 * Local patch (2026-10-05): your own request to split a stack.
 *
 * The server answers it with a new object for the part split off and a put of that object into
 * the same container — measured on the 2026-09-21 recording, obj 212301 ×20 split into ×9 and a
 * new obj 212924 ×11, put into the inventory 69 ms later. With a chest in the window that put was
 * written as a pickup from the chest. Held for the put that answers it, as a move from the
 * container into itself — see storage/recent-moves.js.
 */
function handle(event) {
  const { uuid, slot, quantity } = parse(event)

  Logger.debug('OpInventorySplitStack', { uuid, slot, quantity })

  RecentMoves.record(uuid, uuid, 'split')
}

function parse(event) {
  const slot = event.parameters[0] ?? 0

  if (typeof slot !== 'number') {
    throw new ParserError('OpInventorySplitStack has invalid slot parameter')
  }

  const encodedUuid = event.parameters[1]

  if (!Array.isArray(encodedUuid) || encodedUuid.length !== 16) {
    throw new ParserError('OpInventorySplitStack has invalid encodedUuid parameter')
  }

  const quantity = event.parameters[3]

  if (typeof quantity !== 'number') {
    throw new ParserError('OpInventorySplitStack has invalid quantity parameter')
  }

  return { uuid: uuidStringify(encodedUuid), slot, quantity }
}

module.exports = { name, handle, parse }
