const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { fresh, useFakeClock, joinEvent } = require('./helpers')
const { createPlayerTrades, buildRecord, describeTrade, isHiddenName } = require('../src/trades/player-trades')
const { wholeSilver, parseUpdate, parseBareTradeId, parseInvite } = require('../src/data-handler/player-trade-wire')
const { TradeLog, tradeFileFor } = require('../src/trades/trade-log')
const ParserError = require('../src/data-handler/parser-error')

// Every re-require of loot-logger registers a process exit handler.
process.setMaxListeners(80)

/**
 * The player-trade state machine and the packets that drive it. Payload shapes are the ones the
 * owner's recordings of 2026-09-16/21 hold (see the replay test for the real thing): an update
 * always carries every array, empty or not, and omits a zero silver amount.
 */

const ME = { playerName: 'Me', guildName: 'OurGuild', allianceName: 'OurAlliance' }

/** Event 179's full layout: our side 6–16, the partner's 17–26 (no object ids), silver at 2 and 4. */
const update = (tradeId, revision, { gave = [], got = [], silverGave = 0, silverGot = 0 } = {}) => {
  const p = { 0: tradeId, 1: revision }

  if (silverGave > 0) {
    p[2] = silverGave
  }

  if (silverGot > 0) {
    p[4] = silverGot
  }

  Object.assign(p, {
    6: gave.map((_, i) => 5000 + i),
    7: gave.map((_, i) => i),
    8: gave.map((g) => g.index),
    9: gave.map(() => 'SomeCrafter'),
    10: gave.map((g) => g.quality ?? 1),
    11: gave.map(() => 643240000),
    12: gave.map(() => 0),
    13: gave.length > 0 ? gave.map(() => [-1, -1, -1]) : [[-1]],
    14: gave.length > 0 ? gave.map(() => [-1]) : [[-1]],
    15: gave.map((g) => g.qty),
    16: gave.map(() => ''),
    17: got.map((_, i) => i),
    18: got.map((g) => g.index),
    19: got.map(() => 'OtherCrafter'),
    20: got.map((g) => g.quality ?? 1),
    21: got.map(() => 25669549),
    22: got.map(() => 0),
    23: got.length > 0 ? got.map(() => []) : [[-1]],
    24: got.length > 0 ? got.map(() => [205]) : [[-1]],
    25: got.map((g) => g.qty),
    26: got.map(() => '')
  })

  return p
}

const ITEMS = {
  570: { itemId: 'T7_POTION_REVIVE', itemName: 'Major Gigantify Potion' },
  9484: { itemId: 'T8_2H_KNUCKLES_SET3', itemName: "Elder's Spiked Gauntlets" }
}
const item = (index) => ITEMS[index] ?? { itemId: `UNKNOWN_${index}`, itemName: `Unknown Item (${index})` }

/** A machine with a hand-driven clock. */
const machine = () => {
  let now = 1_000_000

  return { m: createPlayerTrades({ now: () => now }), advance: (ms) => (now += ms) }
}

const invite = (m, tradeId, initiator = 'self', name = 'Partner1', guild = 'OurGuild') =>
  m.invited({ tradeId, initiator, partner: { objId: 9854, name, guild } })

const feedUpdate = (m, payload) => m.updated(parseUpdate(payload))

// ── the state machine ────────────────────────────────────────────────────────

test('an invitation WE sent opens a trade named by the response; the finish returns it', () => {
  const { m } = machine()

  invite(m, 1766, 'self', 'Partner7')
  feedUpdate(m, update(1766, 2))
  feedUpdate(m, update(1766, 3, { gave: [{ index: 570, qty: 11, quality: 1 }] }))
  m.accepted({ tradeId: 1766, revision: 3 })

  const trade = m.finished(1766)

  assert.equal(trade.initiator, 'self')
  assert.deepEqual(trade.partner, { name: 'Partner7', guild: 'OurGuild', hidden: false })
  assert.equal(trade.complete, true)
  assert.deepEqual(trade.gave, [{ index: 570, qty: 11, quality: 1 }])
  assert.deepEqual(trade.got, [])
  assert.equal(m.size(), 0)
})

test('an invitation WE received (event 176) opens it the other way round', () => {
  const { m } = machine()

  invite(m, 1250, 'partner', 'Partner2')
  feedUpdate(m, update(1250, 3, { got: [{ index: 2587, qty: 1, quality: 4 }] }))

  const trade = m.finished(1250)

  assert.equal(trade.initiator, 'partner')
  assert.equal(trade.partner.name, 'Partner2')
  assert.deepEqual(trade.got, [{ index: 2587, qty: 1, quality: 4 }])
})

