#!/usr/bin/env node
/**
 * Read a session recording (`guild-dump-*.jsonl`, written by `DUMP_PACKETS=session`
 * or the 120-second `g` window) and answer the questions the activity-stats plan
 * asks of a recording, without anyone grepping a file of forty thousand lines:
 *
 *   node tools/analyze-recording.js guild-dump-2026-09-10T19-02-44.jsonl --r1
 *   node tools/analyze-recording.js a.jsonl b.jsonl --r2 --code 176 --samples 3
 *   node tools/analyze-recording.js guild-dump-2026-10-06T18-00-00.jsonl --r3
 *   node tools/analyze-recording.js mine.jsonl --compare theirs.jsonl   # R3, both ends of each trade
 *
 * It prints: what the file holds (records, span, a code census with the reference
 * tool's names), the stat packets it looked for and the parameter shapes they came
 * in, the "whose object id is me" evidence, the market-mail timing, and a
 * pass/missing line per item of the R1 (open world), R2 (city) and R3 (player trades)
 * checklists.
 *
 * It DECIDES nothing about the game: a name beside a code is the reference tool's
 * name for that ordinal on the current patch, and the checklists are the plan's own
 * words. `--json` prints the same findings as one object for a script to read.
 */

'use strict'

const fs = require('fs')
const path = require('path')

const CODES = require('./photon-codes.json')

// ── the packets the plan is about ────────────────────────────────────────────
//
// kind: event | request | response — a code means different things on each side.
// qualify: an optional narrower test on the payload (a killing blow, an opened
// chest, a crafter-named reveal, a failed cast), reported beside the plain count.

const TARGETS = [
  { key: 'fame', label: 'Fame gained', kind: 'event', id: 82 },
  { key: 'silver', label: 'Silver picked up (own)', kind: 'event', id: 62 },
  { key: 'respec', label: 'ReSpec points', kind: 'event', id: 84 },
  { key: 'mightFavour', label: 'Might and favour', kind: 'event', id: 497 },
  { key: 'faction', label: 'Faction points', kind: 'event', id: 85 },
  { key: 'health', label: 'Health update', kind: 'event', id: 6, qualify: { label: 'killing blow (no param 3)', test: (p) => !has(p, 3) } },
  { key: 'healths', label: 'Health updates (batched)', kind: 'event', id: 7 },
  { key: 'combat', label: 'In-combat state', kind: 'event', id: 278 },
  { key: 'mob', label: 'New mob', kind: 'event', id: 123 },
  { key: 'harvestStart', label: 'Harvest start', kind: 'event', id: 59 },
  { key: 'harvest', label: 'Harvest finished', kind: 'event', id: 61 },
  { key: 'fishStart', label: 'Fishing start (request)', kind: 'request', id: 316 },
  { key: 'fishCatch', label: 'Fishing catch (request)', kind: 'request', id: 319 },
  // A failed catch OMITS param 1 rather than sending false (recorded 2026-09-18) — the same
  // "absent, never zero" rule the item values follow. Testing for `=== false` never matches.
  { key: 'fishFinish', label: 'Fishing finish (request)', kind: 'request', id: 322, qualify: { label: 'failed (param 1 absent)', test: (p) => p['1'] !== true } },
  // The server's own state machine for a bout: 3 line out · 4 cast · 5 bite · 7/8 a tug
  // · 9 landed · 10 escaped · 15 aborted. Recorded 2026-09-16/18; the reference tool
  // leaves this event unhandled.
  { key: 'fishLanded', label: 'Fishing state (event)', kind: 'event', id: 355, qualify: { label: 'landed (state 9)', test: (p) => num(p['3']) === 9 } },
  { key: 'fishEscaped', label: 'Fishing state (event)', kind: 'event', id: 355, qualify: { label: 'escaped (state 10)', test: (p) => num(p['3']) === 10 } },
  { key: 'fishCancel', label: 'Fishing cancel (request)', kind: 'request', id: 323 },
  { key: 'reward', label: 'Reward granted', kind: 'event', id: 267 },
  { key: 'chest', label: 'New loot chest', kind: 'event', id: 393 },
  { key: 'chestUpdate', label: 'Loot chest update', kind: 'event', id: 394, qualify: { label: 'opened (state 7 or opener list)', test: (p) => num(p['1']) === 7 || Array.isArray(p['3']) } },
  { key: 'cluster', label: 'Change cluster (response)', kind: 'response', id: 41 },
  { key: 'join', label: 'Join (response)', kind: 'response', id: 2 },
  { key: 'shrine', label: 'New shrine', kind: 'event', id: 397 },
  { key: 'dungeonExit', label: 'Random dungeon exit', kind: 'event', id: 325 },
  { key: 'stationStart', label: 'Station action start (request)', kind: 'request', id: 55, qualify: { label: 'repair (type 2)', test: (p) => num(p['2']) === 2 } },
  { key: 'craftStart', label: 'Station action start (request)', kind: 'request', id: 55, qualify: { label: 'craft (type 1)', test: (p) => num(p['2']) === 1 } },
  { key: 'journalFull', label: 'Journal got full', kind: 'event', id: 292 },
  { key: 'stationInfo', label: 'Craft building info', kind: 'event', id: 49 },
  { key: 'stationDone', label: 'Station action finished', kind: 'event', id: 66 },
  { key: 'craftDone', label: 'Craft item finished', kind: 'event', id: 71 },
  { key: 'focus', label: 'Crafting focus update', kind: 'event', id: 10 },
  { key: 'equip', label: 'Equipment reveal', kind: 'event', id: 30, qualify: { label: 'names a crafter (string at 6)', test: (p) => typeof p['6'] === 'string' } },
  { key: 'buyOffer', label: 'Instant buy (request)', kind: 'request', id: 83 },
  { key: 'buyOfferResp', label: 'Instant buy (response)', kind: 'response', id: 83 },
  { key: 'sellSpecific', label: 'Instant sell (request)', kind: 'request', id: 315 },
  { key: 'sellSpecificResp', label: 'Instant sell (response)', kind: 'response', id: 315 },
  { key: 'offers', label: 'Sell-order listing (response)', kind: 'response', id: 81 },
  { key: 'requests', label: 'Buy-order listing (response)', kind: 'response', id: 82 },
  { key: 'createOffer', label: 'Place sell order (request)', kind: 'request', id: 79 },
  { key: 'createRequest', label: 'Place buy order (request)', kind: 'request', id: 80 },
  { key: 'mailList', label: 'Mail list (response)', kind: 'response', id: 174 },
  { key: 'mailBody', label: 'Mail body (response)', kind: 'response', id: 176 },
  { key: 'unreadMails', label: 'New unread mails', kind: 'event', id: 202 },
  { key: 'goldBuy', label: 'Gold market buy (response)', kind: 'response', id: 244 },
  { key: 'goldSell', label: 'Gold market sell (response)', kind: 'response', id: 245 },
  // `redact`: the partner's name and guild are shown as their lengths only — "PA" (2) is the Ancient
  // Lands mask, anything longer is a person, and a sample line is no place to spread one the game
  // might hide (a `""` guild still reads as «0 chars»: the shape survives).
  { key: 'tradeInvite', label: 'Player trade invitation', kind: 'event', id: 176, redact: ['1', '2'] },
  { key: 'tradeUpdate', label: 'Player trade update', kind: 'event', id: 179 },
  { key: 'tradeDone', label: 'Player trade finished', kind: 'event', id: 180 },
  { key: 'tradeInviteResp', label: 'Player trade invite (response)', kind: 'response', id: 161, redact: ['1', '2'] },
  { key: 'tradeCancel', label: 'Player trade cancelled', kind: 'event', id: 178 },
  { key: 'tradeAcceptChange', label: 'Player trade accept change', kind: 'event', id: 181 },
  { key: 'tradeAccept', label: 'Player trade accept (request)', kind: 'request', id: 166 },
  { key: 'character', label: 'New character', kind: 'event', id: 29 },
  { key: 'silverOthers', label: 'Other grabbed loot', kind: 'event', id: 279, qualify: { label: 'silver (param 3 true)', test: (p) => p['3'] === true } }
]

