const uuidStringify = require('../utils/uuid-stringify')

/**
 * Local patch (Guild Butler, 2026-09-11) — which containers are YOURS.
 *
 * OpJoin, sent at login and on every zone change, carries your own containers'
 * GUIDs as 16-byte parameters. Measured on a real session (2026-09-10, 28
 * joins): the inventory (every item dragged out of it went into a chest; every
 * reward landed in it) and the equipment (a gear swap moved items between the
 * two) sat at the same two indices every time, beside three more constant GUIDs
 * and one that changed per zone.
 *
 * Every 16-byte parameter is taken rather than those two indices. Positions
 * drift with game patches — op-join.js reads the guild and alliance by index
 * and has had to move them — and the two mistakes are not equal: a GUID that is
 * not a container can never match one, while a stale index would silently stop
 * recognising your inventory.
 */

let own = new Set()

const isByteGuid = (value) =>
  Array.isArray(value) && value.length === 16 && value.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)

const learnFromJoin = (parameters) => {
  const next = new Set(Object.values(parameters ?? {}).filter(isByteGuid).map((value) => uuidStringify(value)))

  // A join that carried none tells us nothing new; keep what we knew.
  if (next.size > 0) {
    own = next
  }
}

const isOwn = (uuid) => uuid != null && own.has(uuid)

module.exports = { learnFromJoin, isOwn }
