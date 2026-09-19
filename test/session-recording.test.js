const test = require('node:test')
const assert = require('node:assert')

const { fresh, useFakeClock } = require('./helpers')

// The session recording is the 120-second window with the clock taken out and the
// Move stream left out. Three things are worth pinning: it does not close by
// itself (a recording that stops at two minutes is the bug the mode exists to
// fix), it declines a packet with no code (half of all traffic, all of it
// presence), and the bounded window is untouched — the guild-screen
// investigation still gets every packet for its two minutes.

test('a session recording stays open past the bounded window', (t) => {
  const { DumpWindow } = fresh()
  const clock = useFakeClock(t)

  DumpWindow.armSession()
  assert.equal(DumpWindow.isSession(), true)
  assert.equal(DumpWindow.shouldDump(82), true)

  clock.advance(DumpWindow.WINDOW_MS * 30)
  assert.equal(DumpWindow.isOpen(), true)
  assert.equal(DumpWindow.shouldDump(62), true)
  assert.equal(DumpWindow.written(), 2)

  DumpWindow.disarm()
  assert.equal(DumpWindow.isOpen(), false)
  assert.equal(DumpWindow.isSession(), false)
  assert.equal(DumpWindow.shouldDump(82), false)
})

test('a session recording declines a packet with no code, and spends no budget on it', (t) => {
  const { DumpWindow } = fresh()
  useFakeClock(t)

  DumpWindow.armSession()

  assert.equal(DumpWindow.shouldDump(undefined), false)
  assert.equal(DumpWindow.shouldDump(null), false)
  assert.equal(DumpWindow.written(), 0)

  assert.equal(DumpWindow.shouldDump(6), true)
  assert.equal(DumpWindow.written(), 1)
})

test('the bounded window still takes a packet with no code', (t) => {
  const { DumpWindow } = fresh()
  useFakeClock(t)

  DumpWindow.arm()

  assert.equal(DumpWindow.shouldDump(undefined), true)
  assert.equal(DumpWindow.written(), 1)
})

test('DUMP_PACKETS=session arms the recording at load, for a child with no keyboard', (t) => {
  const before = process.env.DUMP_PACKETS

  process.env.DUMP_PACKETS = 'session'
  t.after(() => {
    if (before === undefined) {
      delete process.env.DUMP_PACKETS
    } else {
      process.env.DUMP_PACKETS = before
    }
  })

  const { DumpWindow } = fresh()

  assert.equal(DumpWindow.isSession(), true)
  assert.equal(DumpWindow.isOpen(), true)
})

test('arming the bounded window ends a session recording rather than extending it', (t) => {
  const { DumpWindow } = fresh()
  const clock = useFakeClock(t)

  DumpWindow.armSession()
  DumpWindow.arm()

  assert.equal(DumpWindow.isSession(), false)

  clock.advance(DumpWindow.WINDOW_MS + 1)
  assert.equal(DumpWindow.isOpen(), false)
})

test('closing a dump that never opened calls back at once', () => {
  const { PacketDump } = fresh()
  let called = 0

  PacketDump.close(() => {
    called += 1
  })

  assert.equal(called, 1)
  assert.equal(PacketDump.currentFileName(), null)
})

test('a response keeps its return code and debug message; other records carry neither', () => {
  const { PacketDump } = fresh()
  const { recordLine } = PacketDump.__test
  const at = '2026-09-18T14:37:22.748Z'

  const reply = JSON.parse(recordLine('response', 315, { 253: 315 }, { returnCode: 0, debugMessage: '' }, at))
  const refused = JSON.parse(recordLine('response', 79, { 253: 79 }, { returnCode: 1, debugMessage: 'not enough silver' }, at))
  const event = JSON.parse(recordLine('event', 82, { 1: 13148746629585n, 252: 82 }, {}, at))

  assert.equal(reply.rc, 0) // a zero is a real answer, not an absence
  assert.equal('dm' in reply, false)
  assert.equal(refused.rc, 1)
  assert.equal(refused.dm, 'not enough silver')
  assert.equal('rc' in event, false)
  assert.equal(event.payload['1'], 'bigint:13148746629585')
})
