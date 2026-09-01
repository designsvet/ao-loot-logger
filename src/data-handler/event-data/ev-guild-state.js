const ServerRegion = require('../../network/server-region')
const GuildIdentity = require('../../storage/guild-identity')

const name = 'EvGuildState'

/**
 * Local patch: the guild's siphoned-energy account total.
 *
 * The guild-state event is the server keeping the client's guild panel current. It
 * arrives unprompted and OFTEN — 32 times in 120 seconds during the investigation,
 * including before the guild screen was ever opened — which is the whole value of it:
 * the total needs no screen visit, no button, and no human.
 *
 *   15  guildName     string
 *   16  allianceTag   string
 *   17  allianceId    byte[16]   the ALLIANCE, not the guild (see storage/guild-identity)
 *   19  currencies    map        { 0: siphonedEnergy }, scaled x10000
 *   32  hideout       string
 *
 * The x10000 is passed through UNCONVERTED, like the festivity ticks: the wire's own
 * encoding is the reader's to interpret, and a scale applied in two places is a scale
 * that will one day disagree with itself. 1,291 energy leaves here as 12910000.
 *
 * Only key 0 of the currency map was ever observed. The whole map is emitted rather
 * than just that key, because a guild holding something else would otherwise produce
 * a line that silently omits it, and nobody would know to look.
 *
 * This handler only PRINTS. Same rule as the festivities handler: no storage, no
 * loot, no decisions — one line on stdout when the number moves.
 */

// A guild's stored energy is a whole number of units and cannot be negative; the wire
// value is that number x10000. The ceiling is a sanity rail, not a game rule.
const MAX_RAW = 1e15
const UNCHANGED_REPEAT_MS = 10 * 60 * 1000

let lastRaw = null
let lastEmittedAt = 0

/** The currency map, however protocol18 chose to decode it. */
function readCurrencies(value) {
  const entries = value instanceof Map ? [...value.entries()] : value && typeof value === 'object' ? Object.entries(value) : null

  if (entries === null || entries.length === 0) {
    return null
  }

  const out = {}

  for (const [key, raw] of entries) {
    const index = Number(key)
    const amount = typeof raw === 'bigint' ? Number(raw) : raw

    if (!Number.isInteger(index) || index < 0) {
      return null
    }

    if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount < 0 || amount > MAX_RAW) {
      return null
    }

    out[index] = amount
  }

  return out
}

/**
 * Read the guild-state payload, or null if this is not that event.
 *
 * Split out for the same reason as the festivities reader: the code is an ordinal that
 * game patches renumber, so the handler must be able to say "that was not this event"
 * and stay silent rather than emit a line built from another message's parameters.
 */
function read(params) {
  const guildName = params[15]
  const allianceTag = params[16]

  if (typeof guildName !== 'string' || guildName.length === 0 || guildName.length > 64) {
    return null
  }

  if (allianceTag != null && typeof allianceTag !== 'string') {
    return null
  }

  const currencies = readCurrencies(params[19])

  if (currencies === null || currencies[0] === undefined) {
    return null
  }

  return { guildName, allianceTag: allianceTag ?? null, currencies }
}

function serverToken() {
  const server = ServerRegion.getCurrentServer()

  return server && typeof server.region === 'string' ? server.region.toLowerCase() : null
}

function handle(event, nowMs = Date.now()) {
  const state = read(event.parameters)

  if (state === null) {
    return
  }

  const raw = state.currencies[0]
  const changed = raw !== lastRaw

  // Emit on every CHANGE, and otherwise once in a while. A change is the thing the
  // reader derives income from, so it must never be dropped; an unchanged reading is
  // only worth repeating often enough to prove the connection is still alive.
  if (!changed && nowMs - lastEmittedAt < UNCHANGED_REPEAT_MS) {
    return
  }

  lastRaw = raw
  lastEmittedAt = nowMs

  console.info(
    `[energy] ${JSON.stringify({
      server: serverToken(),
      code: event.parameters[252],
      guildName: state.guildName,
      allianceTag: state.allianceTag,
      // Absent until someone opens the guild screen — the reader must cope with null
      // rather than assume the name identifies the guild.
      albionGuildId: GuildIdentity.getGuildId(),
      currencies: state.currencies,
      totalRaw: raw,
      changed
    })}`
  )
}

/** Test seam: the emit rule is stateful across calls by design. */
function reset() {
  lastRaw = null
  lastEmittedAt = 0
}

module.exports = { name, handle, read, reset, UNCHANGED_REPEAT_MS }
