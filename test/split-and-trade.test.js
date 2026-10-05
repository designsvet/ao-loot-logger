const test = require('node:test')
const assert = require('node:assert')

const { fresh, useFakeClock } = require('./helpers')

// Every re-require of loot-logger registers a process exit handler.
process.setMaxListeners(50)

/**
 * A stack split and a player trade are not loot (2026-10-05).
 *
 * Inside the chest window every ownerless put is written as a pickup from the chest that named
 * itself last, and only a deposit or a move out of one of your own containers was excused. A
 * split is neither: your own request 33 (InventorySplitStack) is answered by a NEW object and a
 * put of it into the same container, with no move request at all. Nor is an item a trade hands
 * you, which arrives with no request of yours.
 *
 * Replayed from guild-dump-2026-09-21T11-33-47.jsonl, zone 2218, trade 1766: obj 212301 ×20
 * (L52978) is split by request 33 into ×9 and a new obj 212924 ×11 (L54461, L54470-54472), which
 * is then offered and handed over. Records are verbatim, dispatched as the engine receives them,
 * except: the join is trimmed to the parameters the engine reads, minus the alliance tag; the
 * trade's request and response 161 (the partner's name) and the requests 164/166 are left out,
 * since nothing handles them. The chest is NOT from that recording — no chest named itself in
 * zone 2218 — it is the trigger being tested: a boss chest named 30 seconds before.
 */

const INVENTORY = [123, 94, 2, 136, 197, 91, 246, 64, 170, 171, 157, 33, 49, 175, 136, 206]

const JOIN = {
  at: '2026-09-21T18:13:27.291Z',
  kind: 'response',
  payload: {
    0: 212292,
    1: [5, 90, 8, 3, 248, 123, 32, 70, 172, 175, 13, 183, 75, 145, 163, 223],
    2: 'Bors',
    8: '2218',
    51: [27, 71, 39, 120, 43, 7, 27, 74, 181, 17, 15, 78, 207, 75, 150, 142],
    54: INVENTORY,
    56: [228, 231, 114, 118, 37, 191, 228, 70, 188, 251, 239, 178, 51, 123, 202, 45],
    58: 'VITRYLA',
    80: [226, 250, 195, 112, 165, 173, 48, 77, 150, 220, 152, 14, 218, 239, 16, 209],
    253: 2
  }
}

/** L52978: the stack before the split. It arrives just ahead of the join, as a new map's objects do. */
const STACK = { at: '2026-09-21T18:13:27.291Z', kind: 'event', payload: { 0: 212301, 1: 570, 2: 20, 4: 108451663, 252: 32 } }

/** Not from the recording: a boss chest naming itself in the same zone, 30 s before the split. */
const CHEST = { at: '2026-09-21T18:14:01.451Z', kind: 'event', payload: { 0: 212500, 3: '@CHEST_BOSS_TEST', 252: 393 } }

/** L54461-54472: request 33 splits 11 off, the old stack drops to 9, the new one is put into the inventory. */
const SPLIT = [
  { at: '2026-09-21T18:14:31.451Z', kind: 'request', payload: { 1: INVENTORY, 2: 2, 3: 11, 253: 33 } },
  { at: '2026-09-21T18:14:31.520Z', kind: 'event', payload: { 0: 212301, 1: 570, 2: 9, 4: 108451663, 252: 32 } },
  { at: '2026-09-21T18:14:31.520Z', kind: 'event', payload: { 0: 212924, 1: 570, 2: 11, 4: 108451663, 252: 32 } },
  { at: '2026-09-21T18:14:31.520Z', kind: 'event', payload: { 0: 212924, 1: 1, 2: INVENTORY, 3: 2, 252: 26 } }
]

const EMPTY_SIDE = { 17: [], 18: [], 19: [], 20: [], 21: [], 22: [], 23: [[-1]], 24: [[-1]], 25: [], 26: [] }

/** L54445-54446: the trade opens, both sides empty (revision 2). */
const TRADE_OPENS = [
  { at: '2026-09-21T18:14:30.689Z', kind: 'event', payload: { 0: 1766, 252: 181 } },
  {
    at: '2026-09-21T18:14:30.689Z',
    kind: 'event',
    payload: { 0: 1766, 1: 2, 6: [], 7: [], 8: [], 9: [], 10: [], 11: [], 12: [], 13: [[-1]], 14: [[-1]], 15: [], 16: [], ...EMPTY_SIDE, 252: 179 }
  }
]