test('started mid-trade: an update for a trade never invited opens it with the partner unknown, incomplete', () => {
  const { m } = machine()

  feedUpdate(m, update(42, 7, { silverGave: 600000000000 }))

  const trade = m.finished(42)

  assert.equal(trade.initiator, null)
  assert.deepEqual(trade.partner, { name: null, guild: null, hidden: false })
  assert.equal(trade.complete, false)
  assert.equal(trade.silverGave, 60000000)
})

test('only the highest revision counts: a late, older update does not overwrite a newer one', () => {
  const { m } = machine()

  invite(m, 327)
  feedUpdate(m, update(327, 5, { gave: [{ index: 9484, qty: 4, quality: 4 }, { index: 9484, qty: 5, quality: 3 }] }))
  assert.equal(feedUpdate(m, update(327, 4, { gave: [{ index: 9484, qty: 4, quality: 4 }] })), false)

  assert.equal(m.finished(327).gave.length, 2)
})

test('a cancelled trade writes nothing, the offer included — even if a finish for its id follows', () => {
  const { m } = machine()

  invite(m, 1250, 'partner', 'Partner2')
  feedUpdate(m, update(1250, 4, { got: [{ index: 2587, qty: 1, quality: 4 }, { index: 3035, qty: 1, quality: 1 }] }))
  m.cancelled(1250)

  assert.equal(m.size(), 0)
  assert.equal(m.finished(1250), null)
})

test('a trade nobody finished expires after ten minutes of silence', () => {
  const { m, advance } = machine()

  invite(m, 3792)
  feedUpdate(m, update(3792, 2))
  advance(10 * 60_000 + 1)

  assert.equal(m.finished(3792), null)
})

test('a trade that keeps changing stays open however long it takes', () => {
  const { m, advance } = machine()

  invite(m, 3792)

  for (let revision = 2; revision < 8; revision += 1) {
    advance(4 * 60_000)
    feedUpdate(m, update(3792, revision, { silverGave: revision * 10000 }))
  }

  assert.equal(m.finished(3792).silverGave, 7)
})

test('a zone join closes every trade window', () => {
  const { m } = machine()

  invite(m, 295)
  feedUpdate(m, update(295, 10, { silverGave: 600000000000 }))
  m.zoneChanged('@ISLAND@0348586a-f6d4-04ec-b303-b66b5e4c7217')

  assert.equal(m.finished(295), null)
  assert.equal(m.state().zone, '@ISLAND@0348586a-f6d4-04ec-b303-b66b5e4c7217')
})

test('no more than eight trades are held: the one touched longest ago goes', () => {
  const { m, advance } = machine()

  for (let id = 68; id < 77; id += 1) {
    invite(m, id)
    advance(1000)
  }

  assert.equal(m.size(), 8)
  assert.deepEqual(m.state().sessions, [69, 70, 71, 72, 73, 74, 75, 76])
})

test('integrity: a last update that is not the revision we accepted is incomplete, older or newer', () => {
  const missed = machine().m

  invite(missed, 300)
  feedUpdate(missed, update(300, 11, { silverGave: 166780000000 }))
  missed.accepted({ tradeId: 300, revision: 12 }) // the update with revision 12 never reached us

  const stale = missed.finished(300)

  assert.equal(stale.revision, 11)
  assert.equal(stale.acceptedRevision, 12)
  assert.equal(stale.complete, false)

  const intact = machine().m

  invite(intact, 300)
  feedUpdate(intact, update(300, 12, { silverGave: 166780000000 }))
  intact.accepted({ tradeId: 300, revision: 12 })
  assert.equal(intact.finished(300).complete, true)

  // Newer than our accept: the window changed after it, which resets the accepts in game — the
  // accept that finished it was lost, or two trades share the session.
  const moved = machine().m

  invite(moved, 300)
  moved.accepted({ tradeId: 300, revision: 12 })
  feedUpdate(moved, update(300, 13, { silverGave: 166780000000 }))
  assert.equal(moved.finished(300).complete, false)

  // No accept seen (the partner accepted last, or the request was lost) is not evidence of a gap.
  const unaccepted = machine().m

  invite(unaccepted, 300)
  feedUpdate(unaccepted, update(300, 12))
  assert.equal(unaccepted.finished(300).acceptedRevision, null)
  assert.equal(unaccepted.finished(300), null) // and a finished trade is gone
})

