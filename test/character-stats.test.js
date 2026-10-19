const test = require('node:test')
const assert = require('node:assert/strict')

const { fresh, useFakeClock } = require('./helpers')

process.setMaxListeners(50)

const session = (t) => {
  const mods = fresh()
  const clock = useFakeClock(t)
  const ParseHealth = require('../src/storage/parse-health')
  const DataHandler = require('../src/data-handler/data-handler')
  const warned = []

  mods.Logger.debug = () => {}
  mods.Logger.warn = (error) => warned.push(error)
  mods.Logger.error = (error) => warned.push(error)

  return { ...mods, clock, ParseHealth, DataHandler, warned }
}

/**
 * Anonymized SHAPES from debug-logs.txt, 2026-10-15T16:34:11.102Z/.142Z and
 * 16:36:46.879Z/.929Z, not a byte-exact packet fixture. The successful stats
 * messages were unhandled code 142; code 143 threw "invalid guildName". The
 * logger retains the consumed stats fields but prints history values as [Array].
 * Names, ids, profile and the illustrative history array contents below are
 * substituted. Unread stats fields and unrecoverable history contents are omitted.
 *
 * Use literal wire codes: deriving them from Config would let a wrong dispatch
 * table agree with its own fixture, which was the original blind spot.
 */
const stats = (patch = {}) => ({
  eventCode: 1,
  parameters: {
    0: 101,
    1: 'PlayerOne',
    2: 'Example Guild',
    3: 8,
    4: 'TAG',
    5: 'https://example.invalid/profile',
    252: 142,
    ...patch
  }
})

const history = (playerName = 'PlayerOne') => ({
  eventCode: 1,
  parameters: {
    0: 101,
    1: playerName,
    2: ['HistoryOpponent'],
    3: [123],
    4: [1],
    5: [1],
    6: [123456789],
    252: 143
  }
})

test('live code 142 adds the character and updates the same player record used for loot', (t) => {
  const s = session(t)

  s.DataHandler.handleEventData(stats())

  const player = s.MemoryStorage.players.getByName('PlayerOne')

  assert.deepEqual(player, {
    playerName: 'PlayerOne',
    guildName: 'Example Guild',
    allianceName: 'TAG'
  })

  // OpJoin/self pickups and nearby loot handlers retain this object reference.
  s.MemoryStorage.players.self = player
  s.DataHandler.handleEventData(stats({ 2: 'Changed Guild', 4: 'NEW' }))

  assert.equal(s.MemoryStorage.players.getByName('PlayerOne'), player)
  assert.equal(s.MemoryStorage.players.self.guildName, 'Changed Guild')
  assert.equal(s.MemoryStorage.players.self.allianceName, 'NEW')
  assert.deepEqual(s.warned, [])
  assert.equal(s.ParseHealth.statusLine(), '[health] parse ok')
})

test('live code 143 history arrays neither mutate players nor count as CharacterStats failures', (t) => {
  const s = session(t)
  const player = s.MemoryStorage.players.add({ playerName: 'PlayerOne', guildName: 'Kept Guild', allianceName: 'KEPT' })
  const before = structuredClone(s.MemoryStorage.players.players)
  const calls = []
  const recordCall = s.ParseHealth.call

  s.ParseHealth.call = (name) => {
    calls.push(name)
    recordCall(name)
  }

  // Eight history messages reproduce the screenshot's 8/8 triggering traffic.
  // A second name also proves that an unseen history cannot create a player.
  for (let i = 0; i < 8; i++) {
    s.DataHandler.handleEventData(history(i % 2 === 0 ? 'PlayerOne' : 'HistoryOnlyPlayer'))
  }

  assert.deepEqual(s.MemoryStorage.players.players, before)
  assert.equal(s.MemoryStorage.players.getByName('PlayerOne'), player)
  assert.equal(s.MemoryStorage.players.getByName('HistoryOnlyPlayer'), undefined)
  assert.deepEqual(calls, [])
  assert.deepEqual(s.warned, [])
  assert.deepEqual(s.ParseHealth.broken(), [])
})

test('malformed stats on real code 142 still fail closed and trip the unchanged health guard', (t) => {
  const s = session(t)
  const player = s.MemoryStorage.players.add({ playerName: 'PlayerOne', guildName: 'Kept Guild', allianceName: 'KEPT' })

  for (let i = 0; i < 5; i++) {
    s.DataHandler.handleEventData(stats({ 2: ['not a guild string'], 4: 'Must Not Replace' }))
    s.clock.advance(3_000)
  }

  assert.deepEqual(player, { playerName: 'PlayerOne', guildName: 'Kept Guild', allianceName: 'KEPT' })
  assert.equal(s.warned.length, 5)
  assert.ok(s.warned.every((error) => error.message === 'EvCharacterStats has invalid guildName parameter'))
  assert.deepEqual(s.ParseHealth.broken(), [{ name: 'EvCharacterStats', failures: 5, calls: 5 }])
  assert.equal(s.ParseHealth.statusLine(), '[health] parse broken: EvCharacterStats 5/5 (last 10 min)')
})

test('optional absent guild/alliance and empty profile remain valid on code 142', (t) => {
  const s = session(t)

  s.DataHandler.handleEventData(stats({ 2: undefined, 4: undefined, 5: '' }))

  assert.deepEqual(s.MemoryStorage.players.getByName('PlayerOne'), {
    playerName: 'PlayerOne',
    guildName: undefined,
    allianceName: undefined
  })
  assert.deepEqual(s.warned, [])
})
