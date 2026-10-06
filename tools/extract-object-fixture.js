#!/usr/bin/env node
/**
 * Cut the life of ONE object id out of a session recording — a scrubbed fixture in the manner of
 * tools/extract-trade-fixture.js, and like it the only way a recording's contents enter this repo.
 *
 *   node tools/extract-object-fixture.js <guild-dump.jsonl> --object 609 --from <ISO> --to <ISO> --out test/fixtures/<name>.jsonl
 *
 * An object id belongs to one map, and the next map numbers its objects afresh, so a single id can
 * be a chest item in one zone and the member's own gear in the next. This keeps what the loot path
 * sees of that id, between --from and --to:
 *   - every zone join (response 2), so a replay knows who and where the member was;
 *   - every announcement of the object (events 30, 31, 32) and every put of it (event 26);
 *   - every container attach (event 99) whose inventory holds it, each container's detach (100), the
 *     chest registrations under the same object ids (393), and the member's move requests (request 30)
 *     from or into those containers.
 * Each with only the parameters listed below. Numbers — object ids, item indexes, quantities,
 * qualities, slots — are game data and stay; so do chest names (393), which name a kind of chest.
 *
 * Rewritten, because a recording names people and places that never agreed to be in a test:
 *   - the member → "Me"; their guild → "OurGuild"; their alliance → "OurAlliance"; their GUID → fixed
 *   - every other GUID (containers, the member's own bags) → a stable fake, the same GUID the same fake
 *   - a crafter (parameter 6 of event 30) → "Me" when it is the member, else "Crafter1", …
 *   - hideout and island instance ids in zone strings → a stable fake, as the other extractors do
 * A string anywhere else stops the run, and the output is checked for every real name it replaced
 * before it is saved.
 */

'use strict'

const fs = require('fs')
const readline = require('readline')
const crypto = require('crypto')

const { ME_GUID } = require('./extract-trade-fixture')

// code -> parameters kept (252/253 always). A join also keeps every GUID it carries — the
// member's own containers, which OwnContainers.learnFromJoin reads by shape, not by index.
const EVENTS = {
  26: ['0', '1', '2', '3'],
  30: ['0', '1', '2', '6', '7'],
  31: ['0', '1', '2'],
  32: ['0', '1', '2'],
  99: ['0', '1', '3', '4', '5'],
  100: ['0'],
  393: ['0', '3']
}
const REQUESTS = { 30: ['0', '1', '2', '3', '4', '5'] }
const RESPONSES = { 2: ['0', '2', '8', '58', '79'] }

const parseArgs = (argv) => {
  const out = { input: null, object: null, from: null, to: null, output: null }

  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--object') {
      out.object = Number(argv[++i])
    } else if (argv[i] === '--from') {
      out.from = Date.parse(argv[++i])
    } else if (argv[i] === '--to') {
      out.to = Date.parse(argv[++i])
    } else if (argv[i] === '--out') {
      out.output = argv[++i]
    } else {
      out.input = argv[i]
    }
  }

  return out
}

const isGuid = (value) =>
  Array.isArray(value) && value.length === 16 && value.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)

const hex = (bytes) => bytes.map((b) => b.toString(16).padStart(2, '0')).join('')

const fakeUuids = (text) =>
  text.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, (uuid) => {
    const h = crypto.createHash('sha256').update(`fixture:${uuid}`).digest('hex')

    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
  })

