const Logger = require('../../utils/logger')
const ServerRegion = require('../../network/server-region')
const FESTIVITY_NAMES = require('../festivity-names')

const name = 'EvFestivitiesUpdate'

/**
 * Local patch: the daily bonus rotation.
 *
 * FestivitiesUpdate is the server telling the client which production bonuses,
 * activity events and gathering bonus are running, and when each one ends. It is
 * five parallel arrays:
 *
 *   0  kinds          byte[]    which family the entry belongs to
 *   1  categories     string[]  the game data's category token ("dagger", "ore")
 *   2  uniqueNames    string[]  the game data's @uniquename ("COMMON_DAGGER")
 *   3  startTimeTicks long[]    .NET ticks, UTC
 *   4  endTimeTicks   long[]    .NET ticks, UTC
 *
 * This handler only PRINTS. It writes no loot, touches no storage and decides
 * nothing: one line on stdout, and whatever reads this process decides what the
 * line is worth. Ticks are passed through unconverted for the same reason — the
 * reader owns the interpretation.
 *
 * Note the shape check. The event's numeric code is an ORDINAL that game patches
 * renumber, and this handler is deliberately wired to more than one candidate
 * code, so it must be able to say "that was not this event" and stay silent.
 */

const UNIQUE_NAME = /^[A-Z0-9_]{1,64}$/
// .NET ticks for 2000-01-01 and 2100-01-01 — a wide sanity window, not a schedule.
const MIN_TICKS = 630822816000000000
const MAX_TICKS = 662376960000000000

function isStringArray(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function isNumberArray(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
}

/** Region → the token the bot stores. Null when the region has not been detected yet. */
function serverToken() {
  const server = ServerRegion.getCurrentServer()

  return server && typeof server.region === 'string' ? server.region.toLowerCase() : null
}

/**
 * Read the five parallel arrays, or null if this payload is not FestivitiesUpdate.
 *
 * Split out from handle() so the SHAPE is defined once and can also be used to HUNT for the
 * event: the code is an ordinal that game patches renumber, and if neither wired candidate is
 * right, the alternative to this is a human re-deriving the number from a decompiled enum.
 */
function readEntries(params) {
  const kinds = params[0]
  const categories = params[1]
  const uniqueNames = params[2]
  const startTicks = params[3]
  const endTicks = params[4]

  if (!isNumberArray(kinds) || !isStringArray(categories) || !isStringArray(uniqueNames)) {
    return null
  }

  if (!isNumberArray(startTicks) || !isNumberArray(endTicks)) {
    return null
  }

  const length = kinds.length

  if (length === 0 || [categories, uniqueNames, startTicks, endTicks].some((arr) => arr.length !== length)) {
    return null
  }

  const entries = []

  for (let i = 0; i < length; i++) {
    if (!UNIQUE_NAME.test(uniqueNames[i])) {
      return null
    }

    if (startTicks[i] < MIN_TICKS || endTicks[i] > MAX_TICKS || endTicks[i] <= startTicks[i]) {
      return null
    }

    entries.push({
      kind: kinds[i],
      category: categories[i],
      uniqueName: uniqueNames[i],
      startTicks: startTicks[i],
      endTicks: endTicks[i]
    })
  }

  return entries
}

function handle(event) {
  const entries = readEntries(event.parameters)

  // Not this event after all — the wired code belongs to something else on this game patch.
  // Silence is the correct outcome: two candidate codes are dispatched here.
  if (entries === null) {
    return
  }

  console.info(
    `[festivities] ${JSON.stringify({
      server: serverToken(),
      code: event.parameters[252],
      entries
    })}`
  )
}

const scanned = new Set()

/**
 * Local patch: the ordinal hunt, by CONTENT rather than by shape.
 *
 * The first version of this scanner matched the five-array shape, and one real login proved
 * that is not enough: nothing printed, which leaves two indistinguishable explanations — the
 * event never arrived, or it arrived in a shape the matcher did not recognise. Names remove
 * that ambiguity. `COMMON_DAGGER` and `FIBER` appear in no other payload in the game, so ANY
 * message carrying one is the rotation, whatever number it came under and however its
 * parameters are laid out.
 *
 * Prints the whole payload once per code, because if the layout HAS moved, the payload is
 * exactly what is needed to re-derive it.
 */
function scan(event, source = 'event') {
  const params = event?.parameters

  if (params == null) {
    return
  }

  const code = params[252] ?? params[253]
  const key = `${source}:${code}`

  if (code == null || scanned.has(key)) {
    return
  }

  let hit = null

  for (const value of Object.values(params)) {
    if (typeof value === 'string' && FESTIVITY_NAMES.has(value)) {
      hit = value
      break
    }

    if (Array.isArray(value)) {
      const found = value.find((entry) => typeof entry === 'string' && FESTIVITY_NAMES.has(entry))

      if (found != null) {
        hit = found
        break
      }
    }
  }

  if (hit === null) {
    return
  }

  scanned.add(key)

  console.info(
    `[festivity-scan] ${source} code=${code} carries the festivity name "${hit}" — payload: ` +
      JSON.stringify(
        Object.fromEntries(
          Object.entries(params).map(([k, v]) => [
            k,
            Array.isArray(v) ? `array(${v.length}): ${v.slice(0, 12).join(',')}` : v
          ])
        )
      )
  )
}

module.exports = { name, handle, scan }