test('a reused trade id: a new invitation starts a new trade, not the lost one\'s leftovers', () => {
  const { m, advance } = machine()

  // Trade 68 with Alice reaches revision 9; its finish never arrives (a dropped packet).
  invite(m, 68, 'partner', 'Alice')
  feedUpdate(m, update(68, 9, { gave: [{ index: 9484, qty: 9, quality: 1 }], silverGot: 50000000000 }))
  m.accepted({ tradeId: 68, revision: 9 })
  advance(3 * 60_000)

  // Three minutes later the counter hands 68 to a trade with Bob; its revisions restart at 2.
  invite(m, 68, 'self', 'Bob')
  assert.equal(feedUpdate(m, update(68, 2)), true)
  assert.equal(feedUpdate(m, update(68, 3, { got: [{ index: 570, qty: 2, quality: 1 }] })), true)
  m.accepted({ tradeId: 68, revision: 3 })

  const trade = m.finished(68)

  assert.deepEqual(
    [trade.initiator, trade.partner.name, trade.revision, trade.acceptedRevision, trade.complete, trade.gave, trade.got, trade.silverGot],
    ['self', 'Bob', 3, 3, true, [], [{ index: 570, qty: 2, quality: 1 }], 0]
  )

  // The same when the lost trade was opened mid-capture (no invitation of its own).
  const midway = machine().m

  feedUpdate(midway, update(69, 9, { gave: [{ index: 9484, qty: 9, quality: 1 }] }))
  invite(midway, 69, 'self', 'Bob')
  feedUpdate(midway, update(69, 2))
  assert.deepEqual([midway.finished(69).revision, midway.finished(69)], [2, null])
})

test('an accept for a trade we never saw opens nothing', () => {
  const { m } = machine()

  m.accepted({ tradeId: 459, revision: 10 })

  assert.equal(m.size(), 0)
})

test('hidden: a partner the invite names PA is written as nobody, flagged hidden', () => {
  const { m } = machine()

  invite(m, 70, 'partner', 'PA', null)
  feedUpdate(m, update(70, 3, { got: [{ index: 570, qty: 2 }] }))

  assert.deepEqual(m.finished(70).partner, { name: null, guild: null, hidden: true })
})

test('hidden: in a zone that has shown a PA character, a real name in the invite is not written either', () => {
  const { m, advance } = machine()

  m.zoneChanged('DRAGON_AREA_TEST')
  m.sawCharacter('Somebody')
  m.sawCharacter('PA')
  invite(m, 71, 'self', 'RealName')
  feedUpdate(m, update(71, 3, { gave: [{ index: 570, qty: 2 }] }))

  assert.deepEqual(m.finished(71).partner, { name: null, guild: null, hidden: true })

  // The next zone, past a loading screen, has masked nobody (yet), and a PAladin is a person.
  advance(4_000)
  m.zoneChanged('3339')
  m.sawCharacter('PAladin')
  invite(m, 72, 'self', 'RealName')
  feedUpdate(m, update(72, 3))
  assert.deepEqual(m.finished(72).partner, { name: 'RealName', guild: 'OurGuild', hidden: false })
})

test('hidden: a PA in the burst that arrives just BEFORE the join masks the new zone; one long before does not', () => {
  const arriving = machine()

  arriving.m.sawCharacter('PA') // the new zone's party-mates, announced ahead of the Join response
  arriving.advance(10)
  arriving.m.zoneChanged('MASKED_ZONE')
  invite(arriving.m, 73, 'self', 'RealName')
  feedUpdate(arriving.m, update(73, 3))
  assert.equal(arriving.m.finished(73).partner.hidden, true)

  const left = machine()

  left.m.sawCharacter('PA') // the last zone, before the loading screen
  left.advance(4_000)
  left.m.zoneChanged('3339')
  invite(left.m, 74, 'self', 'RealName')
  feedUpdate(left.m, update(74, 3))
  assert.equal(left.m.finished(74).partner.hidden, false)
})

test('isHiddenName: the whole value, any case, trimmed — never a substring', () => {
  assert.equal(isHiddenName('PA'), true)
  assert.equal(isHiddenName(' pa '), true)
  assert.equal(isHiddenName('PAladin'), false)
  assert.equal(isHiddenName(null), false)
})

// ── the wire ─────────────────────────────────────────────────────────────────

