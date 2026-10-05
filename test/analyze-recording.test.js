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
  ev(4, 82, { 0: ME, 1: 'bigint:13148746629585', 2: 5828386, 5: true }),
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
  assert.equal(summary.ownId.matches[0].fame, true)
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
  assert.equal(r1['own object id settled (a Join param 0 acts in fame, silver or harvest)'].pass, true)
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
  assert.match(text, /Join param 0 = 412783: fame yes · silver pickup yes/)
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

test('another player picking up silver never settles the own id — only the join id acting does', () => {
  const summary = analyze([
    resp(0, 2, { 0: ME, 2: 'Bors', 8: '3012' }),
    ev(1, 62, { 0: 55555, 3: 500000000 }), // a partymate's pickup, broadcast to us
    ev(2, 61, { 0: 55555, 4: 1030, 5: 1 })
  ])

  assert.equal(summary.ownId.settled, false)
  assert.equal(summary.ownId.matches[0].silver, false)
})

// ── R3: the player-trade verification session ───────────────────────────────────

/** Event 179 with only the columns R3 reads: our items at 8, theirs at 18, silver at 2 and 4. */
const tradeUpdate = (seconds, tradeId, revision, { gave = [], got = [], silverGave, silverGot } = {}) =>
  ev(seconds, 179, { 0: tradeId, 1: revision, ...(silverGave ? { 2: silverGave } : {}), ...(silverGot ? { 4: silverGot } : {}), 8: gave, 15: gave.map(() => 1), 18: got, 25: got.map(() => 1) })

/** What the verification session asks for, recorded after the patch (dates are 2026-10-06). */
const r3Session = () => {
  const t0 = Date.parse('2026-10-06T18:00:00.000Z')
  const late = (seconds) => new Date(t0 + seconds * 1000).toISOString()
  const at2 = (record, seconds) => ({ ...record, at: late(seconds) })

  return [
    at2(resp(0, 2, { 0: ME, 2: 'Me', 8: '3339' }), 0),
    // We invite a guildless alt (the guild comes as ""), give it a potion stack.
    { ...resp(0, 161, { 0: 77, 1: 'AltNoGuild', 2: '', 6: 70 }), at: late(10), rc: 0 },
    at2(tradeUpdate(0, 70, 2), 11),
    at2(tradeUpdate(0, 70, 3, { gave: [570] }), 12),
    at2(req(0, 166, { 0: 70, 1: 3, 2: true }), 13),
    at2(ev(0, 180, { 0: 70 }), 14),
    // A partner invites us and hands over two items; the client puts them in the bag in the same moment.
    at2(ev(0, 176, { 0: 88, 1: 'Partner', 2: 'OurGuild', 6: 71 }), 20),
    at2(tradeUpdate(0, 71, 3, { got: [2587, 3035] }), 21),
    at2(req(0, 166, { 0: 71, 1: 2, 2: true }), 22), // accepted an OLDER revision than the last update
    at2(ev(0, 32, { 0: 501, 1: 2587, 2: 1 }), 23),
    at2(ev(0, 26, { 0: 501, 1: 4 }), 23),
    at2(ev(0, 180, { 0: 71 }), 23),
    // A refused invite opens nothing.
    { ...resp(0, 161, {}), at: late(30), rc: 1 },
    // The Ancient Lands: the zone's characters arrive (masked) just before its join, and the invite
    // there names the partner PA.
    at2(ev(0, 29, { 0: 99, 1: 'PA' }), 40),
    at2(resp(0, 2, { 0: ME, 2: 'Me', 8: 'SOME_MASKED_ZONE' }), 40),
    at2(ev(0, 176, { 0: 99, 1: 'PA', 6: 72 }), 42),
    at2(tradeUpdate(0, 72, 2), 43)
  ]
}

