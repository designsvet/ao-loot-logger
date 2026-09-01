const test = require('node:test')
const assert = require('node:assert')

const { fresh, useFakeClock } = require('./helpers')

// The guild-screen instrument. Two things are worth pinning: the window really
// closes (an instrument that never stops is one nobody arms), and the serializer
// survives what protocol18 actually hands it — a BigInt reaches JSON.stringify as
// a throw, and it would throw on the one packet the whole exercise is for.

test('the window opens, spends its budget, and closes on its own', (t) => {
  const { DumpWindow } = fresh()
  const clock = useFakeClock(t)

  assert.equal(DumpWindow.isOpen(), false)
  assert.equal(DumpWindow.shouldDump(), false)

  DumpWindow.arm()
  assert.equal(DumpWindow.shouldDump(), true)
  assert.equal(DumpWindow.written(), 1)

  clock.advance(DumpWindow.WINDOW_MS + 1)
  assert.equal(DumpWindow.isOpen(), false)
  assert.equal(DumpWindow.shouldDump(), false)
})

test('re-arming gives a fresh budget', (t) => {
  const { DumpWindow } = fresh()
  const clock = useFakeClock(t)

  DumpWindow.arm()

  for (let i = 0; i < DumpWindow.MAX_RECORDS; i += 1) {
    DumpWindow.shouldDump()
  }

  assert.equal(DumpWindow.shouldDump(), false) // budget spent, window still open

  clock.advance(1000)
  DumpWindow.arm()
  assert.equal(DumpWindow.shouldDump(), true)
})

test('disarm shuts it immediately', (t) => {
  const { DumpWindow } = fresh()
  useFakeClock(t)

  DumpWindow.arm()
  DumpWindow.disarm()

  assert.equal(DumpWindow.shouldDump(), false)
})

test('a payload survives JSON, BigInts and Buffers included', () => {
  const { plain } = require('../src/utils/packet-dump').__test

  const payload = plain({
    0: 12345678901234567890n,
    1: 'VITRYLA',
    2: [1, 2, 3],
    3: Buffer.from([1, 2, 3, 4]),
    4: { nested: 9n }
  })

  // The assertion that matters: this line throws today without the serializer.
  const json = JSON.stringify(payload)

  assert.match(json, /bigint:12345678901234567890/)
  assert.match(json, /bigint:9/)
  assert.deepEqual(payload[2], [1, 2, 3])
  assert.equal(payload[3]._buffer, 4)
})

test('a long array is truncated but says how long it really was', () => {
  const { plain } = require('../src/utils/packet-dump').__test

  const rows = new Array(5000).fill(0).map((_, i) => i)
  const out = plain({ 0: rows })[0]

  assert.equal(out._array, 5000)
  assert.equal(out.items.length, out.truncatedTo)
})

test('a highlight is found anywhere in the payload, at any depth', () => {
  const { matchesHighlight } = require('../src/utils/packet-dump').__test

  const hit = matchesHighlight({ 0: { rows: [{ amount: 1291 }] } }, new Set(['1291']))

  assert.equal(hit, '1291')
  assert.equal(matchesHighlight({ 0: 7 }, new Set(['1291'])), null)
  assert.equal(matchesHighlight({ 0: 7 }, new Set()), null)
})
