const test = require('node:test')
const assert = require('node:assert')

const { analyze, render, parseArgs, __test } = require('../tools/analyze-recording')

// The analyzer reads what the dump writer writes: `{at, kind, id, payload}` with
// the dump's own spellings for the values protocol18 hands us (a BigInt is the
// string `bigint:N`). These records are hand-made in that shape.

const at = (seconds) => new Date(1_757_000_000_000 + seconds * 1000).toISOString()

const ev = (seconds, id, payload) => ({ at: at(seconds), kind: 'event', id, payload: { ...payload, 252: id } })
const req = (seconds, id, payload) => ({ at: at(seconds), kind: 'request', id, payload: { ...payload, 253: id } })
const resp = (seconds, id, payload) => ({ at: at(seconds), kind: 'response', id, payload: { ...payload, 253: id } })

const ME = 412783

/** A short open-world evening: one join, a mob killed, a harvest, a pickup, a cast. */
const openWorld = () => [
  resp(0, 2, { 0: ME, 2: 'Bors', 8: '3012', 58: 'VITRYLA' }),
  ev(1, 29, { 0: 1148561, 1: 'BlackBite', 8: '0VERRATED' }),
  ev(2, 123, { 0: 1058092, 1: 482, 13: 20, 14: 20 }),
  ev(3, 6, { 0: 1058092, 1: 31709739, 2: -12, 3: 8, 4: 2, 5: 5, 6: ME, 7: 2762 }),
  ev(4, 6, { 0: 1058092, 1: 31709989, 2: -9, 4: 2, 5: 5, 6: ME, 7: 2762 }), // no param 3: the killing blow
  ev(4, 82, { 0: 66459, 1: 'bigint:13148746629585', 2: 5828386, 5: true }),
  ev(6, 61, { 0: ME, 3: 67942, 4: 4738, 5: 9, 6: 2, 7: 1 }),
  ev(7, 62, { 0: ME, 1: 31710000, 2: 1166287, 3: 500000000, 8: 10000 }),
  req(8, 316, { 0: 1, 2: 5391 }),
  req(9, 322, { 1: false })
]

test('counts the stat packets and qualifies the ones with a narrower test', () => {
  const summary = analyze(openWorld())
  const byKey = Object.fromEntries(summary.targets.map((t) => [t.key, t]))

  assert.equal(byKey.fame.count, 1)
  assert.equal(byKey.silver.count, 1)
  assert.equal(byKey.harvest.count, 1)
  assert.equal(byKey.health.count, 2)
  assert.equal(byKey.health.qualified.count, 1)
  assert.equal(byKey.fishFinish.qualified.count, 1)
  assert.equal(byKey.join.count, 1)
  assert.equal(byKey.character.count, 1)
  assert.equal(byKey.fame.name, 'UpdateFame')
  assert.equal(byKey.join.name, 'Join')
})

test('settles the own object id when a join id is the actor of an own-only packet', () => {
  const summary = analyze(openWorld())

  assert.deepEqual(summary.ownId.joinIds, [ME])
  assert.equal(summary.ownId.settled, true)
  assert.equal(summary.ownId.matches[0].silver, true)
  assert.equal(summary.ownId.matches[0].harvest, true)
  assert.equal(summary.ownId.matches[0].causedHits, 2)
})

test('reports the Q24 shape — a join id on no combat or own-only packet — as unsettled', () => {
  const records = openWorld().map((r) => (r.kind === 'response' ? { ...r, payload: { ...r.payload, 0: 99 } } : r))
  const summary = analyze(records)

  assert.equal(summary.ownId.settled, false)
  assert.match(summary.ownId.note, /Q24 mismatch/)
})

test('a recording with no join says so instead of guessing', () => {
  const summary = analyze(openWorld().filter((r) => r.kind !== 'response'))

  assert.equal(summary.ownId.joinIds.length, 0)
  assert.match(summary.ownId.note, /no Join response/)
})