test('silver is whole: ×10,000 fixed point, floored — from a number, a BigInt or a long pair', () => {
  assert.equal(wholeSilver(undefined), 0)
  assert.equal(wholeSilver(600000000000), 60000000)
  assert.equal(wholeSilver(419560000000), 41956000)
  assert.equal(wholeSilver(123456789), 12345)
  assert.equal(wholeSilver(600000000000n), 60000000)
  // 2^63 - 1 internal: a BigInt divided as a BigInt keeps every digit.
  assert.equal(wholeSilver(9223372036854775807n), 922337203685477)
  // A Long-style pair (signed low word, as Long.js keeps it) reads the same as the number it encodes.
  const big = 600000000000n

  assert.equal(wholeSilver({ low: Number(BigInt.asIntN(32, big)), high: Number(big >> 32n) }), 60000000)
  assert.throws(() => wholeSilver(-10000), ParserError)
  assert.throws(() => wholeSilver(-10000n), ParserError)
  assert.throws(() => wholeSilver('600000000000'), ParserError)
})

test('an update reads only index, quantity and quality per side, with the reference tool\'s odd-entry rule', () => {
  const p = update(9, 4, { gave: [{ index: 570, qty: 0, quality: 1 }, { index: 0, qty: 3 }], got: [{ index: 9484, qty: 2, quality: 4 }] })

  assert.deepEqual(parseUpdate(p), {
    tradeId: 9,
    revision: 4,
    gave: [{ index: 570, qty: 1, quality: 1 }], // qty 0 is one; index 0 is no item
    got: [{ index: 9484, qty: 2, quality: 4 }],
    silverGave: 0,
    silverGot: 0
  })
})

test('a moved field throws rather than writing an empty trade', () => {
  const p = update(9, 4, { gave: [{ index: 570, qty: 11 }] })

  assert.throws(() => parseUpdate({ ...p, 1: undefined }), ParserError) // no revision
  assert.throws(() => parseUpdate({ ...p, 8: undefined }), ParserError) // no item array
  assert.throws(() => parseUpdate({ ...p, 15: [11, 3] }), ParserError) // arrays of different lengths
  assert.throws(() => parseUpdate({ ...p, 8: ['570'] }), ParserError) // not a number
  assert.throws(() => parseBareTradeId(p, 'EvPlayerTradeFinished'), ParserError) // an update under the finish's code
  assert.throws(() => parseInvite({ 0: 1, 6: 5 }, 'EvInvitationPlayerTrade'), ParserError) // no name
  assert.throws(() => parseInvite({ 0: 1, 1: 'A', 2: 7, 6: 5 }, 'EvInvitationPlayerTrade'), ParserError) // guild not text
  assert.equal(parseBareTradeId({ 0: 1766, 252: 180 }, 'EvPlayerTradeFinished'), 1766)
})

test('a guildless partner: an absent or empty guild both read as none', () => {
  assert.equal(parseInvite({ 0: 1, 1: 'Alt', 6: 5 }, 'x').partner.guild, null)
  assert.equal(parseInvite({ 0: 1, 1: 'Alt', 2: '', 6: 5 }, 'x').partner.guild, null)
  assert.equal(parseInvite({ 0: 1, 1: 'Alt', 2: 'OurGuild', 3: 1, 4: 2, 5: 1, 6: 5 }, 'x').partner.guild, 'OurGuild')
})

// ── the record ───────────────────────────────────────────────────────────────

test('the record is v1 exactly, and nothing of the crafters, object ids or durability reaches it', () => {
  const { m } = machine()

  m.zoneChanged('2218')
  invite(m, 1766, 'self', 'Partner7')
  feedUpdate(m, update(1766, 3, { gave: [{ index: 570, qty: 11, quality: 1 }], silverGot: 50000 }))
  m.accepted({ tradeId: 1766, revision: 3 })

  const record = buildRecord(m.finished(1766), { at: '2026-09-21T18:14:36.986Z', server: 'europe', self: ME, item })

  assert.deepEqual(record, {
    v: 1,
    t: 'trade',
    at: '2026-09-21T18:14:36.986Z',
    server: 'europe',
    zone: '2218',
    tradeId: 1766,
    initiator: 'self',
    self: { name: 'Me', guild: 'OurGuild', alliance: 'OurAlliance' },
    partner: { name: 'Partner7', guild: 'OurGuild', hidden: false },
    revision: 3,
    acceptedRevision: 3,
    complete: true,
    gave: [{ index: 570, item: 'T7_POTION_REVIVE', qty: 11, quality: 1 }],
    got: [],
    silverGave: 0,
    silverGot: 5
  })
  assert.deepEqual(Object.keys(record), ['v', 't', 'at', 'server', 'zone', 'tradeId', 'initiator', 'self', 'partner', 'revision', 'acceptedRevision', 'complete', 'gave', 'got', 'silverGave', 'silverGot'])

  const text = JSON.stringify(record)

  assert.doesNotMatch(text, /SomeCrafter|OtherCrafter|9854|5000|643240000/)
})