/** L54489-54564: the new stack is offered (revision 3), both accept, and it is handed over. */
const TRADE_FINISHES = [
  { at: '2026-09-21T18:14:32.564Z', kind: 'event', payload: { 0: 212924, 1: 570, 2: 11, 3: true, 4: 108451663, 252: 32 } },
  { at: '2026-09-21T18:14:32.564Z', kind: 'event', payload: { 0: 1766, 252: 181 } },
  {
    at: '2026-09-21T18:14:32.564Z',
    kind: 'event',
    payload: { 0: 1766, 1: 3, 6: [212924], 7: [0], 8: [570], 9: [''], 10: [1], 11: [0], 12: [0], 13: [[]], 14: [[]], 15: [11], 16: [''], ...EMPTY_SIDE, 252: 179 }
  },
  { at: '2026-09-21T18:14:36.063Z', kind: 'event', payload: { 0: 1766, 1: true, 252: 181 } },
  { at: '2026-09-21T18:14:36.985Z', kind: 'event', payload: { 0: 212924, 1: 570, 2: 11, 4: 108451663, 252: 32 } },
  { at: '2026-09-21T18:14:36.986Z', kind: 'event', payload: { 0: 212924, 252: 27 } },
  { at: '2026-09-21T18:14:36.986Z', kind: 'event', payload: { 0: 1766, 252: 180 } }
]

const session = (t) => {
  const mods = fresh()
  const DataHandler = require('../src/data-handler/data-handler')
  const written = []

  mods.LootLogger.write = (row) => written.push(row)
  mods.Logger.debug = () => {}
  mods.Logger.warn = () => {}
  mods.Logger.error = () => {}
  delete process.env.LOG_UNKNOWN_SOURCE

  return { ...mods, DataHandler, written, clock: useFakeClock(t), last: null }
}

/** Feed records to the dispatcher in order, the fake clock following their timestamps. */
const replay = (s, records) => {
  for (const record of records) {
    const at = Date.parse(record.at)

    s.clock.advance(s.last == null ? 0 : at - s.last)
    s.last = at

    const event = { parameters: record.payload }

    if (record.kind === 'event') s.DataHandler.handleEventData(event)
    if (record.kind === 'request') s.DataHandler.handleRequestData(event)
    if (record.kind === 'response') s.DataHandler.handleResponseData(event)
  }
}

/** An event as the dispatcher receives it, for the sequences no recording holds. */
const event = (s, payload) => s.DataHandler.handleEventData({ parameters: payload })

test('the 2026-09-21 split, replayed with a chest in the window, writes nothing', (t) => {
  const s = session(t)

  replay(s, [STACK, JOIN, CHEST, ...SPLIT])

  assert.deepEqual(s.written, [], 'the new stack from your own split is not chest loot')
})

test('trade 1766, replayed whole with a chest in the window, writes nothing', (t) => {
  const s = session(t)

  replay(s, [STACK, JOIN, CHEST, ...TRADE_OPENS, ...SPLIT, ...TRADE_FINISHES])

  assert.deepEqual(s.written, [])
})

test('a split explains its own put, not the next one', (t) => {
  const s = session(t)

  replay(s, [STACK, JOIN, CHEST, ...SPLIT])

  // A take-all right after: no request of its own, so the split must already be spent.
  s.clock.advance(300)
  event(s, { 0: 212950, 1: 2587, 2: 1, 252: 32 })
  event(s, { 0: 212950, 1: 2, 2: INVENTORY, 252: 26 })

  assert.equal(s.written.length, 1)
  assert.equal(s.written[0].quantity, 1)
  assert.equal(s.written[0].lootedFrom.playerName, '@CHEST_BOSS_TEST')
})

test('a split request that does not carry a container is a parse failure', (t) => {
  const s = session(t)

  assert.throws(() => s.OpInventorySplitStack.handle({ parameters: { 2: 2, 3: 11, 253: 33 } }), /encodedUuid/)
})

// --- The receiving side of a trade ------------------------------------------------------------
//
// No recorded trade handed us an item, so this side is built, not replayed: the updates follow
// trade 1250 (2026-09-16), the one where the partner offered items, with the crafter names
// blanked; the hand-over mirrors the giving side of 1766 — new objects in the same millisecond
// as Finished — plus the put into the inventory that the giving side never sends.

