const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const { createActivity } = require('../src/activity/activity')

// Two real recordings from the owner's Mac, cut down and scrubbed by
// tools/extract-activity-fixture.js (name → "Me", character GUIDs and hideout ids faked, only the
// parameters the tracker reads). These pin the tracker against what the game actually sends —
// the parameter numbers, BigInt totals, byte-array GUIDs and the omitted-zero habit — rather than
// against what a test author believed it sends.
//
// Item names come from a snapshot of the table in force when they were recorded
// (fixtures/activity-items.json), never from the engine's positional fallback, which names 12,049
// of its 12,071 indexes wrongly today.

const FIXTURES = path.join(__dirname, 'fixtures')
const ITEMS = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'activity-items.json'), 'utf8')).items

const revive = (value) => {
  if (typeof value === 'string' && value.startsWith('bigint:')) {
    return BigInt(value.slice(7))
  }

  if (Array.isArray(value)) {
    return value.map(revive)
  }

  if (value != null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, revive(v)]))
  }

  return value
}

const replay = (name) => {
  const lines = []
  const activity = createActivity({
    sink: (record) => lines.push(record),
    items: { get: (index) => (ITEMS[index] != null ? { itemId: ITEMS[index] } : undefined), source: 'live' },
    now: () => 0
  })
  const records = fs
    .readFileSync(path.join(FIXTURES, name), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))

  for (const record of records) {
    const parameters = revive(record.payload)

    if (record.kind === 'event') {
      activity.onEvent({ parameters })
    } else {
      activity.onResponse({ parameters })
    }
  }

  return { lines, of: (t) => lines.filter((l) => l.t === t) }
}

test('2026-09-16: every join became a zone line, under the scrubbed name', () => {
  const { of } = replay('activity-2026-09-16.jsonl')
  const zones = of('zone')

  assert.equal(zones.length, 79)
  assert.ok(zones.every((z) => z.char === 'Me' && typeof z.fame_total === 'number'))
})

test("2026-09-16: the craft's fame — three real gains, and the resend this recording holds", () => {
  const { of } = replay('activity-2026-09-16.jsonl')
  const craft = of('fame').filter((l) => l.gain === 446400000 || l.gain === 2678400000).map((l) => l.gain)

  // A dump has no sequence numbers, so the resend 227 ms later is still in it; the live parser drops
  // it by number. What must NOT be dropped is the first three — two of them identical, all real.
  assert.deepEqual(craft, [446400000, 2678400000, 446400000, 446400000, 2678400000, 446400000])
  assert.equal((craft[0] + craft[1] + craft[2]) / 1e4, 357120) // six journals × 58,590 + 5,580
})

test('2026-09-16: the stale copy that arrived 45 s late under the old zone id is not fame', () => {
  const { of } = replay('activity-2026-09-16.jsonl')

  assert.equal(of('fame').filter((l) => l.gain === 133541788).length, 1) // 17:13:32 counts; its copy at 17:14:17 does not
})

test("2026-09-16: silver is the member's own pickups, taxes kept apart", () => {
  const { of } = replay('activity-2026-09-16.jsonl')
  const silver = of('silver')

  assert.deepEqual(
    silver.map((l) => l.yield),
    [7885350, 7885350, 7885350, 64196550, 31630500, 13832775, 32098275]
  )
  assert.ok(silver.every((l) => l.guild_tax >= 0 && l.yield > l.guild_tax))
})

test('2026-09-16: harvests, kills and chests', () => {
  const { of } = replay('activity-2026-09-16.jsonl')

  assert.equal(of('harvest').length, 13)
  assert.ok(of('harvest').every((l) => /^T\d_/.test(l.item) && Number.isInteger(l.index) && l.std >= 1))
  assert.equal(of('kill').length, 15)
  assert.deepEqual(
    of('chest').map((l) => [l.name, l.rarity]),
    [
      ['BOSSLAIR_CHEST_UNDEAD_VETERAN_RARE', 2],
      ['TREASURE_CASTLE_STANDARD', 1]
    ]
  )
})

test('2026-09-16: the Greenriver Eel', () => {
  const { of } = replay('activity-2026-09-16.jsonl')
  const fish = of('fish')

  assert.equal(fish.length, 1)
  assert.equal(fish[0].outcome, 'landed')
  assert.equal(fish[0].rod, 'T6_2H_TOOL_FISHINGROD')
  assert.deepEqual(
    fish[0].catch.map((c) => [c.item, c.qty]),
    [
      ['T3_FISH_FRESHWATER_FOREST_RARE', 2],
      ['T1_SEAWEED', 2]
    ]
  )
})

test('2026-09-18: twelve bouts — eleven landed, one got away, one of them logs', () => {
  const { of } = replay('activity-2026-09-18.jsonl')
  const fish = of('fish')

  assert.equal(fish.length, 12)
  assert.equal(fish.filter((l) => l.outcome === 'escaped').length, 1)
  assert.deepEqual(fish.find((l) => l.outcome === 'escaped').catch, [])
  assert.ok(fish.some((l) => l.catch.some((c) => c.item === 'T1_WOOD'))) // by-catch the page counts apart
})

test('2026-09-18: fame reconciles exactly with the running total the joins report', () => {
  const { lines, of } = replay('activity-2026-09-18.jsonl')
  const zones = of('zone')
  const first = lines.indexOf(zones[0])
  const last = lines.indexOf(zones[zones.length - 1])
  const gained = lines.slice(first, last).filter((l) => l.t === 'fame').reduce((sum, l) => sum + l.gain, 0)

  // An independent check, not a snapshot: the game's own running total must move by exactly the
  // gains written between the two joins. A resend or a stale copy breaks it by its own amount.
  assert.equal(gained, zones[zones.length - 1].fame_total - zones[0].fame_total)
  assert.ok(gained > 0)
})
