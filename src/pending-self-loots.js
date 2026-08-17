const LootLogger = require('./loot-logger')

/**
 * Local patch (Guild Butler, 2026-08-17).
 *
 * Your OWN pickups are attributed to `MemoryStorage.players.self`, and self is
 * only ever set by OpJoin — which the client sends when you join a map, i.e. at
 * login or on a zone change. Start the logger while already standing in a zone
 * and every item you loot until your next zone change was DROPPED with a
 * "SELF not detected yet" warning: silently missing loot in a tool whose whole
 * job is not missing loot.
 *
 * Instead of dropping them, hold them here and flush once self is known. The
 * attribution is safe by construction: these are your own inventory events, so
 * the looter is you whatever your name turns out to be. Order is preserved and
 * each entry keeps the timestamp it actually happened at, not the flush time.
 *
 * Bounded, because "held forever" is its own leak: if self is never identified
 * (you never change zone before quitting) the oldest entries are discarded.
 */

const MAX_PENDING = 500

const pending = []

let warned = false

function push(entry) {
  pending.push(entry)

  if (pending.length > MAX_PENDING) {
    pending.shift()
  }

  if (!warned) {
    warned = true

    console.info(
      '\n\tYour character is not identified yet, so your own pickups are being HELD, not logged.' +
        '\n\tChange zone (or relog) once and they will be written to the log file.\n'
    )
  }
}

function flush(self) {
  if (self == null || pending.length === 0) {
    return
  }

  const held = pending.splice(0, pending.length)

  for (const entry of held) {
    LootLogger.write({ ...entry, lootedBy: self })
  }

  warned = false

  console.info(`\n\t${held.length} held pickup(s) written now that your character is identified.\n`)
}

function size() {
  return pending.length
}

module.exports = { push, flush, size }