// ── the two checklists, in the plan's words ──────────────────────────────────

const R1 = [
  { label: 'fame events', test: (c) => c.fame >= 1, why: 'kill a mob or gather once' },
  { label: 'silver picked up (own)', test: (c) => c.silver >= 1, why: 'take silver off the floor' },
  { label: 'a killing blow in the health updates', test: (c) => c.health_q >= 1, why: 'kill a mob' },
  { label: 'mobs announced', test: (c) => c.mob >= 3, why: 'three or more kinds nearby' },
  { label: 'harvests finished, three or more', test: (c) => c.harvest >= 3, why: 'three resource types with a tool' },
  { label: 'fishing casts, five or more', test: (c) => c.fishStart >= 5, why: 'five casts' },
  { label: 'a failed cast', test: (c) => c.fishEscaped_q >= 1 || c.fishFinish_q >= 1, why: 'let one fish escape' },
  { label: 'a fishing reward', test: (c) => c.reward >= 1, why: 'land one' },
  { label: 'chests seen, two or more', test: (c) => c.chest >= 2, why: 'open two chests' },
  { label: 'a chest opened', test: (c) => c.chestUpdate_q >= 1, why: 'open one yourself' },
  { label: 'two or more zone joins', test: (c) => c.join >= 2, why: 'enter and leave a dungeon' },
  { label: 'a dungeon cluster in the joins', test: (c, s) => s.joins.some((j) => /RANDOMDUNGEON|@/.test(String(j.cluster))), why: 'the dungeon shows in Join param 8' },
  { label: 'own object id settled (a Join param 0 acts in fame, silver or harvest)', test: (c, s) => s.ownId.settled, why: 'earn fame, pick up silver or gather once in the same zone' }
]

const R2 = [
  { label: 'instant buy request + response', test: (c) => c.buyOffer >= 1 && c.buyOfferResp >= 1, why: 'buy from a sell order' },
  { label: 'instant sell request + response', test: (c) => c.sellSpecific >= 1 && c.sellSpecificResp >= 1, why: 'sell into a buy order' },
  { label: 'a listing (the price source for instant deals)', test: (c) => c.offers >= 1 || c.requests >= 1, why: 'open the market' },
  { label: 'a sell order placed', test: (c) => c.createOffer >= 1, why: 'place one (op 79 — layout unread until now)' },
  { label: 'a buy order placed', test: (c) => c.createRequest >= 1, why: 'place one (op 80)' },
  { label: 'mail list', test: (c) => c.mailList >= 1, why: 'open the mailbox' },
  { label: 'mail body', test: (c) => c.mailBody >= 1, why: 'open one sold mail' },
  // One craft action can make many items (8 scythes in one, 2026-09-16), so the test is
  // an action, not a count of two.
  { label: 'a craft action', test: (c) => c.craftStart_q >= 1, why: 'craft anything' },
  { label: 'a crafting journal filled', test: (c) => c.journalFull >= 1, why: 'craft with an empty journal in your bag' },
  { label: 'a repair', test: (c) => c.stationStart_q >= 1, why: 'repair something' },
  { label: 'the station named itself', test: (c) => c.stationInfo >= 1, why: 'event 49 on entering the station' },
  { label: 'craft finished events', test: (c) => c.craftDone >= 2, why: 'wait for both crafts' },
  { label: 'a focus update', test: (c) => c.focus >= 1, why: 'craft one with focus' },
  { label: 'an equipment reveal naming its crafter', test: (c) => c.equip_q >= 1, why: 'craft a piece of gear' },
  { label: 'a player trade, updated and finished', test: (c) => c.tradeUpdate >= 1 && c.tradeDone >= 1, why: 'trade with someone' }
]

// ── R3: the player-trade verification session (raid-bot ruling of 2026-10-05, option B) ──
//
// What the engine's trade records (src/trades/player-trades.js) were built on, and what the
// recordings of 2026-09-16/21 could NOT show: every finished trade there was the member GIVING,
// every partner was a guildmate, none was in the Ancient Lands, and none came after the ~09-28 patch.
// `detail` prints what the grade rests on, because for two of these the answer is the point.

const finishedTrades = (s) => s.trades.trades.filter((t) => t.outcome === 'finished' && t.last != null)
const inMaskedZone = (s) => s.trades.trades.filter((t) => t.invite != null && t.zone.masked)