const scrubber = () => {
  const replaced = new Set() // every real string replaced, for the final check
  const crafters = new Map()
  let myGuid = null
  let self = null

  const fakeGuid = (bytes, where) => {
    if (!isGuid(bytes)) {
      throw new Error(`${where}: expected a GUID`)
    }

    if (hex(bytes) === myGuid) {
      return ME_GUID
    }

    const digest = crypto.createHash('sha256').update(`fixture-guid:${hex(bytes)}`).digest()

    return Array.from(digest.subarray(0, 16))
  }

  const crafter = (name) => {
    if (name === self) {
      return 'Me'
    }

    if (!crafters.has(name)) {
      crafters.set(name, `Crafter${crafters.size + 1}`)
    }

    replaced.add(name)

    return crafters.get(name)
  }

  /** No string may survive that this file did not put there. */
  const assertNoText = (value, where) => {
    if (typeof value === 'string') {
      throw new Error(`${where}: unexpected text — extend the scrubber before keeping it`)
    }

    if (Array.isArray(value)) {
      value.forEach((entry) => assertNoText(entry, where))
    } else if (value != null && typeof value === 'object') {
      Object.values(value).forEach((entry) => assertNoText(entry, where))
    }
  }

  const scrub = (record) => {
    const code = Number(record.id)
    const allow = record.kind === 'event' ? EVENTS[code] : record.kind === 'request' ? REQUESTS[code] : RESPONSES[code]
    const where = `${record.at} ${record.kind} ${code}`
    const payload = {}

    for (const key of allow) {
      if (key in record.payload) {
        payload[key] = record.payload[key]
      }
    }

    if (record.kind === 'response' && code === 2) {
      self = payload['2']
      myGuid = isGuid(record.payload['1']) ? hex(record.payload['1']) : null
      replaced.add(self)
      payload['2'] = 'Me'

      for (const [key, value] of Object.entries(record.payload)) {
        if (isGuid(value)) {
          payload[key] = fakeGuid(value, where)
        }
      }

      if (typeof payload['58'] === 'string' && payload['58'] !== '') {
        replaced.add(payload['58'])
        payload['58'] = 'OurGuild'
      }

      if (typeof payload['79'] === 'string' && payload['79'] !== '') {
        replaced.add(payload['79'])
        payload['79'] = 'OurAlliance'
      }

      if (typeof payload['8'] === 'string') {
        payload['8'] = fakeUuids(payload['8'])
      }
    } else if (record.kind === 'event' && code === 30) {
      if (typeof payload['6'] === 'string') {
        payload['6'] = crafter(payload['6'])
      }

      assertNoText({ ...payload, 6: null }, where)
    } else if (record.kind === 'event' && code === 393) {
      if (typeof payload['3'] !== 'string' || !/^[A-Z0-9_@]+$/.test(payload['3'])) {
        throw new Error(`${where}: a chest name was expected — extend the scrubber before keeping it`)
      }

      assertNoText({ ...payload, 3: null }, where)
    } else {
      for (const key of ['1', '2', '4']) {
        if (isGuid(payload[key])) {
          payload[key] = fakeGuid(payload[key], where)
        }
      }

      if (record.kind === 'event' && code === 100) {
        payload['0'] = fakeGuid(payload['0'], where)
      }

      assertNoText(payload, where)
    }

    payload[record.kind === 'event' ? '252' : '253'] = code

    return { at: record.at, kind: record.kind, id: code, payload }
  }

  return { scrub, replaced: () => replaced }
}

const records = async function* (input) {
  const rl = readline.createInterface({ input: fs.createReadStream(input), crlfDelay: Infinity })

  for await (const line of rl) {
    const m = /"at":"([^"]+)","kind":"(event|request|response)","id":(\d+)/.exec(line)

    if (m != null) {
      yield { at: Date.parse(m[1]), kind: m[2], code: Number(m[3]), line }
    }
  }
}

const main = async () => {
  const { input, object, from, to, output } = parseArgs(process.argv.slice(2))

  if (input == null || !Number.isInteger(object) || Number.isNaN(from) || Number.isNaN(to) || output == null) {
    console.error('usage: node tools/extract-object-fixture.js <guild-dump.jsonl> --object <id> --from <ISO> --to <ISO> --out <fixture.jsonl>')
    process.exit(2)
  }

  const inWindow = (at) => at >= from && at <= to

  // Pass 1: which containers held the object — by object id (for their registrations) and by GUID.
  const containerIds = new Set()
  const containerGuids = new Set()

  for await (const r of records(input)) {
    if (inWindow(r.at) && r.kind === 'event' && r.code === 99 && r.line.includes(String(object))) {
      const { payload } = JSON.parse(r.line)

      if (Array.isArray(payload['3']) && payload['3'].includes(object) && isGuid(payload['1'])) {
        containerIds.add(payload['0'])
        containerGuids.add(hex(payload['1']))
      }
    }
  }

  const ofObject = (payload) => payload['0'] === object
  const keep = (kind, code, payload) => {
    if (kind === 'response') {
      return code === 2
    }

    if (kind === 'request') {
      return code === 30 && [payload['1'], payload['4']].some((g) => isGuid(g) && containerGuids.has(hex(g)))
    }

    switch (code) {
      case 26:
      case 30:
      case 31:
      case 32:
        return ofObject(payload)
      case 99:
        return Array.isArray(payload['3']) && payload['3'].includes(object)
      case 100:
        return isGuid(payload['0']) && containerGuids.has(hex(payload['0']))
      case 393:
        return containerIds.has(payload['0'])
      default:
        return false
    }
  }

  // Pass 2: the records themselves.
  const { scrub, replaced } = scrubber()
  const lines = []

  for await (const r of records(input)) {
    if (!inWindow(r.at)) {
      continue
    }

    const allow = r.kind === 'event' ? EVENTS[r.code] : r.kind === 'request' ? REQUESTS[r.code] : RESPONSES[r.code]

    if (allow == null) {
      continue
    }

    const record = JSON.parse(r.line)

    if (keep(r.kind, r.code, record.payload)) {
      lines.push(scrub(record))
    }
  }

  const text = `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`

  for (const name of replaced()) {
    if (text.includes(JSON.stringify(name))) {
      throw new Error('a real name survived the scrub — nothing written')
    }
  }

  fs.writeFileSync(output, text)
  console.log(`${lines.length} records, object ${object} in ${containerIds.size} container(s) → ${output}`)
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}

module.exports = { EVENTS, REQUESTS, RESPONSES, scrubber }