test('R3 grades a verification session item by item', () => {
  const summary = analyze(r3Session())
  const r3 = Object.fromEntries(summary.checks.r3.map((c) => [c.label, c]))

  assert.equal(r3['an invitation you sent (response 161)'].pass, true)
  assert.equal(r3['an invitation you received (event 176)'].pass, true)
  assert.equal(r3['a finished trade where you RECEIVED items'].pass, true)
  assert.equal(r3['a finished trade where you GAVE items'].pass, true)
  assert.equal(r3['a partner with no guild'].pass, true)
  assert.match(r3['a partner with no guild'].detail, /empty "" ×1/)
  assert.equal(r3['a trade in the Ancient Lands'].pass, true)
  assert.match(r3['a trade in the Ancient Lands'].detail, /#72 in zone SOME_MASKED_ZONE: the invite named the partner PA \(masked\)/)
  // The masked zone's PA arrives just BEFORE its join, in the old zone: a trade that ended there earlier is not masked.
  assert.doesNotMatch(r3['a trade in the Ancient Lands'].detail, /#71/)
  assert.equal(r3['updates and a finish after the 2026-09-28 patch'].pass, true)
  assert.equal(r3['our accept = the last update, every finished trade'].pass, false)
  assert.match(r3['our accept = the last update, every finished trade'].detail, /#70 3\/3 #71 2\/3/)
  assert.equal(r3['item events around a received trade'].pass, true)
  assert.match(r3['item events around a received trade'].detail, /#71: InventoryPutItem ×1, NewSimpleItem ×1, NewEquipmentItem ×0/)
  assert.equal(r3['a finished trade where you RECEIVED items'].pass, true)
  assert.equal(summary.trades.refused, 1)
  assert.deepEqual(
    summary.trades.trades.map((t) => [t.tradeId, t.outcome]),
    [
      [70, 'finished'],
      [71, 'finished'],
      [72, null]
    ]
  )
})

test('R3 on a recording like 2026-09-16: guildmates only, nothing received, nothing after the patch', () => {
  const summary = analyze([
    resp(0, 2, { 0: ME, 2: 'Me', 8: '1354' }),
    resp(1, 161, { 0: 9854, 1: 'Partner1', 2: 'OurGuild', 3: 39, 4: 3, 6: 295 }),
    tradeUpdate(2, 295, 10, { silverGave: 600000000000 }),
    req(3, 166, { 0: 295, 1: 10, 2: true }),
    ev(4, 180, { 0: 295 })
  ])
  const r3 = Object.fromEntries(summary.checks.r3.map((c) => [c.label, c]))

  assert.equal(r3['a finished trade where you RECEIVED items'].pass, false)
  assert.equal(r3['a partner with no guild'].pass, false)
  assert.equal(r3['a trade in the Ancient Lands'].pass, false)
  assert.equal(r3['updates and a finish after the 2026-09-28 patch'].pass, false)
  assert.equal(r3['our accept = the last update, every finished trade'].pass, true)
  assert.equal(r3['item events around a received trade'].pass, false)
  assert.equal(summary.trades.trades[0].last.silverGave, 60000000)
})

test('R3: a received trade with no item events around its finish passes item 3, not item 9', () => {
  const records = r3Session().filter((r) => !(r.kind === 'event' && (r.id === 26 || r.id === 32)))
  const r3 = Object.fromEntries(analyze(records).checks.r3.map((c) => [c.label, c]))

  assert.equal(r3['a finished trade where you RECEIVED items'].pass, true)
  assert.equal(r3['item events around a received trade'].pass, false)
  assert.match(r3['item events around a received trade'].detail, /#71: InventoryPutItem ×0, NewSimpleItem ×0, NewEquipmentItem ×0/)
})

test('R3: a second invitation under an open id starts a new trade (the engine\'s rule)', () => {
  const summary = analyze([
    resp(0, 2, { 0: ME, 2: 'Me', 8: '3339' }),
    resp(1, 161, { 0: 1, 1: 'Partner1', 2: 'OurGuild', 6: 68 }),
    tradeUpdate(2, 68, 9, { gave: [9484] }), // its finish never arrives
    resp(3, 161, { 0: 2, 1: 'Partner2', 2: 'OurGuild', 6: 68 }),
    tradeUpdate(4, 68, 2),
    tradeUpdate(5, 68, 3, { got: [570] }),
    ev(6, 180, { 0: 68 })
  ])

  assert.deepEqual(
    summary.trades.trades.map((t) => [t.invite.name, t.outcome, t.last.revision]),
    [
      ['Partner1', null, 9],
      ['Partner2', 'finished', 3]
    ]
  )
})

test('R3 never prints a real name the game would have masked — not in the list, --json or --code', () => {
  const records = r3Session()

  // The same Ancient Lands trade, but the invite let a real name through.
  records[records.length - 2] = { ...records[records.length - 2], payload: { 0: 99, 1: 'SomeoneReal', 2: 'TheirGuild', 6: 72, 252: 176 } }

  const summary = analyze(records)
  const text = render(summary, { r1: false, r2: false, r3: true })
  const code = __test.codeReport(records, 176, 10, summary.trades.hiddenRecords).join('\n')

  assert.match(summary.checks.r3.find((c) => c.label === 'a trade in the Ancient Lands').detail, /carried a REAL name \(not masked\)/)
  assert.doesNotMatch(text, /SomeoneReal|TheirGuild/)
  assert.match(text, /invited by «real name, not printed» \[guild not printed\]/)
  assert.match(text, /R3 — player trades/)
  assert.doesNotMatch(JSON.stringify(summary), /SomeoneReal|TheirGuild/)
  assert.deepEqual(summary.trades.trades[2].invite.nameLength, 11)
  assert.doesNotMatch(code, /SomeoneReal|TheirGuild/)
  assert.match(code, /1="«11 chars»"/)
  // The unmasked invitation earlier in the same recording prints as it came.
  assert.match(__test.codeReport(records, 176, 10, summary.trades.hiddenRecords)[0], /1="Partner"/)
})

test('R3: a PA looter (event 279) masks the zone like a PA character, even after the invitation', () => {
  const summary = analyze([
    resp(0, 2, { 0: ME, 2: 'Me', 8: 'SOME_MASKED_ZONE' }),
    ev(1, 176, { 0: 99, 1: 'SomeoneReal', 6: 72 }),
    ev(2, 279, { 1: '@MOB', 2: 'PA', 3: true, 5: 100 }),
    tradeUpdate(3, 72, 2)
  ])

  assert.equal(summary.trades.trades[0].zone.masked, true)
  assert.equal(summary.trades.trades[0].invite.name, null)
  assert.doesNotMatch(JSON.stringify(summary), /SomeoneReal/)
})

test('parseArgs: --r3 alone hides R1 and R2', () => {
  assert.deepEqual([parseArgs(['a.jsonl', '--r3']).r1, parseArgs(['a.jsonl', '--r3']).r3], [null, true])
  assert.equal(parseArgs(['a.jsonl']).r3, true)
})

// ── R3 --compare: one trade, recorded on both machines ──────────────────────────

/** Event 179 with whole stacks, `[index, qty, quality]`, on each side. */
const windowUpdate = (seconds, tradeId, revision, { gave = [], got = [], silverGave, silverGot } = {}) =>
  ev(seconds, 179, {
    0: tradeId,
    1: revision,
    ...(silverGave ? { 2: silverGave } : {}),
    ...(silverGot ? { 4: silverGot } : {}),
    8: gave.map((s) => s[0]),
    10: gave.map((s) => s[2]),
    15: gave.map((s) => s[1]),
    18: got.map((s) => s[0]),
    20: got.map((s) => s[2]),
    25: got.map((s) => s[1])
  })

/**
 * One trade seen from both ends. A (capturer "Me") invites B — response 161 on A, event 176 on B —
 * and gives five potions and 100 silver for a cape: A's own side (8–16) is B's partner side (17–26).
 * B's clock runs 37 s ahead of A's. `masked` moves it into a zone whose characters arrive as PA:
 * B's invitation names A as PA, and A's lets B's real name through (A's analysis blanks it).
 */
const twoMachines = ({ partner = 'Partner', tradeIdB = 70, finalRevisionB = 4, masked = false } = {}) => {
  const t0 = Date.parse('2026-10-06T18:00:00.000Z')
  const clock = (offsetMs) => (record, seconds) => ({ ...record, at: new Date(t0 + offsetMs + seconds * 1000).toISOString() })
  const a = clock(0)
  const b = clock(37_000)
  const zone = masked ? 'SOME_MASKED_ZONE' : '3339'
  const potions = [570, 5, 1]
  const cape = [2587, 1, 3]
  const silver = 1_000_000 // 100 silver, fixed-point

  return {
    a: [
      ...(masked ? [a(ev(0, 29, { 0: 9, 1: 'PA' }), 0)] : []),
      a(resp(0, 2, { 0: ME, 2: 'Me', 8: zone }), 0),
      a(req(0, 161, { 0: 501 }), 10),
      { ...a(resp(0, 161, { 0: 501, 1: partner, 2: 'OurGuild', 6: 70 }), 10), rc: 0 },
      a(windowUpdate(0, 70, 2), 11),
      a(windowUpdate(0, 70, 3, { gave: [potions], silverGave: silver }), 12),
      a(windowUpdate(0, 70, 4, { gave: [potions], got: [cape], silverGave: silver }), 13),
      a(req(0, 166, { 0: 70, 1: 4, 2: true }), 14),
      a(ev(0, 181, { 0: 70 }), 14),
      a(ev(0, 181, { 0: 70 }), 15),
      a(ev(0, 180, { 0: 70 }), 16)
    ],
    b: [
      ...(masked ? [b(ev(0, 29, { 0: 9, 1: 'PA' }), 0)] : []),
      b(resp(0, 2, { 0: 501, 2: partner, 8: zone }), 0),
      b(ev(0, 176, { 0: ME, 1: masked ? 'PA' : 'Me', 2: 'OurGuild', 6: tradeIdB }), 10),
      b(windowUpdate(0, tradeIdB, 2), 11),
      b(windowUpdate(0, tradeIdB, 3, { got: [potions], silverGot: silver }), 12),
      b(windowUpdate(0, tradeIdB, finalRevisionB, { gave: [cape], got: [potions], silverGot: silver }), 13),
      b(ev(0, 181, { 0: tradeIdB }), 14),
      b(req(0, 166, { 0: tradeIdB, 1: finalRevisionB, 2: true }), 15),
      b(ev(0, 181, { 0: tradeIdB }), 15),
      b(ev(0, 180, { 0: tradeIdB }), 16)
    ]
  }
}

const compared = (machines) => analyze(machines.a, { compareRecords: machines.b, compareLabel: 'theirs.jsonl' })
const agreeItem = (summary) => summary.checks.r3.find((c) => c.label === 'two machines agree on a trade')

test('--compare pairs a trade with its mirror on the other machine, and they agree', () => {
  const summary = compared(twoMachines())
  const [pair] = summary.compare.pairs

  assert.equal(summary.compare.pairs.length, 1)
  assert.equal(pair.pairedBy, 'names')
  assert.equal(pair.skewSeconds, 37)
  assert.equal(pair.tradeIdEqual, true)
  assert.deepEqual(pair.revision, { a: 4, b: 4, equal: true })
  assert.deepEqual(pair.accepted, { a: 4, b: 4, equal: true })
  assert.deepEqual(pair.items.aGaveBGot, { equal: true, stacks: 1, onlyA: [], onlyB: [] })
  assert.deepEqual(pair.items.aGotBGave, { equal: true, stacks: 1, onlyA: [], onlyB: [] })
  assert.deepEqual(pair.silver, { aGave: 100, aGot: 0, bGave: 0, bGot: 100, mirrored: true })
  assert.equal(pair.agrees, true)
  assert.deepEqual(summary.compare.unpaired, { a: [], b: [] })
  assert.equal(agreeItem(summary).pass, true)
  assert.match(agreeItem(summary).detail, /A#70↔B#70 agree · trade id equal in 1\/1/)

  const text = render(summary, { r1: false, r2: false, r3: true })

  assert.match(text, /Two machines — A: this recording \(Me\) · B: theirs\.jsonl \(Partner\)/)
  assert.match(text, /A #70 .* ↔ B #70 .* · B \+37 s · paired by names · AGREE/)
  assert.match(text, /A gave = B got: same, 1 stack\(s\) · A got = B gave: same, 1 stack\(s\)/)
  assert.match(text, /PASS\s+two machines agree on a trade/)
})

test('--compare: a final revision the other machine saw differently fails the item', () => {
  const summary = compared(twoMachines({ finalRevisionB: 5 }))
  const [pair] = summary.compare.pairs

  assert.equal(pair.revision.equal, false)
  assert.equal(pair.accepted.equal, false)
  assert.equal(pair.agrees, false)
  assert.equal(agreeItem(summary).pass, false)
  assert.match(agreeItem(summary).detail, /A#70↔B#70 disagree \(final revision, accepted revision\)/)
  assert.match(render(summary, { r3: true }), /final revision 4\/5 DIFFERS/)
})

test('--compare: a stack that differs in quality is a disagreement on that side alone', () => {
  const machines = twoMachines()

  // B saw the cape at quality 4, not 3.
  machines.b = machines.b.map((r) => (r.kind === 'event' && r.id === 179 && r.payload['1'] === 4 ? { ...r, payload: { ...r.payload, 10: [4] } } : r))

  const [pair] = compared(machines).compare.pairs

  assert.equal(pair.items.aGaveBGot.equal, true)
  assert.deepEqual(pair.items.aGotBGave, { equal: false, stacks: 1, onlyA: ['2587×1 q3'], onlyB: ['2587×1 q4'] })
  assert.equal(pair.agrees, false)
})

test('--compare: the trade id is a reported fact, not part of the grade', () => {
  const summary = compared(twoMachines({ tradeIdB: 12 }))

  assert.equal(summary.compare.pairs[0].tradeIdEqual, false)
  assert.equal(agreeItem(summary).pass, true)
  assert.match(render(summary, { r3: true }), /trade id DIFFERS[\s\S]*trade id equal in 0 of 1 pair\(s\)/)
})

test('--compare lists a finished trade with no mirror, on either side', () => {
  const machines = twoMachines()
  const later = (record, seconds) => ({ ...record, at: new Date(Date.parse('2026-10-06T18:01:00.000Z') + seconds * 1000).toISOString() })

  // A trades with someone else a minute later; B finishes one with a third player two minutes after that.
  machines.a.push(
    { ...later(resp(0, 161, { 0: 777, 1: 'Other', 2: '', 6: 73 }), 0), rc: 0 },
    later(windowUpdate(0, 73, 2, { gave: [[570, 1, 1]] }), 1),
    later(ev(0, 180, { 0: 73 }), 2)
  )
  machines.b.push(later(ev(0, 176, { 0: 778, 1: 'Third', 6: 74 }), 140), later(windowUpdate(0, 74, 2), 141), later(ev(0, 180, { 0: 74 }), 142))

  const summary = compared(machines)
  const text = render(summary, { r3: true })

  assert.equal(summary.compare.pairs.length, 1)
  assert.deepEqual(
    summary.compare.unpaired.a.map((t) => [t.tradeId, t.partner, t.reason]),
    [[73, 'Other', 'no mirror finishing within 120 s']]
  )
  assert.deepEqual(
    summary.compare.unpaired.b.map((t) => [t.tradeId, t.partner]),
    [[74, 'Third']]
  )
  assert.match(text, /unpaired in A: #73 .* · partner Other · no mirror finishing within 120 s/)
  assert.match(text, /unpaired in B: #74 .* · partner Third/)
  // The pair still agrees, so the item passes; the unpaired trades are reported beside it.
  assert.equal(agreeItem(summary).pass, true)
  assert.match(agreeItem(summary).detail, /unpaired A 1, B 1/)
})

test('--compare: the mirror must be within 120 s; of two candidates the nearest finish wins', () => {
  const far = twoMachines()

  far.b = far.b.map((r) => ({ ...r, at: new Date(Date.parse(r.at) + 90_000).toISOString() })) // 127 s apart

  assert.equal(compared(far).compare.pairs.length, 0)
  assert.equal(agreeItem(compared(far)).pass, false)

  const two = twoMachines()

  // A second, identical-looking finish on B 50 s later: the nearer one (37 s) is the mirror.
  two.b.push({ ...ev(0, 176, { 0: ME, 1: 'Me', 6: 75 }), at: '2026-10-06T18:01:20.000Z' }, { ...windowUpdate(0, 75, 2), at: '2026-10-06T18:01:21.000Z' }, { ...ev(0, 180, { 0: 75 }), at: '2026-10-06T18:01:43.000Z' })

  const summary = compared(two)

  assert.equal(summary.compare.pairs[0].b.tradeId, 70)
  assert.deepEqual(summary.compare.unpaired.b.map((t) => t.tradeId), [75])
})

test('--compare never prints a name an analysis blanked — it pairs on it, and prints its mask', () => {
  const summary = compared(twoMachines({ partner: 'SomeoneReal', masked: true }))
  const text = render(summary, { r3: true })

  assert.equal(summary.compare.pairs.length, 1)
  assert.equal(summary.compare.pairs[0].pairedBy, 'one name (the other partner was PA)')
  assert.equal(summary.compare.pairs[0].agrees, true)
  assert.doesNotMatch(text, /SomeoneReal/)
  assert.doesNotMatch(JSON.stringify(summary), /SomeoneReal/)
  assert.match(text, /B: theirs\.jsonl \(«real name, not printed»\)/)
  assert.match(text, /A invited «real name, not printed»/)
})

test('without --compare the two-machine item is not graded at all', () => {
  const summary = analyze(twoMachines().a)

  assert.equal(summary.compare, undefined)
  assert.equal(agreeItem(summary), undefined)
  assert.doesNotMatch(render(summary, { r3: true }), /Two machines/)
})

test('parseArgs: --compare takes a file and shows R3 alone unless a checklist is named', () => {
  const options = parseArgs(['mine.jsonl', '--compare', 'theirs.jsonl'])

  assert.deepEqual([options.files, options.compare, options.r1, options.r2, options.r3], [['mine.jsonl'], 'theirs.jsonl', false, false, true])
  assert.deepEqual([parseArgs(['a.jsonl', '--r1', '--compare', 'b.jsonl']).r1, parseArgs(['a.jsonl', '--r1', '--compare', 'b.jsonl']).r3], [true, true])
  assert.throws(() => parseArgs(['a.jsonl', '--compare']), /--compare needs/)
  assert.throws(() => parseArgs(['a.jsonl', '--compare', '--r3']), /--compare needs/)
})
