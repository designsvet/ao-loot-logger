const test = require('node:test')
const assert = require('node:assert')

const { fresh } = require('./helpers')
const { guidToAlbionId } = require('../src/utils/albion-guid')

/**
 * The guild's siphoned-energy total, and the id it has to be attributed to.
 *
 * Every payload below is VERBATIM from a recording of the live client made on
 * 2026-09-01 (VITRYLA, Europe) with the guild screen open beside it, so the numbers
 * here are checkable against a screenshot: 1,291 energy, 5 alliance territories,
 * 11 territory control cost.
 */

/** event 103, exactly as it arrived. */
const GUILD_STATE = {
  parameters: {
    10: 2,
    11: 509678573157,
    14: 1000,
    15: 'VITRYLA',
    16: 'UA',
    17: [226, 250, 195, 112, 165, 173, 48, 77, 150, 220, 152, 14, 218, 239, 16, 209],
    19: { 0: 12910000 },
    20: 1,
    21: 15,
    24: 16777215,
    32: '@HIDEOUT@1354@3baa6268-661d-4b0c-b141-b49779d76e5a',
    252: 103
  }
}

/** response 414, exactly as it arrived. */
const DRAIN = {
  parameters: {
    0: [228, 231, 114, 118, 37, 191, 228, 70, 188, 251, 239, 178, 51, 123, 202, 45],
    1: 5,
    2: 11,
    253: 414
  }
}

/** VITRYLA's id as Albion's public API reports it — the id the bot stores. */
const VITRYLA = 'dnLn5L8lRuS8---yM3vKLQ'

/** Collect what a handler printed, and put console.info back afterwards. */
const captureInfo = (t) => {
  const real = console.info
  const lines = []

  console.info = (line) => lines.push(String(line))
  t.after(() => {
    console.info = real
  })

  return lines
}

const parseLine = (line, tag) => {
  assert.ok(line.startsWith(`[${tag}] `), `expected a [${tag}] line, got: ${line}`)

  return JSON.parse(line.slice(tag.length + 3))
}

test('wire bytes become the id the public API uses', () => {
  assert.equal(guidToAlbionId(DRAIN.parameters[0]), VITRYLA)

  // The naive encoding of the SAME bytes. It looks like an id and matches nothing —
  // which is the entire reason this helper exists.
  assert.notEqual(Buffer.from(DRAIN.parameters[0]).toString('base64url'), VITRYLA)

  assert.equal(guidToAlbionId([1, 2, 3]), null)
  assert.equal(guidToAlbionId('nope'), null)
  assert.equal(guidToAlbionId(new Array(16).fill(300)), null)
})

test('the guild total is read off the state event', (t) => {
  const { EvGuildState } = fresh()
  const lines = captureInfo(t)

  EvGuildState.handle(GUILD_STATE, 1_000)

  const payload = parseLine(lines[0], 'energy')

  assert.equal(payload.guildName, 'VITRYLA')
  assert.equal(payload.allianceTag, 'UA')
  // Unconverted, exactly as the wire had it: 1,291 energy is 12910000 here, and the
  // reader owns the /10000 — the same rule the festivity ticks follow.
  assert.equal(payload.totalRaw, 12910000)
  assert.equal(payload.totalRaw / 10000, 1291)
  assert.deepEqual(payload.currencies, { 0: 12910000 })
  assert.equal(payload.changed, true)
  // No guild screen has been opened in this session, so there is no id to stamp. The
  // reader must cope with that rather than assume the name identifies the guild.
  assert.equal(payload.albionGuildId, null)
})

