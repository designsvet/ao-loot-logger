const test = require('node:test')
const assert = require('node:assert')

const { createActivity } = require('../src/activity/activity')
const { activityFileFor, ActivityLog } = require('../src/activity/activity-log')

// The shapes below are the ones the two recordings of 2026-09-16/18 carried — parameter numbers,
// types and the "absent, never zero" habit included. Each test drives the tracker the way the data
// handler does and reads the lines it would write.

const ME = 27879
const MY_GUID = [5, 90, 8, 3, 248, 123, 32, 70, 172, 175, 13, 183, 75, 145, 163, 223]
const OTHER_GUID = [132, 61, 72, 206, 74, 62, 243, 75, 132, 255, 162, 188, 102, 13, 75, 35]

const ITEMS = {
  4738: { itemId: 'T5_WOOD_LEVEL2@2' },
  3018: { itemId: 'T6_2H_TOOL_FISHINGROD' },
  160: { itemId: 'T3_FISH_FRESHWATER_FOREST_RARE' },
  184: { itemId: 'T1_SEAWEED' }
}

const tracker = () => {
  const lines = []
  let clock = 1_789_569_963_000
  const activity = createActivity({
    sink: (record) => lines.push(record),
    items: { get: (index) => ITEMS[index], source: 'live' },
    now: () => (clock += 1000)
  })

  const ev = (code, parameters) => activity.onEvent({ parameters: { ...parameters, 252: code } })
  const join = (id = ME, zone = '1354', extra = {}) =>
    activity.onResponse({ parameters: { 0: id, 1: MY_GUID, 2: 'Bors', 8: zone, 35: 13219213663987n, 253: 2, ...extra } })

  return { lines, ev, join, activity, kinds: () => lines.map((l) => l.t) }
}

test('a join names the member, the zone, and the running fame total', () => {
  const { lines, join } = tracker()

  join()

  assert.equal(lines.length, 1)
  assert.deepEqual({ ...lines[0], at: 0 }, { v: 1, t: 'zone', at: 0, char: 'Bors', zone: '1354', items: 'live', fame_total: 13219213663987 })
})

test('fame is written raw and whole — including a gain identical to the one before it', () => {
  const { lines, ev, join } = tracker()

  join()
  // The scythe craft's three fame events: two of them byte-identical, all three real.
  ev(82, { 0: ME, 1: 13225726070570n, 2: 446400000, 5: true, 16: 2000 })
  ev(82, { 0: ME, 1: 13225726070570n, 2: 2678400000, 5: true, 16: 2000 })
  ev(82, { 0: ME, 1: 13225726070570n, 2: 446400000, 5: true, 16: 2000 })

  const fame = lines.filter((l) => l.t === 'fame')

  assert.deepEqual(fame.map((l) => l.gain), [446400000, 2678400000, 446400000])
  assert.equal(fame.reduce((sum, l) => sum + l.gain, 0) / 1e4, 357120) // = 6 journals × 58,590 + 5,580
  assert.equal(fame[0].premium, true)
})

test("fame is the member's alone, under the current zone's id", () => {
  const { lines, ev, join } = tracker()

  join(ME)
  join(32683, '0339')
  ev(82, { 0: 32683, 1: 13219244428787n, 2: 30764800 })
  ev(82, { 0: 99999, 1: 13219244428787n, 2: 1 })

  assert.deepEqual(lines.filter((l) => l.t === 'fame').map((l) => l.gain), [30764800])
})

test('under the previous zone id, a stale copy is dropped and a genuinely new gain is kept', () => {
  const { lines, ev, join } = tracker()

  // 2026-09-16, 17:13–17:14: a gain, the zone change, then the same gain again 45 s later —
  // same total, below the running total the new join reported. The copy must not count.
  join(44272, '1339', { 35: 13225726070570n })
  ev(82, { 0: 44272, 1: 13225859612360n, 2: 133541790 })
  ev(82, { 0: 44272, 1: 13226214172610n, 2: 543697 })
  join(5961, '@HIDEOUT', { 35: 13226214172610n })
  ev(82, { 0: 44272, 1: 13225859612360n, 2: 133541790 }) // the stale copy
  ev(82, { 0: 44272, 1: 13226214272610n, 2: 100000 }) // a real late gain: its total is new

  assert.deepEqual(lines.filter((l) => l.t === 'fame').map((l) => l.gain), [133541790, 543697, 100000])
})