test('a silver-only trade is still a record (the member\'s own journal; the app decides uploads)', () => {
  const { m } = machine()

  invite(m, 295, 'self', 'Partner1')
  feedUpdate(m, update(295, 10, { silverGave: 600000000000 }))

  const record = buildRecord(m.finished(295), { at: '2026-09-16T15:25:52.210Z', self: ME, item })

  assert.deepEqual([record.gave, record.got, record.silverGave, record.silverGot, record.server], [[], [], 60000000, 0, null])
})

test('an unknown item keeps its index and says UNKNOWN', () => {
  const { m } = machine()

  invite(m, 5)
  feedUpdate(m, update(5, 3, { got: [{ index: 99999, qty: 1, quality: 2 }] }))

  assert.deepEqual(buildRecord(m.finished(5), { at: 'x', self: ME, item }).got, [{ index: 99999, item: 'UNKNOWN_99999', qty: 1, quality: 2 }])
})

test('the console line reads like the loot line', () => {
  const base = { at: '2026-09-21T18:14:36.986Z', complete: true, gave: [], got: [], silverGave: 0, silverGot: 0 }
  const say = (fields) => describeTrade({ ...base, ...fields }, { selfName: 'Me', partnerName: 'Partner7', itemName: (i) => item(i).itemName })

  assert.equal(say({ gave: [{ index: 570, qty: 11 }] }), '18:14:36 UTC: Me traded 11x Major Gigantify Potion to Partner7.')
  assert.equal(
    say({ gave: [{ index: 9484, qty: 4 }, { index: 9484, qty: 5 }], silverGot: 5000000 }),
    "18:14:36 UTC: Me traded 4x Elder's Spiked Gauntlets, 5x Elder's Spiked Gauntlets to Partner7 for 5,000,000 silver."
  )
  assert.equal(say({ silverGave: 60000000 }), '18:14:36 UTC: Me traded 60,000,000 silver to Partner7.')
  assert.equal(say({ got: [{ index: 570, qty: 2 }] }), '18:14:36 UTC: Me received 2x Major Gigantify Potion from Partner7.')
  assert.match(say({ complete: false, silverGave: 1 }), /\(incomplete: /)
})

// ── the file ─────────────────────────────────────────────────────────────────

test('the trade file sits beside the loot log, named after it, and only when TRADE_EVENTS=1', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trades-'))
  const lootFile = path.join(dir, 'loot-events-2026-10-05-17-43-51.txt')

  assert.equal(tradeFileFor(lootFile), path.join(dir, 'trade-events-2026-10-05-17-43-51.jsonl'))

  const off = new TradeLog({ enabled: false, lootFile: () => lootFile })

  assert.equal(off.write({ v: 1 }), false)
  assert.equal(fs.existsSync(tradeFileFor(lootFile)), false)

  const on = new TradeLog({ enabled: true, lootFile: () => lootFile })

  on.write({ v: 1, t: 'trade' })
  await new Promise((resolve) => on.close(resolve))

  assert.equal(fs.readFileSync(tradeFileFor(lootFile), 'utf8'), '{"v":1,"t":"trade"}\n')
})

// ── through the dispatcher ───────────────────────────────────────────────────

const wired = (t) => {
  const mods = fresh()
  const clock = useFakeClock(t, Date.parse('2026-09-21T18:14:27.000Z'))
  const DataHandler = require('../src/data-handler/data-handler')
  const ParseHealth = require('../src/storage/parse-health')
  const Trades = require('../src/trades')
  const printed = []
  const written = []

  mods.Logger.warn = () => {}
  mods.Logger.error = () => {}
  mods.Logger.debug = () => {}
  Trades.print = (line) => printed.push(line)
  Trades.log.enabled = true
  Trades.log.write = (record) => written.push(record)

  const event = (code, parameters) => DataHandler.handleEventData({ parameters: { ...parameters, 252: code } })
  const response = (code, parameters, returnCode = 0) => DataHandler.handleResponseData({ returnCode, parameters: { ...parameters, 253: code } })
  const request = (code, parameters) => DataHandler.handleRequestData({ parameters: { ...parameters, 253: code } })

  return { ...mods, clock, Trades, ParseHealth, printed, written, event, response, request }
}