test('an unchanged total is not repeated, a changed one always is', (t) => {
  const { EvGuildState } = fresh()
  const lines = captureInfo(t)

  EvGuildState.handle(GUILD_STATE, 0)
  assert.equal(lines.length, 1)

  EvGuildState.handle(GUILD_STATE, 1000)
  EvGuildState.handle(GUILD_STATE, EvGuildState.UNCHANGED_REPEAT_MS - 1)
  assert.equal(lines.length, 1, 'an unchanged total inside the window is silence')

  EvGuildState.handle(GUILD_STATE, EvGuildState.UNCHANGED_REPEAT_MS + 1)
  assert.equal(lines.length, 2, 'and is repeated once the window passes')
  assert.equal(parseLine(lines[1], 'energy').changed, false)

  const moved = { parameters: { ...GUILD_STATE.parameters, 19: { 0: 12900000 } } }

  // A change is the thing income is derived from, so it is never suppressed.
  EvGuildState.handle(moved, EvGuildState.UNCHANGED_REPEAT_MS + 2)
  assert.equal(lines.length, 3)
  assert.equal(parseLine(lines[2], 'energy').changed, true)
  assert.equal(parseLine(lines[2], 'energy').totalRaw, 12900000)
})

test('a payload that is not guild state prints nothing', (t) => {
  const { EvGuildState } = fresh()
  const lines = captureInfo(t)

  // Codes are ordinals that game patches renumber. Every one of these must be silence,
  // not a line built out of another message's parameters.
  const rejects = [
    { parameters: { 252: 103 } },
    { parameters: { 15: 'VITRYLA', 252: 103 } }, // named, but no currencies
    { parameters: { 15: '', 19: { 0: 1 }, 252: 103 } },
    { parameters: { 15: 'VITRYLA', 19: {}, 252: 103 } },
    { parameters: { 15: 'VITRYLA', 19: { 1: 500 }, 252: 103 } }, // no key 0
    { parameters: { 15: 'VITRYLA', 19: { 0: -5 }, 252: 103 } },
    { parameters: { 15: 'VITRYLA', 19: { 0: 1.5 }, 252: 103 } },
    { parameters: { 15: 'VITRYLA', 19: 12910000, 252: 103 } },
    { parameters: { 15: 'VITRYLA', 16: 7, 19: { 0: 1 }, 252: 103 } }
  ]

  for (const event of rejects) {
    EvGuildState.handle(event, 0)
  }

  assert.deepEqual(lines, [])
})

test('a currency map decoded as a Map reads the same as an object', (t) => {
  const { EvGuildState } = fresh()
  const lines = captureInfo(t)

  EvGuildState.handle({ parameters: { ...GUILD_STATE.parameters, 19: new Map([[0, 12910000]]) } }, 0)

  assert.equal(parseLine(lines[0], 'energy').totalRaw, 12910000)
})

test('the drain response names the guild, and later energy lines carry it', (t) => {
  const { EvGuildState, OpGuildEnergyDrain, GuildIdentity } = fresh()
  const lines = captureInfo(t)

  assert.equal(GuildIdentity.getGuildId(), null)

  OpGuildEnergyDrain.handle(DRAIN)

  const drain = parseLine(lines[0], 'energy-drain')
  assert.equal(drain.albionGuildId, VITRYLA)
  assert.equal(drain.territories, 5)
  assert.equal(drain.controlCost, 11)
  assert.equal(GuildIdentity.getGuildId(), VITRYLA)

  EvGuildState.handle(GUILD_STATE, 0)
  assert.equal(parseLine(lines[1], 'energy').albionGuildId, VITRYLA)
})

test('a drain payload that is not one prints nothing and forgets nothing', (t) => {
  const { OpGuildEnergyDrain, GuildIdentity } = fresh()
  const lines = captureInfo(t)

  for (const event of [
    { parameters: { 253: 414 } },
    { parameters: { 0: [1, 2, 3], 1: 5, 2: 11, 253: 414 } },
    { parameters: { 0: DRAIN.parameters[0], 1: -1, 2: 11, 253: 414 } },
    { parameters: { 0: DRAIN.parameters[0], 1: 5, 2: 'eleven', 253: 414 } }
  ]) {
    OpGuildEnergyDrain.handle(event)
  }

  assert.deepEqual(lines, [])
  assert.equal(GuildIdentity.getGuildId(), null)
})

test('the alliance id is not mistaken for the guild id', () => {
  // Both are 16 bytes on the same event, and the alliance one sits where a reader
  // skimming the payload would reach for it first. This is the mistake the
  // investigation actually made.
  assert.notEqual(guidToAlbionId(GUILD_STATE.parameters[17]), VITRYLA)
})
