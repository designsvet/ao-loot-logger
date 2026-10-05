const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { fresh, useFakeClock } = require('./helpers')

// Every re-require of loot-logger registers a process exit handler.
process.setMaxListeners(80)

/**
 * Every player-trade packet of the owner's recordings of 2026-09-16 and 2026-09-21 — eight trades:
 * five silver payouts, two item trades, a potion hand-over, and one the partner offered and then
 * cancelled — replayed through the real dispatcher, and the trade file compared line for line.
 *
 * The fixture was cut by tools/extract-trade-fixture.js: the member is "Me", the partners are
 * Partner1…7 in order of appearance (the same person twice is the same placeholder), the guild is
 * "OurGuild", crafter names are Crafter1…, hideout and island ids are faked. Numbers are as recorded.
 * The 09-16 recording predates the recorder keeping return codes (2026-09-18), so its invite responses
 * carry none; those six invitations led to finished trades, so they were accepted — fed here as 0.
 *
 * Item names come from the table the engine had cached on 2026-09-21 (fixtures/trade-items.json),
 * never from the network: the table is positional and the next patch renumbers it.
 */

const FIXTURES = path.join(__dirname, 'fixtures')
const ITEMS = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'trade-items.json'), 'utf8')).items

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

const replay = async (t) => {
  const mods = fresh()
  const clock = { at: 0 }
  const DataHandler = require('../src/data-handler/data-handler')
  const ParseHealth = require('../src/storage/parse-health')
  const ServerRegion = require('../src/network/server-region')
  const Trades = require('../src/trades')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trade-replay-'))
  const lootFile = path.join(dir, 'loot-events-2026-09-16-14-43-52.txt')
  const printed = []

  useFakeClock(t) // restores Date.now afterwards; the replay sets it per record below
  Date.now = () => clock.at

  mods.Logger.debug = () => {}
  mods.Logger.warn = () => {}
  mods.Items.use({
    items: Object.fromEntries(Object.entries(ITEMS).map(([index, entry]) => [index, { itemNumId: Number(index), ...entry }])),
    count: Object.keys(ITEMS).length,
    digest: 'fixture',
    etag: 'fixture'
  })
  ServerRegion.setServer({ id: 3, name: 'Europe', region: 'Europe' })
  // Every recorded packet came from Europe's range; the record reads the packet's region token.
  ServerRegion.processPacket({ srcaddr: '193.169.238.10', dstaddr: '192.168.1.2' })
  Trades.log.enabled = true
  Trades.log.lootFile = () => lootFile
  Trades.print = (line) => printed.push(line)

  const records = fs
    .readFileSync(path.join(FIXTURES, 'trades-2026-09-16-21.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))

  for (const record of records) {
    clock.at = Date.parse(record.at)

    const parameters = revive(record.payload)

    if (record.kind === 'event') {
      DataHandler.handleEventData({ parameters })
    } else if (record.kind === 'request') {
      DataHandler.handleRequestData({ parameters })
    } else {
      DataHandler.handleResponseData({ parameters, returnCode: record.rc ?? 0 })
    }
  }

  await new Promise((resolve) => Trades.log.close(resolve))
  ServerRegion.reset()

  const file = path.join(dir, 'trade-events-2026-09-16-14-43-52.jsonl')
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n')

  return {
    lines,
    printed: printed.map((line) => line.replace(/\x1b\[[0-9;]*m/g, '')), // eslint-disable-line no-control-regex
    records,
    statusLine: ParseHealth.statusLine(),
    open: Trades.machine.size()
  }
}

const SELF = { name: 'Me', guild: 'OurGuild', alliance: 'OurAlliance' }
const HIDEOUT = '@HIDEOUT@1354@314c8461-1bf5-7be9-eebe-c29129d0616f'
const partner = (n) => ({ name: `Partner${n}`, guild: 'OurGuild', hidden: false })
const silverPayout = (at, zone, tradeId, n, revision, silverGave) => ({
  v: 1,
  t: 'trade',
  at,
  server: 'europe',
  zone,
  tradeId,
  initiator: 'self',
  self: SELF,
  partner: partner(n),
  revision,
  acceptedRevision: revision,
  complete: true,
  gave: [],
  got: [],
  silverGave,
  silverGot: 0
})

/** What the recordings hold, written out by hand from the research notes — not from this code's output. */
const EXPECTED = [
  silverPayout('2026-09-16T15:25:52.210Z', HIDEOUT, 295, 1, 10, 60000000),
  silverPayout('2026-09-16T15:28:43.301Z', HIDEOUT, 298, 2, 13, 41956000),
  silverPayout('2026-09-16T15:29:57.357Z', HIDEOUT, 300, 3, 12, 16678000),
  {
    v: 1,
    t: 'trade',
    at: '2026-09-16T17:46:26.095Z',
    server: 'europe',
    zone: '@ISLAND@0348586a-f6d4-04ec-b303-b66b5e4c7217',
    tradeId: 327,
    initiator: 'self',
    self: SELF,
    partner: partner(4),
    revision: 22,
    acceptedRevision: 22,
    complete: true,
    // Seven pieces went in and five came back out; the two stacks that stayed are the trade.
    gave: [
      { index: 9484, item: 'T8_2H_KNUCKLES_SET3', qty: 4, quality: 4 },
      { index: 9484, item: 'T8_2H_KNUCKLES_SET3', qty: 5, quality: 3 }
    ],
    got: [],
    silverGave: 0,
    silverGot: 5000000
  },
  silverPayout('2026-09-16T17:51:28.426Z', '@ISLAND@61639f98-d9f7-1251-827e-daa6a624d40d', 377, 5, 9, 5436000),
  {
    v: 1,
    t: 'trade',
    at: '2026-09-16T18:52:27.045Z',
    server: 'europe',
    zone: HIDEOUT,
    tradeId: 459,
    initiator: 'self',
    self: SELF,
    partner: partner(6),
    revision: 10,
    acceptedRevision: 10,
    complete: true,
    gave: [
      { index: 9233, item: 'T8_MAIN_MACE', qty: 1, quality: 4 },
      { index: 9225, item: 'T6_MAIN_MACE@2', qty: 1, quality: 4 }
    ],
    got: [],
    silverGave: 0,
    silverGot: 10000
  },
  // Trade 1250 (09-16 19:04, the partner's invitation, two items offered) was cancelled: no line.
  {
    v: 1,
    t: 'trade',
    at: '2026-09-21T18:14:36.986Z',
    server: 'europe',
    zone: '2218',
    tradeId: 1766,
    initiator: 'self',
    self: SELF,
    partner: partner(7),
    revision: 3,
    acceptedRevision: 3,
    complete: true,
    gave: [{ index: 570, item: 'T7_POTION_REVIVE', qty: 11, quality: 1 }],
    got: [],
    silverGave: 0,
    silverGot: 0
  }
]

test('2026-09-16/21: the seven finished trades are the seven lines of the trade file, exactly', async (t) => {
  const { lines } = await replay(t)

  assert.deepEqual(lines, EXPECTED.map((record) => JSON.stringify(record)))
})

test('2026-09-16: the cancelled offer leaves no trace — not its items, not its partner', async (t) => {
  const { lines, records } = await replay(t)
  const text = lines.join('\n')

  // The partner of 1250 is Partner2, who also took a silver payout (298); the offer is the two items.
  assert.ok(records.some((r) => r.kind === 'event' && r.id === 178 && r.payload['0'] === 1250))
  assert.doesNotMatch(text, /"tradeId":1250|2587|3035/)
})

test('2026-09-16/21: no crafter, object id or durability reaches the file', async (t) => {
  const { lines } = await replay(t)
  const text = lines.join('\n')

  assert.doesNotMatch(text, /Crafter\d|"Me","Me"|643240000|683440000|212924|212112/)
  assert.doesNotMatch(text, /"(objId|crafter|durability|spells|passives)"/)
})

test('2026-09-16/21: the console says each trade in words, and the decoder stayed healthy', async (t) => {
  const { printed, statusLine, open } = await replay(t)

  assert.equal(printed.length, 7)
  assert.equal(printed[0], '15:25:52 UTC: {OurAlliance} [OurGuild] Me traded 60,000,000 silver to [OurGuild] Partner1.')
  assert.equal(
    printed[3],
    "17:46:26 UTC: {OurAlliance} [OurGuild] Me traded 4x Elder's Spiked Gauntlets, 5x Elder's Spiked Gauntlets to [OurGuild] Partner4 for 5,000,000 silver."
  )
  assert.equal(printed[6], '18:14:36 UTC: {OurAlliance} [OurGuild] Me traded 11x Major Gigantify Potion to [OurGuild] Partner7.')
  assert.equal(statusLine, '[health] parse ok')
  assert.equal(open, 0)
})