test('grades R1 item by item, naming what is missing', () => {
  const summary = analyze(openWorld())
  const r1 = Object.fromEntries(summary.checks.r1.map((c) => [c.label, c]))

  assert.equal(r1['fame events'].pass, true)
  assert.equal(r1['a killing blow in the health updates'].pass, true)
  assert.equal(r1['own object id settled (Join param 0 seen on an own-only packet)'].pass, true)
  assert.equal(r1['fishing casts, five or more'].pass, false)
  assert.equal(r1['fishing casts, five or more'].why, 'five casts')
  assert.equal(r1['two or more zone joins'].pass, false)
})

test('grades R2, telling a repair from a craft by the action type', () => {
  const records = [
    ev(1, 49, { 3: 'FORGE' }),
    req(2, 55, { 0: 'bigint:638028282819317254', 1: 442, 2: 1, 4: 530000, 5: [1571], 6: [3], 7: 3001, 9: 1 }),
    req(3, 55, { 0: 'bigint:638028282819317255', 1: 442, 2: 1, 4: 530000, 5: [1572], 6: [3], 7: 3001, 9: 1 }),
    req(4, 55, { 0: 'bigint:638028282819317256', 1: 442, 2: 2, 4: 120000, 5: [1571] }),
    ev(5, 71, { 0: ME, 1: 442 }),
    ev(6, 71, { 0: ME, 1: 442 }),
    ev(7, 66, { 0: ME, 2: 442, 4: 2 }),
    ev(8, 30, { 0: 357, 1: 5392, 2: 1, 4: 1678471256, 6: 'Bors', 7: 3, 8: 455630000 }),
    resp(9, 174, { 3: [1, 2], 11: ['MARKETPLACE_SELLORDER_FINISHED_SUMMARY'] }),
    resp(10, 176, { 0: 1, 1: '3|T6_HEAD_CLOTH_SET3|4440000000|1480000000' })
  ]
  const summary = analyze(records)
  const r2 = Object.fromEntries(summary.checks.r2.map((c) => [c.label, c]))

  assert.equal(r2['a craft action'].pass, true)
  assert.equal(r2['a repair'].pass, true)
  assert.equal(r2['the station named itself'].pass, true)
  assert.equal(r2['craft finished events'].pass, true)
  assert.equal(r2['an equipment reveal naming its crafter'].pass, true)
  assert.equal(r2['a focus update'].pass, false)
  assert.equal(r2['mail list'].pass, true)
  assert.equal(r2['mail body'].pass, true)
  assert.equal(summary.mails.unpromptedBodies, 0)
})

test('a mail body that precedes every mail list is counted as unprompted', () => {
  const summary = analyze([resp(1, 176, { 0: 1, 1: 'x' }), resp(5, 174, { 3: [1] })])

  assert.equal(summary.mails.unpromptedBodies, 1)
})

test('the census names a code with the reference tool\'s name and keeps the kind apart', () => {
  const summary = analyze([ev(1, 176, {}), resp(2, 176, {})])
  const rows = summary.census.map((r) => `${r.kind}:${r.id}:${r.name}`)

  assert.ok(rows.includes('event:176:InvitationPlayerTrade'))
  assert.ok(rows.includes('response:176:ReadMail'))
})

test('render prints the checklist lines the operator reads', () => {
  const text = render(analyze(openWorld()), { r1: true, r2: false })

  assert.match(text, /R1 — open world/)
  assert.match(text, /PASS\s+fame events/)
  assert.match(text, /MISSING fishing casts, five or more\s+← five casts/)
  assert.doesNotMatch(text, /R2 — a city/)
  assert.match(text, /Join param 0 = 412783: silver pickup yes/)
})