const R3 = [
  {
    label: 'an invitation you sent (response 161)',
    test: (c, s) => s.trades.trades.some((t) => t.invite?.direction === 'sent'),
    why: 'invite someone to trade'
  },
  {
    label: 'an invitation you received (event 176)',
    test: (c, s) => s.trades.trades.some((t) => t.invite?.direction === 'received'),
    why: 'have someone invite you'
  },
  {
    label: 'a finished trade where you RECEIVED items',
    test: (c, s) => finishedTrades(s).some((t) => t.last.got > 0),
    why: 'have the partner put an item in, both accept'
  },
  {
    label: 'a finished trade where you GAVE items',
    test: (c, s) => finishedTrades(s).some((t) => t.last.gave > 0),
    why: 'put an item in yourself, both accept'
  },
  {
    label: 'a partner with no guild',
    test: (c, s) => s.trades.trades.some((t) => t.invite != null && t.invite.guildShape !== 'named'),
    why: 'trade with a character in no guild (an alt works)',
    detail: (c, s) => `guild at parameter 2: ${Object.entries(s.trades.guildShapes).map(([shape, n]) => `${shape} ×${n}`).join(', ') || 'no invitation'}`
  },
  {
    label: 'a trade in the Ancient Lands',
    test: (c, s) => inMaskedZone(s).length > 0,
    why: 'trade with a party member inside the Ancient Lands',
    detail: (c, s) =>
      inMaskedZone(s)
        .map((t) => `#${t.tradeId} in zone ${t.zone.cluster ?? '?'}: the invite ${t.invite.masked ? 'named the partner PA (masked)' : 'carried a REAL name (not masked)'}`)
        .join('; ') || 'no trade in a zone that showed a PA character'
  },
  {
    label: 'updates and a finish after the 2026-09-28 patch',
    test: (c, s) => s.trades.postPatch.updates >= 1 && s.trades.postPatch.finishes >= 1,
    why: 'finish any trade',
    detail: (c, s) => `179 ×${s.trades.postPatch.updates}, 180 ×${s.trades.postPatch.finishes}, 161 response ×${s.trades.postPatch.invites} since 2026-09-28`
  },
  {
    label: 'our accept = the last update, every finished trade',
    test: (c, s) => {
      const accepted = finishedTrades(s).filter((t) => t.accepted != null)

      return accepted.length > 0 && accepted.every((t) => t.accepted === t.last.revision)
    },
    why: 'accept a trade yourself',
    detail: (c, s) =>
      finishedTrades(s)
        .map((t) => `#${t.tradeId} ${t.accepted ?? '–'}/${t.last.revision}`)
        .join(' ') || 'no finished trade'
  },
  {
    // Graded on the events themselves, not on the received trade (item 3 already counts that): a
    // received trade with nothing around its finish gives the phantom-pickup check nothing to read.
    label: 'item events around a received trade',
    test: (c, s) => finishedTrades(s).some((t) => t.around != null && t.around.put + t.around.simple + t.around.equipment > 0),
    why: 'a received trade whose items arrive by its finish (none within 2 s: read --code 26 around it)',
    detail: (c, s) =>
      finishedTrades(s)
        .filter((t) => t.around != null)
        .map((t) => `#${t.tradeId}: InventoryPutItem ×${t.around.put}, NewSimpleItem ×${t.around.simple}, NewEquipmentItem ×${t.around.equipment} within ${AROUND_MS / 1000}s of the finish`)
        .join('; ') || 'no received trade'
  },
  {
    // Graded only with --compare (`only`): one recording cannot say what the other end saw. The trade
    // id is reported, not graded — it is what the bot's dedup must NOT key on unless it always holds.
    label: 'two machines agree on a trade',
    only: (s) => s.compare != null,
    test: (c, s) => s.compare.pairs.length > 0 && s.compare.pairs.every((p) => p.agrees),
    why: 'both players record the session and finish a trade with each other',
    detail: (c, s) => {
      const { pairs, unpaired } = s.compare
      const verdicts = pairs.map((p) => `A#${p.a.tradeId}↔B#${p.b.tradeId} ${p.agrees ? 'agree' : `disagree (${disagreements(p).join(', ')})`}`)

      return `${verdicts.join('; ') || 'no pair'} · trade id equal in ${pairs.filter((p) => p.tradeIdEqual).length}/${pairs.length} (reported, not graded) · unpaired A ${unpaired.a.length}, B ${unpaired.b.length}`
    }
  }
]

// ── reading the file ─────────────────────────────────────────────────────────

const readRecords = (file) => {
  const records = []
  let bad = 0

  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') {
      continue
    }

    try {
      records.push(JSON.parse(line))
    } catch {
      bad += 1
    }
  }

  return { records, bad }
}

/** Numbers arrive as numbers or as the dump's `bigint:123` strings. */
const num = (value) => {
  if (typeof value === 'number') {
    return value
  }

  if (typeof value === 'string' && value.startsWith('bigint:')) {
    return Number(value.slice(7))
  }

  return NaN
}

const has = (payload, key) => payload != null && Object.prototype.hasOwnProperty.call(payload, String(key))

const nameOf = (kind, id) => {
  const table = kind === 'event' ? CODES.events : CODES.operations

  return table[String(id)] ?? '?'
}

/** A payload, compact enough for one line. */
const compact = (payload, maxKeys = 14) => {
  const parts = []

  for (const [key, value] of Object.entries(payload ?? {})) {
    if (key === '252' || key === '253') {
      continue
    }

    if (parts.length >= maxKeys) {
      parts.push('…')
      break
    }

    if (Array.isArray(value)) {
      parts.push(`${key}=[${value.slice(0, 4).map((v) => (typeof v === 'string' ? JSON.stringify(v.slice(0, 16)) : String(v))).join(',')}${value.length > 4 ? `,…×${value.length}` : ''}]`)
    } else if (value != null && typeof value === 'object') {
      parts.push(`${key}=${value._array != null ? `array(${value._array})` : value._buffer != null ? `bytes(${value._buffer})` : 'obj'}`)
    } else if (typeof value === 'string') {
      parts.push(`${key}=${JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value)}`)
    } else {
      parts.push(`${key}=${String(value)}`)
    }
  }

  return parts.join(' ')
}

/** A payload with these keys' text replaced by its length (`PA` stays: it is the mask, not a name). */
const redact = (payload, keys) => {
  const out = { ...(payload ?? {}) }

  for (const key of keys) {
    if (typeof out[key] === 'string' && out[key] !== 'PA') {
      out[key] = `«${out[key].length} chars»`
    }
  }

  return out
}

const keyProfile = (payload) =>
  Object.keys(payload ?? {})
    .filter((k) => k !== '252' && k !== '253')
    .map(Number)
    .sort((a, b) => a - b)
    .join(',')

// ── player trades, reconstructed (R3) ────────────────────────────────────────

/** The ~09-28 game patch that moved EvAttachItemContainer: trade codes are unconfirmed after it. */
const PATCH_2026_09_28 = '2026-09-28T00:00:00.000Z'
const AROUND_MS = 2000
const ITEM_EVENTS = { 26: 'put', 30: 'equipment', 32: 'simple' }

/** How an invitation carried the partner's guild: the open question for a guildless partner. */
const guildShape = (payload) => {
  if (!has(payload, 2)) {
    return 'absent'
  }

  if (payload['2'] === null) {
    return 'null'
  }

  if (payload['2'] === '') {
    return 'empty ""'
  }

  return typeof payload['2'] === 'string' ? 'named' : `other (${typeof payload['2']})`
}

/** The engine's test (src/trades `isHiddenName`): the whole value, any case — a `PAladin` is a person. */
const isPA = (value) => typeof value === 'string' && value.trim().toUpperCase() === 'PA'

const listLength = (value) => (Array.isArray(value) ? value.length : value != null && value._array != null ? value._array : 0)

/** Event 179's item columns, ours (6–16) and the partner's (17–26): src/data-handler/player-trade-wire.js. */
const OURS = { index: '8', qty: '15', quality: '10' }
const THEIRS = { index: '18', qty: '25', quality: '20' }

