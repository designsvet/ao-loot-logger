const test = require('node:test')
const assert = require('node:assert')

const { ReliableWindow } = require('../src/network/photon/reliable-window')
const PhotonParser = require('../src/network/photon/photon-parser')
const packets = require('../test-fixtures-packets.json')

// A resent reliable command carries the number of the one it repeats, and nothing else can tell
// the two apart — a genuine second event may be byte-identical too. These pin the number rule and
// the key it hangs on: connection AND direction, because both directions count from 1.

const UP = '10.0.0.2:53001>5.188.125.40:5056'
const DOWN = '5.188.125.40:5056>10.0.0.2:53001'

test('a repeat on the same connection and channel is dropped, and counted', () => {
  const w = new ReliableWindow()

  assert.equal(w.isRepeat(DOWN, 0, 469), false)
  assert.equal(w.isRepeat(DOWN, 0, 470), false)
  assert.equal(w.isRepeat(DOWN, 0, 469), true)
  assert.equal(w.dropped, 1)
})

test('the same number on another channel, direction or connection is a different command', () => {
  const w = new ReliableWindow()

  w.isRepeat(DOWN, 0, 469)

  assert.equal(w.isRepeat(DOWN, 1, 469), false)
  assert.equal(w.isRepeat(UP, 0, 469), false)
  assert.equal(w.isRepeat('5.188.125.40:5056>10.0.0.2:53002', 0, 469), false)
  assert.equal(w.dropped, 0)
})

test('an unseen number below the top is a late arrival, delivered once', () => {
  const w = new ReliableWindow()

  w.isRepeat(DOWN, 0, 500)

  assert.equal(w.isRepeat(DOWN, 0, 498), false)
  assert.equal(w.isRepeat(DOWN, 0, 498), true)
})

test('a number far below the top is a connection that started over, not a repeat', () => {
  const w = new ReliableWindow(100)

  w.isRepeat(DOWN, 0, 5000)
  w.isRepeat(DOWN, 0, 1)

  assert.equal(w.isRepeat(DOWN, 0, 2), false)
  assert.equal(w.isRepeat(DOWN, 0, 1), true)
})

test('a session command resets BOTH directions, so a reconnect on the same ports keeps its first commands', () => {
  const w = new ReliableWindow()

  w.isRepeat(DOWN, 0, 1)
  w.isRepeat(UP, 0, 1)
  w.reset(UP, DOWN)

  assert.equal(w.isRepeat(DOWN, 0, 1), false)
  assert.equal(w.isRepeat(UP, 0, 1), false)
})

test('no connection, no deduplication — the fixture replays stay exactly as they were', () => {
  const w = new ReliableWindow()

  assert.equal(w.isRepeat(null, 0, 469), false)
  assert.equal(w.isRepeat(null, 0, 469), false)
  assert.equal(w.dropped, 0)
})

test('the window stays bounded over a long session', () => {
  const w = new ReliableWindow(50)

  for (let seq = 1; seq <= 10_000; seq += 1) {
    w.isRepeat(DOWN, 0, seq)
  }

  const state = w.channels.get(`${DOWN}#0`)

  assert.ok(state.seen.size <= 101, `seen holds ${state.seen.size}`)
  assert.equal(w.isRepeat(DOWN, 0, 9_999), true)
})

// ── through the real parser, with a real packet ──────────────────────────────────

const eventsFrom = (feed) => {
  const parser = new PhotonParser()
  const seen = []

  parser.on('event-data', (event) => {
    if (event?.parameters?.[252] != null) {
      seen.push(event.parameters[252])
    }
  })

  feed(parser)

  return { seen, parser }
}

// Fixture packet 0: one SEND_RELIABLE command, channel 0, sequence 469, carrying event 90.
const ONE_EVENT = Buffer.from(packets[0], 'hex')

test('the parser decodes a resent packet once when it knows the connection', () => {
  const { seen, parser } = eventsFrom((p) => {
    p.handlePhotonPacket(ONE_EVENT, DOWN, UP)
    p.handlePhotonPacket(ONE_EVENT, DOWN, UP)
  })

  assert.deepEqual(seen, [90])
  assert.equal(parser.retransmitsDropped, 1)
})

test('the parser decodes the same bytes twice when they arrive on two connections', () => {
  const { seen } = eventsFrom((p) => {
    p.handlePhotonPacket(ONE_EVENT, DOWN, UP)
    p.handlePhotonPacket(ONE_EVENT, '5.188.125.40:5056>10.0.0.2:53002', '10.0.0.2:53002>5.188.125.40:5056')
  })

  assert.deepEqual(seen, [90, 90])
})

test('without a connection the parser behaves exactly as before', () => {
  const { seen, parser } = eventsFrom((p) => {
    p.handlePhotonPacket(ONE_EVENT)
    p.handlePhotonPacket(ONE_EVENT)
  })

  assert.deepEqual(seen, [90, 90])
  assert.equal(parser.retransmitsDropped, 0)
})

test('the whole fixture replays to the same 3,458 events with or without the dedupe wired', () => {
  // The fixture carries no connection, so this pins that the new code path changes nothing for it.
  const count = (withConnection) => {
    const parser = new PhotonParser()
    let n = 0

    parser.on('event-data', () => {
      n += 1
    })

    for (const hex of packets) {
      try {
        parser.handlePhotonPacket(Buffer.from(hex, 'hex'), withConnection ? null : undefined)
      } catch {
        // the fixture holds three malformed packets; the live engine catches them the same way
      }
    }

    return n
  }

  assert.equal(count(false), 3458)
  assert.equal(count(true), 3458)
})
