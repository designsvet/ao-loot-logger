const test = require('node:test')
const assert = require('node:assert')

const { fresh, useFakeClock, attachEvent } = require('./helpers')

// Every re-require of loot-logger registers a process exit handler.
process.setMaxListeners(50)

const session = (t) => {
  const mods = fresh()
  const clock = useFakeClock(t)
  const ParseHealth = require('../src/storage/parse-health')
  const DataHandler = require('../src/data-handler/data-handler')
  const Config = require('../src/config')

  // The dispatcher logs every throw; keep the test output readable.
  mods.Logger.warn = () => {}
  mods.Logger.error = () => {}

  return { ...mods, clock, ParseHealth, DataHandler, Config }
}

/** A container attach as the dispatcher receives it, event code included. */
const attach = (s, parameters) => s.DataHandler.handleEventData({ parameters: { ...parameters, 252: s.Config.events.EvAttachItemContainer } })

/** An attach with no GUID: what a moved field looks like to the parser. */
const brokenAttach = (s) => attach(s, { 0: 76, 3: [] })

test('a handler failing on every call is broken', (t) => {
  const s = session(t)

  for (let i = 0; i < 5; i++) {
    brokenAttach(s)
    s.clock.advance(3_000)
  }

  assert.deepEqual(s.ParseHealth.broken(), [{ name: 'EvAttachItemContainer', failures: 5, calls: 5 }])
  assert.equal(s.ParseHealth.statusLine(), '[health] parse broken: EvAttachItemContainer 5/5 (last 10 min)')
})

test('the 2026-09-21 silver grabs — 9 failures in 1,204 calls — are not a broken handler', (t) => {
  const s = session(t)

  for (let i = 0; i < 1204; i++) {
    s.ParseHealth.call('EvOtherGrabbedLoot')
  }

  for (let i = 0; i < 9; i++) {
    s.ParseHealth.failure('EvOtherGrabbedLoot')
  }

  assert.deepEqual(s.ParseHealth.broken(), [])
  assert.equal(s.ParseHealth.statusLine(), '[health] parse ok')
})

test('fewer failures than the minimum are not enough, even at 100%', (t) => {
  const s = session(t)

  for (let i = 0; i < s.ParseHealth.MIN_FAILURES - 1; i++) {
    brokenAttach(s)
  }

  assert.deepEqual(s.ParseHealth.broken(), [])
})

test('failures on fewer than half the calls are not a broken handler', (t) => {
  const s = session(t)

  for (let i = 0; i < 6; i++) {
    brokenAttach(s)
  }

  for (let i = 0; i < 7; i++) {
    attach(s, attachEvent(76).parameters)
  }

  // 6 failures, 13 calls through the dispatcher: under half.
  assert.deepEqual(s.ParseHealth.broken(), [])
})

test('failures older than the window stop counting', (t) => {
  const s = session(t)

  for (let i = 0; i < 5; i++) {
    brokenAttach(s)
  }

  assert.equal(s.ParseHealth.broken().length, 1)

  s.clock.advance(s.ParseHealth.WINDOW_MS + 60_000)

  assert.deepEqual(s.ParseHealth.broken(), [])
  assert.equal(s.ParseHealth.statusLine(), '[health] parse ok')
})

test('a healthy attach counts as a call and nothing else', (t) => {
  const s = session(t)

  attach(s, attachEvent(76).parameters)

  assert.deepEqual(s.ParseHealth.broken(), [])
})

test('the dispatcher still logs and swallows the throw, exactly as before', (t) => {
  const s = session(t)
  const warned = []

  s.Logger.warn = (error) => warned.push(error)

  assert.doesNotThrow(() => brokenAttach(s))
  assert.equal(warned.length, 1)
  assert.match(String(warned[0].message), /EvAttachItemContainer has invalid uuid parameter/)
})

test('several broken handlers are listed by name', (t) => {
  const s = session(t)

  for (let i = 0; i < 5; i++) {
    s.ParseHealth.call('OpJoin')
    s.ParseHealth.failure('OpJoin')
    brokenAttach(s)
  }

  assert.equal(
    s.ParseHealth.statusLine(),
    '[health] parse broken: EvAttachItemContainer 5/5, OpJoin 5/5 (last 10 min)'
  )
})