/**
 * One side of the trade window as `{ index, qty, quality }` stacks, by the wire's rule: an index of 0
 * or less is no item, a quantity of 0 or less is one. `null` when a column is not a list (the dump's
 * `_array` stub for one it cut short): a partial list proves nothing in a comparison.
 */
const sideItems = (payload, columns) => {
  const column = (key) => (Array.isArray(payload[key]) ? payload[key] : payload[key] == null ? [] : null)
  const indexes = column(columns.index)
  const quantities = column(columns.qty)
  const qualities = column(columns.quality)

  if (indexes == null || quantities == null || qualities == null) {
    return null
  }

  const out = []

  indexes.forEach((value, i) => {
    const index = num(value)
    const qty = num(quantities[i])
    const quality = num(qualities[i])

    if (index > 0) {
      out.push({ index, qty: qty > 0 ? qty : 1, quality: Number.isFinite(quality) ? quality : null })
    }
  })

  return out
}

/** Not enumerable: `--json` (JSON.stringify) skips it. For the names R3 may compare but never print. */
const unprinted = (object, key, value) => Object.defineProperty(object, key, { value })

/**
 * Every trade in the recording, as the engine's state machine would see it: the invitation (and
 * which way), the zone (and whether it showed a `PA` player — the Ancient Lands' mask — as a
 * character or a looter, the engine's two signals), the last update's contents, our accepted
 * revision, and how it ended. Trade ids repeat, so a finished or cancelled id, or a second
 * invitation under one, starts a new trade.
 *
 * A REAL name in a zone that masks players is the one thing R3 must not spread while it finds out
 * whether it exists, so it is blanked HERE (`name: null`, its `nameLength` kept, the guild too) and
 * every output inherits that: the trade list, `--json`, and `--code` through `hiddenRecords`.
 *
 * For `--compare`, two names travel unprinted (not enumerable): `trade.self`, the capturer's own
 * name from the last Join's parameter 2, and `invite.rawName`, the partner's name as it came, blanked
 * or not. `hiddenNames` holds every name blanked here, so a comparison can match on a name and still
 * print it nowhere.
 */
const tradeEvidence = (records) => {
  const open = new Map()
  const trades = []
  const guildShapes = {}
  const postPatch = { updates: 0, finishes: 0, invites: 0 }
  const invites = []
  const hiddenNames = new Set()
  let zone = { cluster: null, masked: false }
  let lastMaskAt = null
  let refused = 0
  let self = null

  const tradeFor = (tradeId) => {
    let trade = open.get(tradeId)

    if (trade == null) {
      trade = unprinted({ tradeId, invite: null, zone, updates: 0, last: null, accepted: null, outcome: null, at: null }, 'self', self)
      open.set(tradeId, trade)
      trades.push(trade)
    }

    return trade
  }

  // A trade ends with the zone as it stood THEN (the engine decides "hidden" at the finish): the zone
  // object is shared and can still turn masked later — a PA arriving just before the next join.
  const settle = (trade) => {
    trade.zone = { ...trade.zone }
  }

  const close = (tradeId, outcome, at) => {
    const trade = open.get(tradeId)

    if (trade != null) {
      trade.outcome = outcome
      trade.at = at
      settle(trade)
      open.delete(tradeId)
    }
  }

  for (const record of records) {
    const kind = record.kind
    const id = Number(record.id)
    const p = record.payload ?? {}
    const late = String(record.at ?? '') >= PATCH_2026_09_28

    if (kind === 'response' && id === 2) {
      // A new zone: the game closes every trade window. Its characters arrive just BEFORE this
      // response, so a PA in the last two seconds marks it (the engine's rule, src/trades).
      zone = { cluster: typeof p['8'] === 'string' ? p['8'] : null, masked: lastMaskAt != null && Date.parse(record.at) - lastMaskAt <= 2000 }
      self = typeof p['2'] === 'string' ? p['2'] : self
      open.forEach(settle)
      open.clear()
    } else if ((kind === 'event' && id === 29 && isPA(p['1'])) || (kind === 'event' && id === 279 && isPA(p['2']))) {
      zone.masked = true
      lastMaskAt = Date.parse(record.at)
    } else if ((kind === 'response' && id === 161) || (kind === 'event' && id === 176)) {
      if (kind === 'response' && record.rc != null && record.rc !== 0) {
        refused += 1
        continue
      }

      // An invitation is always a new trade (src/trades): one still open under its id lost its end.
      if (open.has(num(p['6']))) {
        settle(open.get(num(p['6'])))
        open.delete(num(p['6']))
      }

      const trade = tradeFor(num(p['6']))
      const shape = guildShape(p)

      trade.invite = unprinted(
        { direction: kind === 'response' ? 'sent' : 'received', name: typeof p['1'] === 'string' ? p['1'] : null, guild: typeof p['2'] === 'string' ? p['2'] : null, guildShape: shape, masked: isPA(p['1']) },
        'rawName',
        typeof p['1'] === 'string' ? p['1'] : null
      )
      trade.zone = zone
      invites.push({ record, trade })
      guildShapes[shape] = (guildShapes[shape] ?? 0) + 1

      if (late && kind === 'response') {
        postPatch.invites += 1
      }
    } else if (kind === 'event' && id === 179) {
      const trade = tradeFor(num(p['0']))
      const revision = num(p['1'])

      trade.updates += 1

      if (trade.last == null || revision >= trade.last.revision) {
        trade.last = {
          revision,
          gave: listLength(p['8']),
          got: listLength(p['18']),
          silverGave: Math.floor((num(p['2']) || 0) / 10000),
          silverGot: Math.floor((num(p['4']) || 0) / 10000),
          items: { gave: sideItems(p, OURS), got: sideItems(p, THEIRS) }
        }
      }

      if (late) {
        postPatch.updates += 1
      }
    } else if (kind === 'request' && id === 166) {
      const trade = open.get(num(p['0']))

      if (trade != null) {
        trade.accepted = num(p['1'])
      }
    } else if (kind === 'event' && id === 178) {
      close(num(p['0']), 'cancelled', record.at)
    } else if (kind === 'event' && id === 180) {
      close(num(p['0']), 'finished', record.at)

      if (late) {
        postPatch.finishes += 1
      }
    }
  }

  open.forEach(settle)

  // After the loop, because a zone can show its mask after the invitation (a PA looter later on).
  const hiddenRecords = new Set()

  for (const { record, trade } of invites) {
    if (trade.zone.masked && !trade.invite.masked && trade.invite.name != null) {
      trade.invite.nameLength = trade.invite.name.length
      hiddenNames.add(trade.invite.name)
      trade.invite.name = null
      trade.invite.guild = null
      hiddenRecords.add(record)
    }
  }

  // What arrived around a finish where we RECEIVED items: the engine's chest-window path could write
  // such a put as a pickup (the phantom-pickup question). Counted, not judged.
  const received = trades.filter((t) => t.outcome === 'finished' && t.last != null && t.last.got > 0)

  for (const trade of received) {
    trade.around = { put: 0, simple: 0, equipment: 0 }
  }

  if (received.length > 0) {
    for (const record of records) {
      const field = record.kind === 'event' ? ITEM_EVENTS[Number(record.id)] : undefined

      if (field == null) {
        continue
      }

      const ms = Date.parse(record.at)

      for (const trade of received) {
        if (Math.abs(ms - Date.parse(trade.at)) <= AROUND_MS) {
          trade.around[field] += 1
        }
      }
    }
  }

  // `hiddenRecords` is not enumerable: `--json` would print a Set as {}, and it is for codeReport.
  return unprinted(unprinted({ trades, refused, guildShapes, postPatch }, 'hiddenRecords', hiddenRecords), 'hiddenNames', hiddenNames)
}