test('silver and harvests are broadcast for everyone nearby: only the member is written', () => {
  const { lines, ev, join } = tracker()

  join()
  ev(62, { 0: ME, 1: 16847230, 2: 27911, 3: 7885350, 5: 788535, 7: true, 8: 29700 })
  ev(62, { 0: 1166287, 1: 16847231, 2: 27912, 3: 500000000, 8: 10000 }) // a partymate's
  ev(61, { 0: ME, 3: 27906, 4: 4738, 5: 9, 6: 2, 7: 1 })
  ev(61, { 0: 55555, 3: 27907, 4: 4738, 5: 9 }) // someone else gathering

  const silver = lines.filter((l) => l.t === 'silver')
  const harvest = lines.filter((l) => l.t === 'harvest')

  assert.equal(silver.length, 1)
  assert.deepEqual(
    { yield: silver[0].yield, guild_tax: silver[0].guild_tax, cluster_tax: silver[0].cluster_tax, premium: silver[0].premium },
    { yield: 7885350, guild_tax: 788535, cluster_tax: 0, premium: true }
  )
  assert.equal(harvest.length, 1)
  assert.deepEqual(
    { item: harvest[0].item, index: harvest[0].index, std: harvest[0].std, bonus: harvest[0].bonus, premium: harvest[0].premium },
    { item: 'T5_WOOD_LEVEL2@2', index: 4738, std: 9, bonus: 2, premium: 1 }
  )
})

test('nothing that needs the member id is written before the first join', () => {
  const { lines, ev } = tracker()

  ev(62, { 0: ME, 3: 7885350 })
  ev(61, { 0: ME, 4: 4738, 5: 1 })
  ev(82, { 0: ME, 2: 100 })

  assert.equal(lines.length, 0)
})

test('a landed fish writes one line with everything the reward events named', () => {
  const { lines, ev, join } = tracker()

  join(32953, '1354')
  ev(355, { 0: 32953, 1: 32966, 2: 3018, 3: 3 })
  ev(355, { 0: 32953, 1: 32966, 2: 3018, 3: 4 })
  ev(355, { 0: 32953, 1: 32966, 2: 3018, 3: 5 })
  ev(355, { 0: 32953, 1: 32966, 2: 3018, 3: 7 })
  ev(355, { 0: 32953, 1: 32966, 2: 3018, 3: 8 })
  ev(267, { 1: 160, 3: 2 })
  ev(267, { 1: 184, 3: 2 })
  ev(355, { 0: 32953, 1: 32966, 2: 3018, 3: 9 })

  const fish = lines.filter((l) => l.t === 'fish')

  assert.equal(fish.length, 1)
  assert.equal(fish[0].outcome, 'landed')
  assert.equal(fish[0].rod, 'T6_2H_TOOL_FISHINGROD')
  assert.equal(fish[0].rod_index, 3018)
  assert.deepEqual(fish[0].catch, [
    { item: 'T3_FISH_FRESHWATER_FOREST_RARE', index: 160, qty: 2 },
    { item: 'T1_SEAWEED', index: 184, qty: 2 }
  ])
})

test('an escape is a line with no catch; an abort and a stray reward are nothing', () => {
  const { lines, ev, join } = tracker()

  join()
  ev(267, { 1: 160, 3: 2 }) // no bout running
  ev(355, { 0: ME, 1: 1, 2: 3018, 3: 3 })
  ev(355, { 0: ME, 1: 1, 2: 3018, 3: 15 }) // aborted before a bite
  ev(355, { 0: ME, 1: 1, 2: 3018, 3: 3 })
  ev(355, { 0: ME, 1: 1, 2: 3018, 3: 5 })
  ev(355, { 0: ME, 1: 1, 2: 3018, 3: 10 }) // got away
  ev(355, { 0: 777, 1: 2, 2: 3018, 3: 3 }) // someone else's bout
  ev(355, { 0: 777, 1: 2, 2: 3018, 3: 9 })

  const fish = lines.filter((l) => l.t === 'fish')

  assert.equal(fish.length, 1)
  assert.deepEqual({ outcome: fish[0].outcome, catch: fish[0].catch }, { outcome: 'escaped', catch: [] })
})

test('a mob the member hit counts once when it dies, whoever lands the blow', () => {
  const { lines, ev, join } = tracker()

  join()
  ev(123, { 0: 5251, 1: 482, 13: 20, 14: 20 })
  ev(6, { 0: 5251, 1: 16831430, 2: -12, 3: 8, 6: ME, 7: 65535 })
  ev(6, { 0: 5251, 1: 16831431, 2: -9, 6: 27022, 7: 5727 }) // a partymate's killing blow: no parameter 3
  ev(6, { 0: 5251, 1: 16831431, 2: -9, 6: 27022, 7: 5727 }) // the same blow, resent

  const kills = lines.filter((l) => l.t === 'kill')

  assert.equal(kills.length, 1)
  assert.deepEqual({ mob: kills[0].mob, hp: kills[0].hp }, { mob: 482, hp: 20 })
})