const TRADE = 1250

const update = (revision, partner = EMPTY_SIDE) => ({
  0: TRADE, 1: revision, 6: [], 7: [], 8: [], 9: [], 10: [], 11: [], 12: [], 13: [[-1]], 14: [[-1]], 15: [], 16: [], ...partner, 252: 179
})

const OFFERED = { 17: [0], 18: [2587], 19: [''], 20: [4], 21: [25669549], 22: [0], 23: [[]], 24: [[205]], 25: [1], 26: [''] }

/** A chest named in this zone, then a trade the partner fills and both accept. */
const tradeUpToAcceptance = (s) => {
  replay(s, [STACK, JOIN, CHEST])

  event(s, { 0: TRADE, 252: 181 })
  event(s, update(2))
  s.clock.advance(800)
  event(s, { 0: TRADE, 252: 181 })
  event(s, update(3, OFFERED))
  s.clock.advance(4_000)
  event(s, { 0: TRADE, 2: true, 252: 181 })
  s.clock.advance(1_500)
}

const RECEIVED = { 0: 212960, 1: 2587, 2: 1, 252: 32 }
const RECEIVED_PUT = { 0: 212960, 1: 3, 2: INVENTORY, 252: 26 }

test('what a trade hands you, put before Finished, is not chest loot', (t) => {
  const s = session(t)

  tradeUpToAcceptance(s)
  event(s, RECEIVED)
  event(s, RECEIVED_PUT)
  event(s, { 0: TRADE, 252: 180 })

  assert.deepEqual(s.written, [])
})

test('what a trade hands you, put just after Finished, is not chest loot', (t) => {
  const s = session(t)

  tradeUpToAcceptance(s)
  event(s, { 0: TRADE, 252: 180 })
  event(s, RECEIVED)
  s.clock.advance(50)
  event(s, RECEIVED_PUT)

  assert.deepEqual(s.written, [])
})

test('a pickup after the trade is over is loot again', (t) => {
  const s = session(t)

  tradeUpToAcceptance(s)
  event(s, { 0: TRADE, 252: 180 })
  s.clock.advance(s.TradeWindow.GRACE_MS + 1)
  event(s, RECEIVED)
  event(s, RECEIVED_PUT)

  assert.equal(s.written.length, 1)
  assert.equal(s.written[0].lootedFrom.playerName, '@CHEST_BOSS_TEST')
})

test('a cancelled trade ends it the same way', (t) => {
  const s = session(t)

  tradeUpToAcceptance(s)
  event(s, { 0: TRADE, 252: 178 })
  s.clock.advance(s.TradeWindow.GRACE_MS + 1)
  event(s, RECEIVED)
  event(s, RECEIVED_PUT)

  assert.equal(s.written.length, 1)
})

test('a trade whose end never arrived stops counting once idle', (t) => {
  const s = session(t)

  replay(s, [STACK, JOIN])
  event(s, update(2))
  s.clock.advance(s.TradeWindow.IDLE_MS + 1)

  // The chest names itself after the trade went quiet, so only the trade could excuse the put.
  event(s, CHEST.payload)
  event(s, RECEIVED)
  event(s, RECEIVED_PUT)

  assert.equal(s.written.length, 1)
})

test('a zone change ends a trade outright', (t) => {
  const s = session(t)

  replay(s, [STACK, JOIN])
  event(s, update(2))
  s.DataHandler.handleResponseData({ parameters: JOIN.payload })
  event(s, CHEST.payload)
  event(s, RECEIVED)
  event(s, RECEIVED_PUT)

  assert.equal(s.written.length, 1)
})

test('an end for a trade that is not open excuses nothing', (t) => {
  const s = session(t)

  // App started after the trade's last update, or a renumbered code now meaning something else.
  replay(s, [STACK, JOIN, CHEST])
  event(s, { 0: 4242, 252: 180 })
  event(s, RECEIVED)
  event(s, RECEIVED_PUT)

  assert.equal(s.written.length, 1)
})

test('an update without its item arrays opens no trade, and fails the parse', (t) => {
  const s = session(t)

  assert.throws(() => s.EvPlayerTrade.handle({ parameters: { 0: TRADE, 1: 2, 252: 179 } }), /item parameters/)
  assert.equal(s.TradeWindow.isLive(), false)
})