// ── two machines, one trade (R3 --compare) ───────────────────────────────────
//
// Both players record the same session, and every trade they finish with each other is in both
// files: the mirror of a trade here is one there whose capturer is our partner and whose partner is
// our capturer, finishing within COMPARE_WINDOW_MS of ours. Each machine stamps `at` with its own
// clock, so the window allows for skew; of several candidates the nearest finish wins, and each
// trade sits in one pair at most. What a pair agrees on is what the bot's dedup of a trade that both
// members uploaded can rest on.

const COMPARE_WINDOW_MS = 120000

const nameKey = (name) => name.trim().toUpperCase()

/**
 * Does `partner` (one machine's invitation) name `self` (the other machine's capturer)? A `PA` partner
 * names anyone — it is the Ancient Lands' mask, not a person — so a pair made through it is labelled.
 */
const namesMatch = (partner, self) => {
  if (typeof partner !== 'string') {
    return null
  }

  if (isPA(partner)) {
    return 'masked'
  }

  return typeof self === 'string' && nameKey(partner) === nameKey(self) ? 'named' : null
}

const itemKey = (item) => `${item.index}×${item.qty} q${item.quality ?? '?'}`

/** Two stack lists as multisets (index + quantity + quality): what only one of them holds. */
const sameItems = (ours, theirs) => {
  if (ours == null || theirs == null) {
    return { equal: null, stacks: null, onlyA: [], onlyB: [] }
  }

  const balance = new Map()

  for (const item of ours) {
    balance.set(itemKey(item), (balance.get(itemKey(item)) ?? 0) + 1)
  }

  for (const item of theirs) {
    balance.set(itemKey(item), (balance.get(itemKey(item)) ?? 0) - 1)
  }

  const onlyA = []
  const onlyB = []

  for (const [key, n] of [...balance.entries()].sort((x, y) => x[0].localeCompare(y[0]))) {
    const into = n > 0 ? onlyA : onlyB

    for (let i = 0; i < Math.abs(n); i += 1) {
      into.push(key)
    }
  }

  return { equal: onlyA.length === 0 && onlyB.length === 0, stacks: ours.length, onlyA, onlyB }
}

/** What a pair disagrees on, in words (empty when it agrees). The trade id is not on the list. */
const disagreements = (p) => [
  ...(p.revision.equal ? [] : ['final revision']),
  ...(p.accepted.equal === false ? ['accepted revision'] : []),
  ...(p.items.aGaveBGot.equal === true ? [] : ['A gave / B got']),
  ...(p.items.aGotBGave.equal === true ? [] : ['A got / B gave'])
]

/**
 * Pair the finished trades of recording A (`a`, its tradeEvidence) with recording B's. Matches on the
 * raw names, prints none that either analysis blanked: every name in the result has passed `show`.
 */
const compareTrades = (a, b) => {
  const blanked = new Set([...a.hiddenNames, ...b.hiddenNames].map(nameKey))
  const show = (name) => (typeof name !== 'string' ? null : isPA(name) ? 'PA' : blanked.has(nameKey(name)) ? '«real name, not printed»' : name)
  const finished = (evidence) => evidence.trades.filter((t) => t.outcome === 'finished' && t.last != null)
  const ours = finished(a)
  const theirs = finished(b)
  const candidates = []

  for (const x of ours) {
    for (const y of theirs) {
      const skew = Date.parse(y.at) - Date.parse(x.at)
      const there = namesMatch(x.invite?.rawName, y.self)
      const back = namesMatch(y.invite?.rawName, x.self)

      if (Math.abs(skew) <= COMPARE_WINDOW_MS && there != null && back != null) {
        candidates.push({ x, y, skew, masks: [there, back].filter((m) => m === 'masked').length })
      }
    }
  }

  candidates.sort((p, q) => Math.abs(p.skew) - Math.abs(q.skew))

  const describe = (t) => ({ tradeId: t.tradeId, at: t.at, partner: show(t.invite?.rawName), direction: t.invite?.direction ?? null })
  const pairedA = new Set()
  const pairedB = new Set()
  const pairs = []

  for (const { x, y, skew, masks } of candidates) {
    if (pairedA.has(x) || pairedB.has(y)) {
      continue
    }

    pairedA.add(x)
    pairedB.add(y)

    const accepted = x.accepted == null || y.accepted == null ? null : x.accepted === y.accepted
    const pair = {
      a: describe(x),
      b: describe(y),
      skewSeconds: Math.round(skew / 100) / 10,
      pairedBy: ['names', 'one name (the other partner was PA)', 'time alone (both partners were PA)'][masks],
      tradeIdEqual: x.tradeId === y.tradeId,
      revision: { a: x.last.revision, b: y.last.revision, equal: x.last.revision === y.last.revision },
      accepted: { a: x.accepted, b: y.accepted, equal: accepted },
      items: { aGaveBGot: sameItems(x.last.items.gave, y.last.items.got), aGotBGave: sameItems(x.last.items.got, y.last.items.gave) },
      silver: {
        aGave: x.last.silverGave,
        aGot: x.last.silverGot,
        bGave: y.last.silverGave,
        bGot: y.last.silverGot,
        mirrored: x.last.silverGave === y.last.silverGot && x.last.silverGot === y.last.silverGave
      }
    }

    // Silver is reported beside the grade, not in it: R3's item grades revisions and both item sides.
    pair.agrees = disagreements(pair).length === 0
    pairs.push(pair)
  }

  pairs.sort((p, q) => String(p.a.at).localeCompare(String(q.a.at)))

  const unpaired = (list, paired) =>
    list
      .filter((t) => !paired.has(t))
      .map((t) => ({
        ...describe(t),
        reason: t.invite == null ? 'no invitation seen: the partner is unknown' : t.self == null ? 'no Join seen: whose recording is unknown' : `no mirror finishing within ${COMPARE_WINDOW_MS / 1000} s`
      }))
  const capturers = (evidence) => [...new Set(evidence.trades.map((t) => t.self).filter((n) => n != null))].map(show)

  return {
    windowSeconds: COMPARE_WINDOW_MS / 1000,
    capturers: { a: capturers(a), b: capturers(b) },
    finished: { a: ours.length, b: theirs.length },
    pairs,
    unpaired: { a: unpaired(ours, pairedA), b: unpaired(theirs, pairedB) }
  }
}