test('no kill for a mob the member never touched, nor for a player', () => {
  const { lines, ev, join } = tracker()

  join()
  ev(123, { 0: 6001, 1: 482, 14: 20 })
  ev(6, { 0: 6001, 2: -20, 6: 27022 }) // died, but not to anything the member did
  ev(6, { 0: 7001, 2: -5, 3: 900, 6: ME }) // a player the member hit…
  ev(6, { 0: 7001, 2: -900, 6: ME }) // …and killed: players are the killboard's, not this

  assert.equal(lines.filter((l) => l.t === 'kill').length, 0)
})

test('the batched health update marks a death with a 0, and counts the same way', () => {
  const { lines, ev, join } = tracker()

  join()
  ev(123, { 0: 8416, 1: 1491, 14: 3683 })
  ev(7, { 0: 8416, 1: [1, 2], 2: [-3000, -683], 3: [683, 0], 4: [1, 1], 5: [5, 0], 6: [ME, ME], 7: [5727, 65535] })

  const kills = lines.filter((l) => l.t === 'kill')

  assert.equal(kills.length, 1)
  assert.equal(kills[0].mob, 1491)
})

test('object ids are per zone: a mob from the last zone never dies in this one', () => {
  const { lines, ev, join } = tracker()

  join(ME, '1354')
  ev(123, { 0: 5251, 1: 482, 14: 20 })
  ev(6, { 0: 5251, 2: -5, 3: 15, 6: ME })
  join(32683, '0339')
  ev(6, { 0: 5251, 2: -15, 6: 32683 })

  assert.equal(lines.filter((l) => l.t === 'kill').length, 0)
})

test("a chest counts when it is opened and the member is on its list — once", () => {
  const { lines, ev, join } = tracker()

  join()
  ev(393, { 0: 14628, 3: 'MORGANA_DYNAMIC_CAMP_PERSONAL_SMALL_LC', 21: -1, 23: 4 })
  ev(394, { 0: 14628, 1: 3, 3: MY_GUID }) // a state change, not an opening
  ev(394, { 0: 14628, 1: 7, 3: [...OTHER_GUID, ...MY_GUID] }) // opened; we are the second of two
  ev(394, { 0: 14628, 1: 7, 3: [...OTHER_GUID, ...MY_GUID] }) // resent

  const chests = lines.filter((l) => l.t === 'chest')

  assert.equal(chests.length, 1)
  assert.deepEqual({ name: chests[0].name, rarity: chests[0].rarity }, { name: 'MORGANA_DYNAMIC_CAMP_PERSONAL_SMALL_LC', rarity: 4 })
})

test("somebody else's chest is not the member's", () => {
  const { lines, ev, join } = tracker()

  join()
  ev(393, { 0: 19128, 3: 'TREASURE_SOLO_UNCOMMON', 21: 1 })
  ev(394, { 0: 19128, 1: 7, 3: OTHER_GUID })

  assert.equal(lines.filter((l) => l.t === 'chest').length, 0)
})

test('respec, might and favour, and faction points are written as the game sends them', () => {
  const { lines, ev, join } = tracker()

  join()
  ev(84, { 0: [0, 33514245625n, 0, 0, 0], 1: 1, 2: 124233120, 3: 143667680 })
  ev(497, { 0: 0, 1: 21567, 2: 2396, 3: 7189, 4: 5208, 5: 315, 6: 1736, 7: 480521792, 9: 2 })
  ev(85, { 0: 3, 2: 7, 3: 5208, 5: 0, 9: 480521792 })

  const pick = (t) => lines.find((l) => l.t === t)

  assert.deepEqual({ gained: pick('respec').gained, paid: pick('respec').paid }, { gained: 124233120, paid: 143667680 })
  assert.deepEqual(
    { might: pick('might').might, favor: pick('might').favor, might_premium: pick('might').might_premium },
    { might: 21567, favor: 5208, might_premium: 7189 }
  )
  assert.deepEqual({ city: pick('faction').city, gained: pick('faction').gained, total: pick('faction').total }, { city: 7, gained: 5208, total: 480521792 })
})

test('a payload in a shape the tracker does not know is ignored, not guessed at', () => {
  const { lines, ev, activity } = tracker()

  activity.onResponse({ parameters: { 0: 'not-an-id', 253: 2 } }) // a Join without its fields
  ev(82, { 0: ME }) // fame without a gain
  ev(61, { 0: ME }) // a harvest without an item

  assert.equal(lines.length, 0)
})

test('the file sits beside the loot log and is named after it', () => {
  assert.equal(
    activityFileFor('/Users/me/Library/Application Support/Guild Butler Capture/loot-events-2026-09-18-17-43-51.txt'),
    '/Users/me/Library/Application Support/Guild Butler Capture/activity-events-2026-09-18-17-43-51.jsonl'
  )
})

test('the log writes nothing unless it is switched on', () => {
  const log = new ActivityLog({ enabled: false, lootFile: () => '/nowhere/loot-events-x.txt' })

  assert.equal(log.write({ t: 'fame' }), false)
  assert.equal(log.linesWritten, 0)
  assert.equal(log.fileName, null)
})
