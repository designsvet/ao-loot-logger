#!/usr/bin/env node
/**
 * Cut a scrubbed player-trade fixture out of session recordings — the trade counterpart of
 * tools/extract-activity-fixture.js, and like it the ONLY way a recording's contents enter this repo.
 *
 *   node tools/extract-trade-fixture.js <guild-dump.jsonl>… --out test/fixtures/<name>.jsonl
 *
 * Kept: every player-trade packet (events 176–181, requests 161–167, the response to 161), each
 * with only the parameters listed below; the zone join in force before each trade (response 2), so a
 * replay knows who and where the member was; and any character the game MASKED (event 29 named
 * `PA`), so a replay of an Ancient Lands trade sees the zone as masked. Numbers — trade ids,
 * revisions, item indexes, quantities, qualities, silver, object ids — are game data and stay.
 *
 * Rewritten, because a trade names people who never agreed to be in a test:
 *   - the member → "Me"; their guild → "OurGuild"; their alliance → "OurAlliance"; their GUID → fixed
 *   - each partner → "Partner1", "Partner2", … in order of appearance (the same person, the same name)
 *   - any other guild → "Guild1", …
 *   - crafter names (parameters 9 and 19 of an update — third parties) → the member's or partner's
 *     placeholder when it is one of them, else "Crafter1", …; an empty crafter stays empty
 *   - hideout instance ids in zone strings → a stable fake, as the activity extractor does
 * The masking name `PA` is not a person and stays. A string anywhere else stops the run: nothing
 * unexpected is written, and the output is checked for every real name it replaced before it is saved.
 */

'use strict'

const fs = require('fs')
const readline = require('readline')
const crypto = require('crypto')

const ME_GUID = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]
const MASK = 'PA'

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => String(from + i))

// code -> parameters kept (252/253 always)
const EVENTS = {
  29: ['0', '1'], // only a masked character is kept at all
  176: ['0', '1', '2', '3', '4', '5', '6'],
  177: ['0'],
  178: ['0'],
  179: range(0, 26),
  180: ['0'],
  181: ['0', '1', '2']
}
const REQUESTS = {
  161: ['0'],
  162: ['0'],
  163: ['0'],
  164: ['0', '1', '2'],
  165: ['0', '1'],
  166: ['0', '1', '2'],
  167: ['0', '1']
}
const RESPONSES = {
  2: ['0', '1', '2', '8', '58', '79'],
  161: ['0', '1', '2', '3', '4', '5', '6']
}

const parseArgs = (argv) => {
  const out = { inputs: [], output: null }

  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') {
      out.output = argv[++i]
    } else {
      out.inputs.push(argv[i])
    }
  }

  return out
}

const fakeUuids = (text) =>
  text.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, (uuid) => {
    const h = crypto.createHash('sha256').update(`fixture:${uuid}`).digest('hex')

    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
  })