// ── the analysis ─────────────────────────────────────────────────────────────

const analyze = (records, options = {}) => {
  const samplesWanted = options.samples ?? 2
  const census = new Map()
  const perKind = { event: 0, request: 0, response: 0, other: 0 }
  const hits = new Map(TARGETS.map((t) => [t.key, { count: 0, qualified: 0, profiles: new Map(), samples: [] }]))
  // Several targets may watch one code (event 355 is both "landed" and "escaped").
  const targetIndex = new Map()

  for (const t of TARGETS) {
    const key = `${t.kind}:${t.id}`

    targetIndex.set(key, [...(targetIndex.get(key) ?? []), t])
  }

  // What the game answered each market action — the only proof a deal went through,
  // because the reply's parameter table is empty.
  const MARKET_REPLIES = new Set([79, 80, 83, 315, 244, 245])
  const replies = new Map()
  const joins = []
  // Fame (82) is addressed only to the member. Silver pickups (62) and harvests (61) are
  // BROADCAST for the players around them too (2026-09-16: 18 of 355 pickups were the
  // member's), so for counting they must be filtered on the join id — but a join id that
  // appears as their actor is still the member, since nobody else carries it.
  const ownOnly = { fame: new Set(), silver: new Set(), harvest: new Set() }
  const healthCausers = new Map()
  const healthTargets = new Map()
  const characters = new Map()
  const mails = { lists: [], bodies: [] }
  let first = null
  let last = null

  for (const record of records) {
    const kind = ['event', 'request', 'response'].includes(record.kind) ? record.kind : 'other'
    const id = record.id == null ? null : Number(record.id)
    const payload = record.payload ?? {}

    perKind[kind] += 1

    if (record.at) {
      first = first ?? record.at
      last = record.at
    }

    const censusKey = `${kind}:${id}`

    census.set(censusKey, (census.get(censusKey) ?? 0) + 1)

    for (const target of targetIndex.get(censusKey) ?? []) {
      const hit = hits.get(target.key)
      const profile = keyProfile(payload)

      hit.count += 1
      hit.profiles.set(profile, (hit.profiles.get(profile) ?? 0) + 1)

      if (target.qualify && target.qualify.test(payload)) {
        hit.qualified += 1
      }

      if (hit.samples.length < samplesWanted) {
        hit.samples.push(compact(target.redact ? redact(payload, target.redact) : payload))
      }
    }

    if (kind === 'response' && MARKET_REPLIES.has(id)) {
      const code = record.rc == null ? 'not recorded' : String(record.rc)
      const row = replies.get(id) ?? new Map()

      row.set(code, (row.get(code) ?? 0) + 1)
      replies.set(id, row)
    }

    // The evidence the "whose object id is me" question needs.
    if (kind === 'response' && id === 2) {
      joins.push({ at: record.at, objectId: num(payload['0']), name: payload['2'], cluster: payload['8'] })
    } else if (kind === 'event' && id === 82) {
      ownOnly.fame.add(num(payload['0']))
    } else if (kind === 'event' && id === 62) {
      ownOnly.silver.add(num(payload['0']))
    } else if (kind === 'event' && id === 61) {
      ownOnly.harvest.add(num(payload['0']))
    } else if (kind === 'event' && id === 6) {
      const causer = num(payload['6'])
      const target6 = num(payload['0'])

      healthCausers.set(causer, (healthCausers.get(causer) ?? 0) + 1)
      healthTargets.set(target6, (healthTargets.get(target6) ?? 0) + 1)
    } else if (kind === 'event' && id === 29 && typeof payload['1'] === 'string') {
      characters.set(num(payload['0']), payload['1'])
    } else if (kind === 'response' && id === 174) {
      mails.lists.push(record.at)
    } else if (kind === 'response' && id === 176) {
      mails.bodies.push(record.at)
    }
  }

  // Own id: a Join's param 0 that ALSO appears as the actor of an own-only packet.
  const joinIds = [...new Set(joins.map((j) => j.objectId).filter((n) => Number.isFinite(n)))]
  const ownId = {
    joinIds,
    matches: joinIds.map((objectId) => ({
      objectId,
      fame: ownOnly.fame.has(objectId),
      silver: ownOnly.silver.has(objectId),
      harvest: ownOnly.harvest.has(objectId),
      causedHits: healthCausers.get(objectId) ?? 0,
      tookHits: healthTargets.get(objectId) ?? 0,
      namedByNewCharacter: characters.get(objectId) ?? null
    })),
    settled: false,
    note: ''
  }

  ownId.settled = ownId.matches.some((m) => m.fame || m.silver || m.harvest)

  if (joinIds.length === 0) {
    ownId.note = 'no Join response in the recording — change zone once while recording'
  } else if (ownId.settled) {
    ownId.note = 'a Join param 0 acts in fame, silver or harvest: that is the member (the id is reissued on every join)'
  } else if (ownId.matches.some((m) => m.causedHits > 0)) {
    ownId.note = 'Join param 0 causes hits but no fame, silver or harvest confirms it — earn fame or gather once'
  } else {
    ownId.note = 'Join param 0 appears on no combat or own-only packet — the Q24 mismatch stands; record a fight AND a pickup in the same zone'
  }

  // Mail timing: a body that precedes every list is a body nobody asked for.
  const firstList = mails.lists[0] ?? null
  const unpromptedBodies = firstList == null ? mails.bodies.length : mails.bodies.filter((at) => at < firstList).length

  const counts = {}

  for (const [key, hit] of hits) {
    counts[key] = hit.count
    counts[`${key}_q`] = hit.qualified
  }

  const state = { joins, ownId, mails: { lists: mails.lists.length, bodies: mails.bodies.length, unpromptedBodies }, trades: tradeEvidence(records), compare: null }

  // `--compare`: the other machine's recording, read for its trades alone.
  if (options.compareRecords != null) {
    state.compare = { file: options.compareLabel ?? 'the other recording', ...compareTrades(state.trades, tradeEvidence(options.compareRecords)) }
  }

  const checklist = (items) =>
    items
      .filter((item) => item.only == null || item.only(state))
      .map((item) => ({
      label: item.label,
      pass: Boolean(item.test(counts, state)),
      why: item.why,
      ...(item.detail ? { detail: item.detail(counts, state) } : {})
    }))

  return {
    records: records.length,
    perKind,
    span: { first, last, seconds: first && last ? Math.max(0, Math.round((Date.parse(last) - Date.parse(first)) / 1000)) : null },
    census: [...census.entries()]
      .map(([key, count]) => {
        const [kind, id] = key.split(':')

        return { kind, id: id === 'null' ? null : Number(id), name: id === 'null' ? '(no code)' : nameOf(kind, id), count }
      })
      .sort((a, b) => b.count - a.count),
    targets: TARGETS.map((t) => {
      const hit = hits.get(t.key)

      return {
        key: t.key,
        label: t.label,
        kind: t.kind,
        id: t.id,
        name: nameOf(t.kind, t.id),
        count: hit.count,
        qualified: t.qualify ? { label: t.qualify.label, count: hit.qualified } : null,
        profiles: [...hit.profiles.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([keys, count]) => ({ keys, count })),
        samples: hit.samples
      }
    }),
    ownId,
    mails: state.mails,
    replies: [...replies.entries()].map(([id, codes]) => ({ id, name: nameOf('response', id), codes: Object.fromEntries(codes) })),
    trades: state.trades,
    ...(state.compare != null ? { compare: state.compare } : {}),
    checks: { r1: checklist(R1), r2: checklist(R2), r3: checklist(R3) }
  }
}

