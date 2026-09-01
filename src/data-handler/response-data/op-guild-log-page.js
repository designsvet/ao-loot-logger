const ServerRegion = require('../../network/server-region')
const GuildIdentity = require('../../storage/guild-identity')

const name = 'OpGuildLogPage'

/**
 * Local patch: one page of the guild's siphoned-energy log.
 *
 * This is the log a human copies out of the game and pastes into a Discord thread. The
 * client fetches it a page at a time as you scroll, and the response is five parallel
 * arrays, one entry per row:
 *
 *   0  playerName   string[]
 *   1  types        int[]     FOUR per row; only the first is used, the rest were 0 on
 *                             every row of 375 recorded. 2 = deposit, 3 = withdrawal.
 *   2  notes        string[]  empty on every row recorded
 *   3  amounts      int[]     signed, scaled x10000
 *   4  timeTicks    long[]    .NET ticks, UTC
 *
 * The request carries the page OFFSET (param 2) and the guild id (param 0) — the response
 * carries neither, which is why the guild id is remembered from the request.
 *
 * Emitted, not interpreted: amounts keep their x10000 and ticks stay ticks, the same rule
 * the festivities handler follows. The reader owns the conversion, and it owns one more
 * thing here — the game's own copyable log is written to the SECOND, so a reader mirroring
 * both must floor these before comparing, or the same row arrives twice under two keys.
 *
 * Unknown TYPES are passed through rather than dropped. The paste path already reports an
 * unrecognised reason instead of importing it, and a page silently missing rows would be
 * indistinguishable from a quiet week.
 */

const MAX_ROWS = 5000
const MIN_TICKS = 630822816000000000 // 2000-01-01
const MAX_TICKS = 662376960000000000 // 2100-01-01
const AMOUNT_SCALE = 10000

const isStringArray = (value) => Array.isArray(value) && value.every((entry) => typeof entry === 'string')
const isNumberArray = (value) =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))

/**
 * Read the five arrays, or null if this payload is not a log page.
 *
 * The code is an ordinal that game patches renumber, so this has to be able to say "not this
 * message" and stay silent rather than emit rows built out of something else's parameters.
 * The 4-per-row type array and the x10000 amounts are what make the shape specific.
 */
function read(params) {
  const names = params[0]
  const types = params[1]
  const notes = params[2]
  const amounts = params[3]
  const ticks = params[4]

  if (!isStringArray(names) || !isNumberArray(types) || !isStringArray(notes)) {
    return null
  }

  if (!isNumberArray(amounts) || !isNumberArray(ticks)) {
    return null
  }

  const length = names.length

  if (length === 0 || length > MAX_ROWS) {
    return null
  }

  if (notes.length !== length || amounts.length !== length || ticks.length !== length) {
    return null
  }

  if (types.length !== length * 4) {
    return null
  }

  const rows = []

  for (let i = 0; i < length; i++) {
    if (amounts[i] % AMOUNT_SCALE !== 0) {
      return null
    }

    if (ticks[i] < MIN_TICKS || ticks[i] > MAX_TICKS) {
      return null
    }

    rows.push({
      playerName: names[i],
      type: types[i * 4],
      note: notes[i],
      amountRaw: amounts[i],
      ticks: ticks[i]
    })
  }

  return rows
}

function serverToken() {
  const server = ServerRegion.getCurrentServer()

  return server && typeof server.region === 'string' ? server.region.toLowerCase() : null
}

function handle(event) {
  const rows = read(event.parameters)

  if (rows === null) {
    return
  }

  console.info(
    `[energy-log] ${JSON.stringify({
      server: serverToken(),
      code: event.parameters[253],
      // Absent only if a page somehow arrives before its own request was seen. The reader
      // must refuse an unattributed page rather than guess whose log it is.
      albionGuildId: GuildIdentity.getGuildId(),
      // From the REQUEST: operation 159 serves several guild logs in one shape, and the
      // response says nothing about which. The reader decides what it will accept.
      logType: GuildIdentity.getLogType(),
      rows
    })}`
  )
}

module.exports = { name, handle, read }