const scrubber = () => {
  const people = new Map() // real name -> placeholder
  const guilds = new Map()
  const replaced = new Set() // every real string replaced, for the final check
  let self = null // { name, guild, alliance } as the last join had them
  let partners = 0
  let crafters = 0
  let otherGuilds = 0

  const person = (name, kind) => {
    if (name === '' || name === MASK) {
      return name
    }

    if (!people.has(name)) {
      if (kind === 'partner') {
        partners += 1
        people.set(name, `Partner${partners}`)
      } else {
        crafters += 1
        people.set(name, `Crafter${crafters}`)
      }
    }

    replaced.add(name)

    return people.get(name)
  }

  const guild = (name) => {
    if (name == null || name === '') {
      return name
    }

    if (!guilds.has(name)) {
      otherGuilds += 1
      guilds.set(name, `Guild${otherGuilds}`)
    }

    replaced.add(name)

    return guilds.get(name)
  }

  const strings = (value, map, where) => {
    if (!Array.isArray(value)) {
      throw new Error(`${where}: expected an array of strings`)
    }

    return value.map((entry) => {
      if (typeof entry !== 'string') {
        throw new Error(`${where}: expected an array of strings`)
      }

      return map(entry)
    })
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
      self = { name: payload['2'], guild: payload['58'], alliance: payload['79'] }
      people.set(self.name, 'Me')
      replaced.add(self.name)

      if (typeof self.guild === 'string' && self.guild !== '') {
        guilds.set(self.guild, 'OurGuild')
        replaced.add(self.guild)
      }

      payload['1'] = ME_GUID
      payload['2'] = 'Me'

      if ('58' in payload) {
        payload['58'] = payload['58'] === '' ? '' : 'OurGuild'
      }

      if ('79' in payload) {
        if (typeof payload['79'] === 'string' && payload['79'] !== '') {
          replaced.add(payload['79'])
          payload['79'] = 'OurAlliance'
        }
      }

      if (typeof payload['8'] === 'string') {
        payload['8'] = fakeUuids(payload['8'])
      }
    } else if ((record.kind === 'response' && code === 161) || (record.kind === 'event' && code === 176)) {
      payload['1'] = typeof payload['1'] === 'string' ? person(payload['1'], 'partner') : payload['1']
      payload['2'] = typeof payload['2'] === 'string' ? guild(payload['2']) : payload['2']
      assertNoText({ ...payload, 1: null, 2: null }, where)
    } else if (record.kind === 'event' && code === 179) {
      for (const key of ['9', '19']) {
        if (key in payload) {
          payload[key] = strings(payload[key], (name) => person(name, 'crafter'), `${where} p${key}`)
        }
      }

      for (const key of ['16', '26']) {
        if (key in payload) {
          payload[key] = strings(payload[key], (text) => (text === '' ? '' : 'Text'), `${where} p${key}`)
        }
      }

      assertNoText({ ...payload, 9: null, 19: null, 16: null, 26: null }, where)
    } else if (record.kind === 'event' && code === 29) {
      // Only the mask is ever kept; the caller drops every named character.
      assertNoText({ ...payload, 1: null }, where)
    } else {
      assertNoText(payload, where)
    }

    payload[record.kind === 'event' ? '252' : '253'] = code

    const out = { at: record.at, kind: record.kind, id: code, payload }

    if (record.rc != null) {
      out.rc = record.rc
    }

    return out
  }

  return { scrub, replaced: () => replaced }
}

const wanted = (kind, code) =>
  (kind === 'event' && code in EVENTS) || (kind === 'request' && code in REQUESTS) || (kind === 'response' && code in RESPONSES)

const main = async () => {
  const { inputs, output } = parseArgs(process.argv.slice(2))

  if (inputs.length === 0 || output == null) {
    console.error('usage: node tools/extract-trade-fixture.js <guild-dump.jsonl>… --out <fixture.jsonl>')
    process.exit(2)
  }

  const { scrub, replaced } = scrubber()
  const lines = []
  let trades = 0

  for (const input of inputs) {
    // The join in force: written once, just before the first trade packet that follows it.
    let join = null
    let joinWritten = false
    let lastMaskAt = -Infinity
    const rl = readline.createInterface({ input: fs.createReadStream(input), crlfDelay: Infinity })

    for await (const line of rl) {
      const m = /"kind":"(event|request|response)","id":(\d+)/.exec(line)

      if (m == null || !wanted(m[1], Number(m[2]))) {
        continue
      }

      const record = JSON.parse(line)
      const code = Number(record.id)

      if (record.kind === 'response' && code === 2) {
        join = record
        joinWritten = false
        continue
      }

      // A masked character marks the zone. One a second is kept — enough to mark every zone, the
      // burst that arrives just BEFORE its join included (src/trades/player-trades.js), without the
      // bulk of a whole map's worth of them.
      if (record.kind === 'event' && code === 29) {
        const at = Date.parse(record.at)

        if (record.payload?.['1'] !== MASK || at - lastMaskAt < 1000) {
          continue
        }

        lastMaskAt = at
      }

      if (join != null && !joinWritten) {
        lines.push(scrub(join))
        joinWritten = true
      }

      if (record.kind === 'event' && code === 180) {
        trades += 1
      }

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
  console.log(`${lines.length} records, ${trades} finished trades → ${output}`)
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}

module.exports = { EVENTS, REQUESTS, RESPONSES, ME_GUID, scrubber }