/**
 * Every record of one code, any kind — for reading a shape the summary only counts. `hidden`: the
 * trade invitations whose real name a masked zone would have hidden (tradeEvidence), printed with
 * name and guild as lengths.
 */
const codeReport = (records, code, samples, hidden = new Set()) =>
  records
    .filter((r) => Number(r.id) === code)
    .slice(0, samples)
    .map((r) => `${r.at ?? ''} ${r.kind} ${code} ${nameOf(r.kind, code)} · ${compact(hidden.has(r) ? redact(r.payload, ['1', '2']) : r.payload, 40)}`)

// ── rendering ────────────────────────────────────────────────────────────────

const pad = (s, n) => String(s).padEnd(n)

/**
 * One line per trade. A partner's name is printed as the game sent it — except a REAL name in a zone
 * that masks players, which tradeEvidence has already blanked.
 */
const renderTrades = (evidence) => {
  const out = []
  const ended = (outcome) => evidence.trades.filter((t) => t.outcome === outcome).length
  const silver = (n) => (n > 0 ? ` + ${n.toLocaleString('en-US')} silver` : '')

  out.push(`Player trades — ${evidence.trades.length} (finished ${ended('finished')}, cancelled ${ended('cancelled')}, unfinished ${ended(null)}; refused invitations ${evidence.refused})`)

  for (const t of evidence.trades) {
    const name = t.invite?.masked ? 'PA' : t.invite?.nameLength != null ? '«real name, not printed»' : (t.invite?.name ?? '«no name»')
    const guild = t.invite?.guild ? ` [${t.invite.guild}]` : t.invite?.guildShape === 'named' ? ' [guild not printed]' : ` (guild ${t.invite?.guildShape})`
    const who = t.invite == null ? 'partner unknown (no invitation seen)' : `${t.invite.direction === 'sent' ? 'you invited' : 'invited by'} ${name}${guild}`
    const what = t.last == null ? 'no update' : `rev ${t.last.revision}${t.accepted != null ? ` (you accepted ${t.accepted})` : ''} · gave ${t.last.gave} stack(s)${silver(t.last.silverGave)} · got ${t.last.got} stack(s)${silver(t.last.silverGot)}`

    out.push(`  #${pad(t.tradeId, 6)} ${pad(t.outcome ?? 'unfinished', 10)} ${t.at ?? ''} · ${who} · zone ${t.zone.cluster ?? '?'}${t.zone.masked ? ' (masked)' : ''} · ${what}`)
  }

  return out.join('\n')
}

/** The --compare section: one block per pair, then the trades with no mirror. Names arrive printable. */
const renderCompare = (compare) => {
  const out = []
  const who = (names) => names.map((n) => n ?? '?').join(', ') || 'no Join'
  const silver = (n) => n.toLocaleString('en-US')
  const items = (side) =>
    side.equal === true
      ? `same, ${side.stacks} stack(s)`
      : side.equal == null
        ? 'unknown (a list the dump cut short)'
        : `DIFFER — only A: ${side.onlyA.join(', ') || '—'}; only B: ${side.onlyB.join(', ') || '—'}`

  out.push(`Two machines — A: this recording (${who(compare.capturers.a)}) · B: ${compare.file} (${who(compare.capturers.b)})`)
  out.push(`  finished trades A ${compare.finished.a}, B ${compare.finished.b} · paired ${compare.pairs.length} (finishes within ±${compare.windowSeconds} s by each machine's clock, nearest first)`)

  for (const p of compare.pairs) {
    const accepted = `${p.accepted.a ?? '–'}/${p.accepted.b ?? '–'}${p.accepted.equal === false ? ' DIFFERS' : p.accepted.equal == null ? ' (one side sent none)' : ''}`

    out.push(`  A #${p.a.tradeId} ${p.a.at} ↔ B #${p.b.tradeId} ${p.b.at} · B ${p.skewSeconds >= 0 ? '+' : ''}${p.skewSeconds} s · paired by ${p.pairedBy} · ${p.agrees ? 'AGREE' : `DISAGREE (${disagreements(p).join(', ')})`}`)
    out.push(`          A ${p.a.direction === 'sent' ? 'invited' : 'was invited by'} ${p.a.partner ?? '?'} · trade id ${p.tradeIdEqual ? 'same' : 'DIFFERS'} · final revision ${p.revision.a}/${p.revision.b}${p.revision.equal ? '' : ' DIFFERS'} · accepted ${accepted}`)
    out.push(`          A gave = B got: ${items(p.items.aGaveBGot)} · A got = B gave: ${items(p.items.aGotBGave)}`)
    out.push(`          silver ${p.silver.mirrored ? 'mirrored' : 'NOT mirrored'}: A gave ${silver(p.silver.aGave)} / B got ${silver(p.silver.bGot)} · A got ${silver(p.silver.aGot)} / B gave ${silver(p.silver.bGave)}`)
  }

  for (const [side, list] of [
    ['A', compare.unpaired.a],
    ['B', compare.unpaired.b]
  ]) {
    for (const t of list) {
      out.push(`  unpaired in ${side}: #${t.tradeId} ${t.at} · partner ${t.partner ?? '?'} · ${t.reason}`)
    }
  }

  const same = compare.pairs.filter((p) => p.tradeIdEqual).length

  out.push(`  trade id equal in ${same} of ${compare.pairs.length} pair(s) — reported, not graded: the bot's dedup may key on it only if it always holds`)

  return out.join('\n')
}

