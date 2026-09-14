const test = require('node:test')
const assert = require('node:assert')

const { fresh } = require('./helpers')

/**
 * Which server a message came from.
 *
 * The rotation and the guild's state arrive in the burst that follows a login. ServerRegion's
 * current server waits five seconds of packets before it believes a switch, so after a switch
 * those lines went out under the server the player had just LEFT, and the bot stored them there:
 * on 2026-09-12 Europe's day ended up holding four production bonuses, two of them most likely
 * another server's. They now carry the server of the packet that brought them. The debounced
 * value stays what it was, for what it is good at — the window title and the loot file.
 */

const EUROPE = { id: 3, name: 'Europe', region: 'Europe' }
const AMERICAS_IP = '5.188.125.40'
const EUROPE_IP = '193.169.238.12'
const HOME = '192.168.1.20'

/** A rotation's shape: two production bonuses for one day. */
const FESTIVITIES = {
  parameters: {
    0: [2, 2],
    1: ['GENERAL', 'GENERAL'],
    2: ['COMMON_FROSTSTAFF', 'COMMON_HOLYSTAFF'],
    3: [639238536000000000, 639238536000000000],
    4: [639239400000000000, 639239400000000000],
    252: 519
  }
}

/** The guild's state, reduced to what the handler reads. */
const GUILD_STATE = { parameters: { 15: 'VITRYLA', 16: 'UA', 19: { 0: 12910000 }, 252: 103 } }

/** The drain response, as guild-energy.test.js has it verbatim. */
const DRAIN = {
  parameters: {
    0: [228, 231, 114, 118, 37, 191, 228, 70, 188, 251, 239, 178, 51, 123, 202, 45],
    1: 5,
    2: 11,
    253: 414
  }
}

/** Collect what one console method printed, and put it back afterwards. */
const capture = (t, method) => {
  const real = console[method]
  const lines = []

  console[method] = (line) => lines.push(String(line))
  t.after(() => {
    console[method] = real
  })

  return lines
}

const parseLine = (line, tag) => {
  assert.ok(line.startsWith(`[${tag}] `), `expected a [${tag}] line, got: ${line}`)

  return JSON.parse(line.slice(tag.length + 3))
}

/** Fresh modules, and a detector settled on Europe the way a long session leaves it. */
const settledOnEurope = (t) => {
  const modules = fresh()
  const ServerRegion = require('../src/network/server-region')

  ServerRegion.setServer(EUROPE)
  // The debounce is a real timer; a pending one would hold the test process open.
  t.after(() => ServerRegion.reset())

  return { ...modules, ServerRegion }
}

test('a rotation read in the first seconds after a switch carries the server that sent it', (t) => {
  const { EvFestivitiesUpdate, ServerRegion } = settledOnEurope(t)
  const lines = capture(t, 'info')

  // The first packet from the Americas: a switch the debounce has not believed yet.
  ServerRegion.processPacket({ srcaddr: AMERICAS_IP, dstaddr: HOME })
  assert.equal(ServerRegion.getCurrentServer().region, 'Europe')

  EvFestivitiesUpdate.handle(FESTIVITIES)

  assert.equal(parseLine(lines[0], 'festivities').server, 'americas')
})

test('a rotation from a settled session is labelled as it always was', (t) => {
  const { EvFestivitiesUpdate, ServerRegion } = settledOnEurope(t)
  const lines = capture(t, 'info')

  ServerRegion.processPacket({ srcaddr: EUROPE_IP, dstaddr: HOME })
  EvFestivitiesUpdate.handle(FESTIVITIES)

  assert.equal(parseLine(lines[0], 'festivities').server, 'europe')
})

test('a rotation from an address no range knows goes out unlabelled, and says why', (t) => {
  const { EvFestivitiesUpdate, ServerRegion } = settledOnEurope(t)
  const lines = capture(t, 'info')
  const warnings = capture(t, 'warn')

  ServerRegion.processPacket({ srcaddr: '203.0.113.9', dstaddr: HOME })
  EvFestivitiesUpdate.handle(FESTIVITIES)

  // Never the last good server. The bot refuses a missing label; a wrong one it would store.
  assert.equal(parseLine(lines[0], 'festivities').server, null)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /203\.0\.113\.9/)
  // And the warning cannot be read as the machine-read line.
  assert.ok(!warnings[0].startsWith('[festivities] '))
})

test('a packet the client sends is placed by where it is going', (t) => {
  const { ServerRegion } = settledOnEurope(t)

  ServerRegion.processPacket({ srcaddr: HOME, dstaddr: AMERICAS_IP })

  assert.equal(ServerRegion.getPacketRegionToken(), 'americas')
})

test('the guild state in the same login burst is labelled the same way', (t) => {
  const { EvGuildState, ServerRegion } = settledOnEurope(t)
  const lines = capture(t, 'info')

  ServerRegion.processPacket({ srcaddr: AMERICAS_IP, dstaddr: HOME })
  EvGuildState.handle(GUILD_STATE, 0)

  assert.equal(parseLine(lines[0], 'energy').server, 'americas')
})

test('so is a guild screen response', (t) => {
  const { OpGuildEnergyDrain, ServerRegion } = settledOnEurope(t)
  const lines = capture(t, 'info')

  ServerRegion.processPacket({ srcaddr: AMERICAS_IP, dstaddr: HOME })
  OpGuildEnergyDrain.handle(DRAIN)

  assert.equal(parseLine(lines[0], 'energy-drain').server, 'americas')
})

test('the settled server is untouched: it still waits for a switch to hold', (t) => {
  const { ServerRegion } = settledOnEurope(t)

  ServerRegion.processPacket({ srcaddr: AMERICAS_IP, dstaddr: HOME })

  // The window title and the loot file's column want where the player IS, and one packet is not
  // a move — so that value still lags, by design.
  assert.equal(ServerRegion.getCurrentServer().region, 'Europe')
  assert.equal(ServerRegion.getPacketServer().region, 'Americas')
})

test('restarting the listeners forgets the packet too', (t) => {
  const { ServerRegion } = settledOnEurope(t)

  ServerRegion.processPacket({ srcaddr: EUROPE_IP, dstaddr: HOME })
  ServerRegion.reset()

  assert.equal(ServerRegion.getPacketServer(), null)
  assert.equal(ServerRegion.getPacketSource(), null)
})