test('parseArgs: naming one checklist hides the other, naming none shows both', () => {
  assert.deepEqual(parseArgs(['a.jsonl']).r1, true)
  assert.deepEqual(parseArgs(['a.jsonl']).r2, true)
  assert.deepEqual(parseArgs(['a.jsonl', '--r2']).r1, null)
  assert.deepEqual(parseArgs(['a.jsonl', '--r2']).r2, true)
  assert.deepEqual(parseArgs(['a.jsonl', '--code', '176', '--samples', '3']).code, 176)
  assert.throws(() => parseArgs(['--nope']), /unknown option/)
})

test('the dump\'s bigint spelling reads back as a number; a key profile ignores the code slot', () => {
  assert.equal(__test.num('bigint:500000000'), 500000000)
  assert.equal(__test.num(7), 7)
  assert.ok(Number.isNaN(__test.num('seven')))
  assert.equal(__test.keyProfile({ 5: 1, 0: 2, 252: 82, 3: 'x' }), '0,3,5')
})

// ── What the recordings of 2026-09-16/18 taught the checklists ──────────────────

test('a failed catch OMITS the success flag — that counts, and so does state 10', () => {
  const absent = analyze([req(1, 322, { 0: 'bigint:639251698507989100' })])
  const escaped = analyze([ev(1, 355, { 0: 32953, 1: 32966, 2: 3018, 3: 10 })])
  const landed = analyze([req(1, 322, { 1: true }), ev(2, 355, { 3: 9 })])
  const r1 = (s) => Object.fromEntries(s.checks.r1.map((c) => [c.label, c.pass]))

  assert.equal(r1(absent)['a failed cast'], true)
  assert.equal(r1(escaped)['a failed cast'], true)
  assert.equal(r1(landed)['a failed cast'], false)
})

test('two targets can watch one code: event 355 counts landings and escapes apart', () => {
  const summary = analyze([ev(1, 355, { 3: 9 }), ev(2, 355, { 3: 9 }), ev(3, 355, { 3: 10 }), ev(4, 355, { 3: 7 })])
  const byKey = Object.fromEntries(summary.targets.map((t) => [t.key, t]))

  assert.equal(byKey.fishLanded.count, 4)
  assert.equal(byKey.fishLanded.qualified.count, 2)
  assert.equal(byKey.fishEscaped.qualified.count, 1)
})

test('one craft action passes however many items it made; a repair is not a craft; journals count', () => {
  const summary = analyze([
    req(1, 55, { 1: 58, 2: 1, 4: 1290240000, 7: 8527, 9: 8 }),
    req(2, 55, { 1: 76, 2: 2, 4: 380092800 }),
    ev(3, 292, { 0: 17878, 1: 12055, 2: 4 })
  ])
  const r2 = Object.fromEntries(summary.checks.r2.map((c) => [c.label, c.pass]))

  assert.equal(r2['a craft action'], true)
  assert.equal(r2['a repair'], true)
  assert.equal(r2['a crafting journal filled'], true)
  assert.equal(analyze([req(1, 55, { 2: 2 })]).checks.r2.find((c) => c.label === 'a craft action').pass, false)
})

test('market replies report their return code, and say so when a recording predates it', () => {
  const summary = analyze([
    { at: at(1), kind: 'response', id: 315, rc: 0, payload: { 253: 315 } },
    { at: at(2), kind: 'response', id: 79, rc: 0, payload: { 253: 79 } },
    { at: at(3), kind: 'response', id: 79, rc: 1, payload: { 253: 79 } },
    resp(4, 80, {})
  ])
  const byId = Object.fromEntries(summary.replies.map((r) => [r.id, r.codes]))

  assert.deepEqual(byId[315], { 0: 1 })
  assert.deepEqual(byId[79], { 0: 1, 1: 1 })
  assert.deepEqual(byId[80], { 'not recorded': 1 })
  assert.match(render(summary, { r1: false, r2: false }), /response 79 {3}AuctionCreateOffer\s+0×1 {2}1×1/)
})