const render = (summary, options = {}) => {
  const out = []
  const top = options.top ?? 30
  const wantR1 = options.r1 ?? true
  const wantR2 = options.r2 ?? true
  const wantR3 = options.r3 ?? true

  out.push(`Records: ${summary.records} (events ${summary.perKind.event}, requests ${summary.perKind.request}, responses ${summary.perKind.response})`)
  out.push(`Span: ${summary.span.first ?? '?'} → ${summary.span.last ?? '?'}${summary.span.seconds != null ? ` (${Math.floor(summary.span.seconds / 60)}m ${summary.span.seconds % 60}s)` : ''}`)
  out.push('')
  out.push(`Census — top ${top} of ${summary.census.length} distinct codes (names: ${CODES.source.split(' — ')[0]})`)

  for (const row of summary.census.slice(0, top)) {
    out.push(`  ${pad(row.count, 7)} ${pad(row.kind, 9)} ${pad(row.id ?? '-', 5)} ${row.name}`)
  }

  out.push('')
  out.push('Stat packets — count · qualified · key profiles · first sample')

  for (const t of summary.targets) {
    const q = t.qualified ? ` · ${t.qualified.count} ${t.qualified.label}` : ''
    const profiles = t.profiles.map((p) => `{${p.keys}}×${p.count}`).join(' ')

    out.push(`  ${pad(t.count, 6)} ${pad(`${t.kind} ${t.id}`, 13)} ${pad(t.label, 34)} ${t.name}${q}`)

    if (t.count > 0) {
      out.push(`         keys ${profiles}`)

      for (const sample of t.samples) {
        out.push(`         ${sample}`)
      }
    }
  }

  out.push('')
  out.push('Whose object id is "me"')

  if (summary.ownId.joinIds.length === 0) {
    out.push(`  ${summary.ownId.note}`)
  } else {
    for (const m of summary.ownId.matches) {
      out.push(`  Join param 0 = ${m.objectId}: fame ${m.fame ? 'yes' : 'no'} · silver pickup ${m.silver ? 'yes' : 'no'} · harvest ${m.harvest ? 'yes' : 'no'} · caused ${m.causedHits} hits · took ${m.tookHits} hits · NewCharacter name ${m.namedByNewCharacter ?? '—'}`)
    }

    out.push(`  → ${summary.ownId.note}`)
  }

  if (summary.replies.length > 0) {
    out.push('')
    out.push('Market replies — return code per reply (0 = Photon OK; "not recorded" = a recorder older than 2026-09-18)')

    for (const r of summary.replies) {
      out.push(`  response ${pad(r.id, 4)} ${pad(r.name, 32)} ${Object.entries(r.codes).map(([code, n]) => `${code}×${n}`).join('  ')}`)
    }
  }

  out.push('')
  out.push(`Market mail — lists ${summary.mails.lists} · bodies ${summary.mails.bodies} · bodies before any list ${summary.mails.unpromptedBodies}${summary.mails.bodies > 0 && summary.mails.unpromptedBodies === 0 ? ' (every body followed a list: the mailbox was open)' : ''}`)

  const renderChecks = (title, checks) => {
    out.push('')
    out.push(title)

    for (const c of checks) {
      out.push(`  ${c.pass ? 'PASS   ' : 'MISSING'} ${pad(c.label, 52)} ${c.pass ? '' : `← ${c.why}`}`)

      if (c.detail != null) {
        out.push(`          ${c.detail}`)
      }
    }

    const passed = checks.filter((c) => c.pass).length

    out.push(`  ${passed}/${checks.length}`)
  }

  if (wantR1) {
    renderChecks('R1 — open world', summary.checks.r1)
  }

  if (wantR2) {
    renderChecks('R2 — a city', summary.checks.r2)
  }

  if (wantR3) {
    out.push('')
    out.push(renderTrades(summary.trades))

    if (summary.compare != null) {
      out.push('')
      out.push(renderCompare(summary.compare))
    }

    renderChecks('R3 — player trades', summary.checks.r3)
  }

  return out.join('\n')
}

// ── command line ─────────────────────────────────────────────────────────────

const parseArgs = (argv) => {
  const options = { files: [], r1: null, r2: null, r3: null, top: 30, samples: 2, code: null, json: false, compare: null }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]

    if (arg === '--r1') options.r1 = true
    else if (arg === '--r2') options.r2 = true
    else if (arg === '--r3') options.r3 = true
    else if (arg === '--json') options.json = true
    else if (arg === '--top') options.top = Number(argv[++i])
    else if (arg === '--samples') options.samples = Number(argv[++i])
    else if (arg === '--code') options.code = Number(argv[++i])
    else if (arg === '--compare') options.compare = argv[++i]
    else if (arg.startsWith('--')) throw new Error(`unknown option ${arg}`)
    else options.files.push(arg)
  }

  if (options.compare === undefined || String(options.compare).startsWith('--')) {
    throw new Error('--compare needs the other machine\'s recording')
  }

  // Asking for one checklist hides the others; asking for none shows all three — or, with --compare
  // (the R3 two-machine run), R3 alone. --compare always shows R3: that is where it prints.
  if (options.r1 == null && options.r2 == null && options.r3 == null) {
    options.r1 = options.compare == null
    options.r2 = options.compare == null
    options.r3 = true
  }

  if (options.compare != null) {
    options.r3 = true
  }

  return options
}

const main = () => {
  const options = parseArgs(process.argv.slice(2))

  if (options.files.length === 0) {
    console.error('usage: node tools/analyze-recording.js <guild-dump-*.jsonl>… [--r1] [--r2] [--r3] [--compare <other.jsonl>] [--top N] [--samples N] [--code N] [--json]')
    process.exit(2)
  }

  const records = []
  let bad = 0

  for (const file of options.files) {
    const read = readRecords(path.resolve(file))

    // A spread passes every record as an ARGUMENT, and a real 32-minute recording is
    // 130k of them: Node throws RangeError: Maximum call stack size exceeded, on
    // exactly the input this tool exists for. Append one at a time.
    for (const record of read.records) {
      records.push(record)
    }

    bad += read.bad
  }

  const byAt = (a, b) => String(a.at ?? '').localeCompare(String(b.at ?? ''))

  records.sort(byAt)

  // --compare: the other player's recording of the same session, by their machine's clock.
  let compareRecords = null

  if (options.compare != null) {
    const read = readRecords(path.resolve(options.compare))

    compareRecords = read.records.sort(byAt)
    bad += read.bad
  }

  const summary = analyze(records, { ...options, compareRecords, compareLabel: options.compare == null ? null : path.basename(options.compare) })

  if (options.json) {
    console.log(JSON.stringify(summary, null, 1))
    return
  }

  console.log(render(summary, { top: options.top, r1: options.r1 === true, r2: options.r2 === true, r3: options.r3 === true }))

  if (bad > 0) {
    console.log(`\n(${bad} unreadable lines skipped)`)
  }

  if (options.code != null) {
    console.log(`\nAll records with code ${options.code} (first ${options.samples * 5}):`)

    for (const line of codeReport(records, options.code, options.samples * 5, summary.trades.hiddenRecords)) {
      console.log(`  ${line}`)
    }
  }
}

if (require.main === module) {
  main()
}

module.exports = { analyze, render, readRecords, parseArgs, TARGETS, R1, R2, R3, __test: { num, has, compact, keyProfile, tradeEvidence, guildShape, codeReport, compareTrades, sideItems } }
