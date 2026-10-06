const ParserError = require('./parser-error')

/**
 * Local patch (Guild Butler, 2026-10-05) — reading the player-trade packets, shared by their
 * handlers (event-data/ev-*-player-trade*.js, response-data/op-invite-to-player-trade.js,
 * request-data/op-player-trade-accept-trade.js). The layouts are in src/trades/player-trades.js.
 *
 * Strict on purpose: every handler here runs through data-handler.js `run()`, so a throw is counted
 * in the [health] line. A field the next game patch moves must make these handlers FAIL — a decoder
 * that quietly wrote empty trades would be the attach bug of 2026-09-23 over again.
 */

/** Silver on the wire is fixed-point: ×10,000 (confirmed to the unit by UpdateMoney, event 81). */
const SILVER_SCALE = 10000
const SILVER_SCALE_N = 10000n

const has = (parameters, key) => Object.prototype.hasOwnProperty.call(parameters, key) && parameters[key] != null

/** A whole number as the decoder hands it: a number, or a BigInt for a 64-bit field. */
const integer = (value) => {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value
  }

  if (typeof value === 'bigint') {
    return Number(value)
  }

  return NaN
}

const tradeIdAt = (parameters, key, what) => {
  const tradeId = integer(parameters[key])

  if (!Number.isInteger(tradeId) || tradeId < 0) {
    throw new ParserError(`${what} has no trade id at parameter ${key}`)
  }

  return tradeId
}

/**
 * Raw fixed-point silver → whole silver, floored. Absent means 0 (the game omits a zero).
 *
 * Every shape a 64-bit value can take on the way here: a number (protocol18's compressed long, what
 * both recordings hold), a BigInt (a 64-bit read elsewhere in the decoder), and a Long-style
 * `{ low, high }` pair, which no decoder path produces today but a replacement decoder may. A BigInt
 * or a pair is divided before it becomes a number, so no digit is lost on the way. Anything else, or
 * a negative amount, is not silver — a ParserError, never a 0.
 */
const wholeSilver = (value, what = 'silver') => {
  if (value == null) {
    return 0
  }

  let raw = null

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) {
      throw new ParserError(`${what} is not an amount: ${value}`)
    }

    return Number.isInteger(value) ? (value - (value % SILVER_SCALE)) / SILVER_SCALE : Math.floor(value / SILVER_SCALE)
  }

  if (typeof value === 'bigint') {
    raw = value
  } else if (typeof value === 'object' && Number.isInteger(value.low) && Number.isInteger(value.high)) {
    raw = (BigInt(value.high) << 32n) + BigInt(value.low >>> 0)
  } else {
    throw new ParserError(`${what} is not an amount: ${typeof value}`)
  }

  if (raw < 0n) {
    throw new ParserError(`${what} is not an amount: ${raw}`)
  }

  return Number(raw / SILVER_SCALE_N)
}

/** A parallel array of whole numbers (a byte array may arrive as a typed array). */
const numbers = (parameters, key, what) => {
  const value = parameters[key]
  const list = Array.isArray(value) ? value : ArrayBuffer.isView(value) ? Array.from(value) : null

  if (list == null) {
    throw new ParserError(`${what}: parameter ${key} is not an array`)
  }

  return list.map((entry) => {
    const n = integer(entry)

    if (!Number.isInteger(n)) {
      throw new ParserError(`${what}: parameter ${key} holds a non-number`)
    }

    return n
  })
}

/**
 * One side of the trade window: item index, quantity and quality, parallel arrays of one length.
 * The reference tool's rule for odd entries: an index of 0 or less is no item and is skipped, a
 * quantity of 0 or less is one (StatisticsAnalysis `PlayerTradeUpdateEvent.cs`). Nothing else on the
 * side is read — crafter names, object ids, durability, spells and passives stay on the wire.
 */
const side = (parameters, { index, qty, quality }, what) => {
  const indexes = numbers(parameters, index, what)
  const quantities = numbers(parameters, qty, what)
  const qualities = numbers(parameters, quality, what)

  if (quantities.length !== indexes.length || qualities.length !== indexes.length) {
    throw new ParserError(`${what}: item, quantity and quality arrays differ in length (${indexes.length}/${quantities.length}/${qualities.length})`)
  }

  const out = []

  indexes.forEach((itemIndex, i) => {
    if (itemIndex <= 0) {
      return
    }

    out.push({ index: itemIndex, qty: quantities[i] > 0 ? quantities[i] : 1, quality: qualities[i] })
  })

  return out
}

/** Our side of the window (6–16) and the partner's (17–26); only these three columns are read. */
const OURS = { index: 8, qty: 15, quality: 10 }
const THEIRS = { index: 18, qty: 25, quality: 20 }

/** Event 179: `{ tradeId, revision, gave, got, silverGave, silverGot }`. */
const parseUpdate = (parameters) => {
  const what = 'PlayerTradeUpdate'
  const tradeId = tradeIdAt(parameters, 0, what)
  const revision = integer(parameters[1])

  if (!Number.isInteger(revision)) {
    throw new ParserError(`${what} has no revision at parameter 1`)
  }

  return {
    tradeId,
    revision,
    gave: side(parameters, OURS, `${what} (ours)`),
    got: side(parameters, THEIRS, `${what} (theirs)`),
    // Parameters 3 and 5 are never read: unknown, and gold has not been tradable since 2017.
    silverGave: wholeSilver(parameters[2], `${what} silver (ours)`),
    silverGot: wholeSilver(parameters[4], `${what} silver (theirs)`)
  }
}

/**
 * Response 161 or event 176 — the same layout: 0 the partner's object id, 1 their name, 2 their
 * guild (absent or empty for a guildless partner — not yet recorded, so both are read as none),
 * 6 the trade id. 3 and 4 (stable per player, meaning unknown) and 5 (new on 2026-10-04) are not read.
 */
const parseInvite = (parameters, what) => {
  const tradeId = tradeIdAt(parameters, 6, what)
  const name = parameters[1]
  const guild = parameters[2]

  if (typeof name !== 'string' || name.trim() === '') {
    throw new ParserError(`${what} has no partner name at parameter 1`)
  }

  if (guild != null && typeof guild !== 'string') {
    throw new ParserError(`${what} has a non-text guild at parameter 2`)
  }

  const objId = integer(parameters[0])

  return { tradeId, partner: { objId: Number.isInteger(objId) ? objId : null, name, guild: guild != null && guild !== '' ? guild : null } }
}

/**
 * Events 178 and 180 carry the trade id alone. One carrying a revision or any array is an update
 * arriving under the wrong code (a renumbering) — refused, so it shows as broken instead of
 * finishing a trade that is still open.
 */
const parseBareTradeId = (parameters, what) => {
  const tradeId = tradeIdAt(parameters, 0, what)

  if (has(parameters, 1) || Object.values(parameters).some((value) => Array.isArray(value))) {
    throw new ParserError(`${what} carries an update's fields`)
  }

  return tradeId
}

/** Request 166: 0 the trade id, 1 the revision we accept. */
const parseAccept = (parameters) => {
  const what = 'PlayerTradeAcceptTrade'
  const tradeId = tradeIdAt(parameters, 0, what)
  const revision = integer(parameters[1])

  if (!Number.isInteger(revision)) {
    throw new ParserError(`${what} has no revision at parameter 1`)
  }

  return { tradeId, revision }
}

module.exports = { parseUpdate, parseInvite, parseBareTradeId, parseAccept, wholeSilver, SILVER_SCALE }
