const test = require('node:test')
const assert = require('node:assert')

const { scrubber, ME_GUID } = require('../tools/extract-trade-fixture')

// The trade fixture's scrubber: a trade names the member, the partner, the partner's guild and the
// crafters of every item in the window — none of whom agreed to be in a test.

const join = { at: 't0', kind: 'response', id: 2, rc: 0, payload: { 0: 11080, 1: [9, 9, 9], 2: 'RealMember', 8: '@HIDEOUT@1354@00000000-1111-2222-3333-444444444444', 58: 'RealGuild', 79: 'RA', 54: [1, 2], 253: 2 } }
const invite = { at: 't1', kind: 'response', id: 161, rc: 0, payload: { 0: 212112, 1: 'RealPartner', 2: 'RealGuild', 3: 29, 4: 3, 6: 1766, 253: 161 } }
const update = {
  at: 't2',
  kind: 'event',
  id: 179,
  payload: { 0: 1766, 1: 3, 6: [212924], 8: [570], 9: ['RealMember'], 15: [11], 16: [''], 18: [2587], 19: ['SomeCrafter'], 25: [1], 26: ['x'], 252: 179 }
}

test('the member, the partner, the guild and the crafters become placeholders; numbers stay', () => {
  const { scrub, replaced } = scrubber()
  const [j, i, u] = [join, invite, update].map(scrub)

  assert.deepEqual({ ...j.payload, 8: null }, { 0: 11080, 1: ME_GUID, 2: 'Me', 8: null, 58: 'OurGuild', 79: 'OurAlliance', 253: 2 })
  // The hideout's instance id is faked, stably; the cluster before it is game data.
  assert.match(j.payload[8], /^@HIDEOUT@1354@[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  assert.notEqual(j.payload[8], join.payload[8])
  assert.equal(scrubber().scrub(join).payload[8], j.payload[8])
  assert.equal(j.rc, 0)
  assert.deepEqual(i.payload, { 0: 212112, 1: 'Partner1', 2: 'OurGuild', 3: 29, 4: 3, 6: 1766, 253: 161 })
  assert.deepEqual([u.payload[9], u.payload[19], u.payload[16], u.payload[26]], [['Me'], ['Crafter1'], [''], ['Text']])
  assert.deepEqual([u.payload[8], u.payload[15], u.payload[18], u.payload[6]], [[570], [11], [2587], [212924]])
  assert.deepEqual([...replaced()].sort(), ['RA', 'RealGuild', 'RealMember', 'RealPartner', 'SomeCrafter'])
})

test('the mask stays: PA is not a person', () => {
  const { scrub } = scrubber()

  scrub(join)

  assert.equal(scrub({ ...invite, payload: { ...invite.payload, 1: 'PA', 2: undefined } }).payload[1], 'PA')
})

test('text where none was expected stops the run instead of being written', () => {
  const { scrub } = scrubber()

  assert.throws(() => scrub({ at: 't', kind: 'request', id: 166, payload: { 0: 1766, 1: 'SomeName', 253: 166 } }), /unexpected text/)
  assert.throws(() => scrub({ ...update, payload: { ...update.payload, 12: ['Stray'] } }), /unexpected text/)
})
