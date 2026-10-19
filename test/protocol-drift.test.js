const test = require('node:test')
const assert = require('node:assert/strict')
const { fresh, useFakeClock } = require('./helpers')

process.setMaxListeners(50)

const session = (t) => {
  const s = fresh()
  useFakeClock(t)
  const rows = []
  const warnings = []
  s.Logger.debug = () => {}
  s.Logger.warn = (error) => warnings.push(error)
  s.LootLogger.write = (row) => rows.push(row)
  const DataHandler = require('../src/data-handler/data-handler')
  const send = (code, parameters) => DataHandler.handleEventData({ parameters: { ...parameters, 252: code } })
  return { ...s, send, rows, warnings }
}

test('October 15 literal pickup 278 writes its named looter, item and quantity', (t) => {
  const s = session(t)
  // From debug-logs1.txt.gz, 2026-10-15T15:57:18.009Z. Only the looter is
  // anonymized. This checks dispatch and the actual loot sink, not only parse().
  const payload = { 0: 50058, 1: '@MOB_T6_MOB_ROAMING_STEPPE_CHEST', 2: 'FixtureLooter', 4: 255, 5: 1 }
  s.send(278, payload)
  assert.equal(s.rows.length, 1)
  assert.equal(s.rows[0].lootedBy.playerName, 'FixtureLooter')
  assert.equal(s.rows[0].lootedFrom.playerName, payload[1])
  assert.equal(s.rows[0].quantity, 1)
  // With no current item table, identity stays explicitly unknown.
  assert.equal(s.rows[0].itemId, 'UNKNOWN_255')
  s.send(279, payload)
  assert.equal(s.rows.length, 1, 'old ordinal must not remain a second live pickup route')
  assert.deepEqual(s.warnings, [])
})

test('current chest and party routes name a chest and write its assignment once', (t) => {
  const s = session(t)
  const PartyLoot = require('../src/storage/party-loot-storage')
  // Payload shapes were proven before this protocol change. Current ordinals
  // come from the October 16 primary enum; no current live chest is claimed.
  s.MemoryStorage.players.self = s.MemoryStorage.players.add({ playerName: 'FixtureLooter' })
  s.send(392, { 0: 77, 3: 'TREASURE_SOLO_UNCOMMON' })
  assert.equal(s.MemoryStorage.containers.getById(77).owner, 'TREASURE_SOLO_UNCOMMON')
  s.send(393, { 0: 77, 1: 7 })
  s.send(301, { 0: 77, 1: [501, 502], 2: [255, 256], 9: [1, 2], 10: ['FixtureLooter', 'FixtureLooter'] })
  assert.equal(s.rows.length, 2)
  assert.equal(s.rows.reduce((sum, row) => sum + row.quantity, 0), 3)
  assert.ok(s.rows.every((row) => row.lootedFrom.playerName === 'TREASURE_SOLO_UNCOMMON'))
  s.send(302, { 0: 77, 1: [501] })
  s.send(303, { 0: 77, 1: [256], 4: [2] })
  assert.equal(PartyLoot.take(501), undefined)
  assert.equal(PartyLoot.take(502), undefined)
  assert.equal(s.rows.length, 2, 'removal events do not write another pickup')
  assert.deepEqual(s.warnings, [])
})

test('the unchanged bank-attach permission/shape protection still fails closed', (t) => {
  const s = session(t)
  const Health = require('../src/storage/parse-health')
  for (let i = 0; i < 5; i++) {
    s.send(99, { 0: 'invalid-container-id' })
  }
  assert.deepEqual(Health.broken(), [{ name: 'EvAttachItemContainer', failures: 5, calls: 5 }])
  assert.equal(s.rows.length, 0)
})