test('dispatcher: a whole trade, from our invite to the finish, is one record and one console line', (t) => {
  const s = wired(t)

  s.response(2, { ...joinEvent('Me').parameters, 8: '2218' })
  s.response(161, { 0: 212112, 1: 'Partner7', 2: 'OurGuild', 3: 29, 4: 3, 6: 1766 })
  s.event(181, { 0: 1766 })
  s.event(179, update(1766, 2))
  s.event(179, update(1766, 3, { gave: [{ index: 570, qty: 11, quality: 1 }] }))
  s.request(166, { 0: 1766, 1: 3, 2: true })
  s.clock.advance(9_000)
  s.event(180, { 0: 1766 })

  assert.equal(s.written.length, 1)
  assert.equal(s.written[0].tradeId, 1766)
  assert.equal(s.written[0].at, '2026-09-21T18:14:36.000Z')
  assert.deepEqual(s.written[0].self, { name: 'Me', guild: 'VITRYLA', alliance: null })
  assert.equal(s.written[0].zone, '2218')
  assert.equal(s.written[0].gave[0].item, 'UNKNOWN_570') // no current item table in a test
  // eslint-disable-next-line no-control-regex
  assert.equal(s.printed[0].replace(/\x1b\[[0-9;]*m/g, ''), '18:14:36 UTC: [VITRYLA] Me traded 11x Unknown Item (570) to [OurGuild] Partner7.')
  assert.equal(s.ParseHealth.statusLine(), '[health] parse ok')
})

test('dispatcher: a refused invitation (non-zero return code) opens nothing', (t) => {
  const s = wired(t)

  s.response(161, {}, 1)
  s.response(161, { 0: 1, 1: 'Partner1', 6: 68 }, 1)

  assert.equal(s.Trades.machine.size(), 0)
  assert.equal(s.ParseHealth.statusLine(), '[health] parse ok')
})

test('dispatcher: a zone join drops the trade in progress; a masked character hides the next partner', (t) => {
  const s = wired(t)

  s.event(176, { 0: 72809, 1: 'Partner2', 2: 'OurGuild', 3: 19, 4: 2, 6: 1250 })
  s.event(179, update(1250, 3, { got: [{ index: 2587, qty: 1, quality: 4 }] }))
  s.response(2, { ...joinEvent('Me').parameters, 8: 'SOMEWHERE_MASKED' })
  s.event(180, { 0: 1250 })

  assert.deepEqual(s.written, [])

  s.event(29, { 0: 4242, 1: 'PA' }) // EvNewCharacter: the game hides this player
  s.event(176, { 0: 4242, 1: 'PA', 6: 1251 })
  s.event(179, update(1251, 3, { got: [{ index: 570, qty: 2, quality: 1 }] }))
  s.event(180, { 0: 1251 })

  assert.deepEqual(s.written[0].partner, { name: null, guild: null, hidden: true })
  assert.match(s.printed[0], /received 2x Unknown Item \(570\) from a hidden player\.$/)
})

test('dispatcher: a PA looter (EvOtherGrabbedLoot) masks the zone too — the second signal', (t) => {
  const s = wired(t)

  s.response(2, { ...joinEvent('Me').parameters, 8: 'SOMEWHERE_MASKED' })
  s.event(279, { 2: 'PA', 3: true, 5: 120 }) // a hidden player picked up silver: no loot line, the mask is enough
  s.event(176, { 0: 4242, 1: 'RealName', 2: 'OurGuild', 6: 1252 })
  s.event(179, update(1252, 3, { got: [{ index: 570, qty: 2, quality: 1 }] }))
  s.event(180, { 0: 1252 })

  assert.deepEqual(s.written[0].partner, { name: null, guild: null, hidden: true })
  assert.equal(s.ParseHealth.statusLine(), '[health] parse ok')
})

test('dispatcher: a moved field shows in the [health] line, by the trade handler\'s name', (t) => {
  const s = wired(t)

  for (let i = 0; i < 5; i += 1) {
    s.event(179, { 0: 1766 }) // a finish's bare payload under the update's code: a renumbering
    s.clock.advance(1_000)
  }

  assert.equal(s.ParseHealth.statusLine(), '[health] parse broken: EvPlayerTradeUpdate 5/5 (last 10 min)')
  assert.deepEqual(s.written, [])
})
