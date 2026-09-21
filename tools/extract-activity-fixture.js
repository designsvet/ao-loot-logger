#!/usr/bin/env node
/**
 * Cut a small, scrubbed test fixture out of a session recording — the ONLY way a recording's
 * contents enter this repo. Raw recordings never do: they carry strangers' chat, names, guilds
 * and character ids (see .gitignore).
 *
 *   node tools/extract-activity-fixture.js <guild-dump.jsonl> <out.jsonl> --from 14:43 --to 15:05 [--from … --to …]
 *
 * Kept: only the packets the activity tracker reads (src/activity/activity.js), and within each
 * only the parameters it reads — an allow-list per code, so a field nobody looked at cannot ride
 * along. Rewritten: the member's name becomes "Me"; every character GUID becomes a stable fake
 * (the member's own is fixed, so the chest rule still finds it); a mob's owning-guild name is
 * dropped. Numbers, item and mob indexes, zone ids and chest names are game data and stay.
 */

'use strict'

const fs = require('fs')
const readline = require('readline')
const crypto = require('crypto')

const ME_GUID = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]

// code -> parameters kept (252/253 always)
const EVENTS = {
  6: ['0', '1', '2', '3', '4', '5', '6', '7'],
  7: ['0', '1', '2', '3', '4', '5', '6', '7'],
  61: ['0', '1', '2', '3', '4', '5', '6', '7', '8'],
  62: ['0', '1', '2', '3', '4', '5', '6', '7', '8'],
  82: ['0', '1', '2', '3', '4', '5', '6', '10', '15', '16'],
  84: ['0', '1', '2', '3'],
  85: ['0', '2', '3', '4', '5', '6', '8', '9'],
  123: ['0', '1', '13', '14'],
  267: ['1', '3'],
  355: ['0', '1', '2', '3', '4'],
  393: ['0', '3', '21', '23'],
  394: ['0', '1', '3'],
  497: ['0', '1', '2', '3', '4', '5', '6', '7']
}
const RESPONSES = { 2: ['0', '1', '2', '8', '35'] }

const parseArgs = (argv) => {
  const out = { input: null, output: null, windows: [] }
  let from = null

  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--from') {
      from = argv[++i]
    } else if (argv[i] === '--to') {
      out.windows.push([from, argv[++i]])
      from = null
    } else if (out.input == null) {
      out.input = argv[i]
    } else {
      out.output = argv[i]
    }
  }

  return out
}

/** `HH:MM` (UTC) inside any window? No windows means everything. */
const inWindows = (at, windows) => {
  if (windows.length === 0) {
    return true
  }

  const hhmm = at.slice(11, 16)

  return windows.some(([from, to]) => hhmm >= from && hhmm < to)
}

const scrubber = () => {
  let myGuid = null
  const fakes = new Map()

  const fakeGuid = (hex) => {
    if (hex === myGuid) {
      return ME_GUID
    }

    if (!fakes.has(hex)) {
      fakes.set(hex, [...crypto.createHash('sha256').update(`fixture:${hex}`).digest().subarray(0, 16)])
    }

    return fakes.get(hex)
  }

  const guidHexes = (bytes) => {
    const out = []

    for (let i = 0; i + 16 <= bytes.length; i += 16) {
      out.push(Buffer.from(bytes.slice(i, i + 16)).toString('hex'))
    }

    return out
  }

  return (record) => {
    const code = Number(record.id)
    const allow = record.kind === 'response' ? RESPONSES[code] : record.kind === 'event' ? EVENTS[code] : null

    if (allow == null) {
      return null
    }

    const payload = {}

    for (const key of allow) {
      if (key in record.payload) {
        payload[key] = record.payload[key]
      }
    }

    payload[record.kind === 'event' ? '252' : '253'] = code

    // Instance ids inside zone strings (`@HIDEOUT@1354@<uuid>`) name one guild's hideout: fake them, stably.
    for (const [key, value] of Object.entries(payload)) {
      if (typeof value === 'string') {
        payload[key] = value.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, (uuid) => {
          const h = crypto.createHash('sha256').update(`fixture:${uuid}`).digest('hex')

          return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
        })
      }
    }

    if (record.kind === 'response' && code === 2) {
      myGuid = Array.isArray(payload['1']) ? Buffer.from(payload['1']).toString('hex') : myGuid
      payload['1'] = ME_GUID
      payload['2'] = 'Me'
    }

    if (record.kind === 'event' && code === 394 && Array.isArray(payload['3'])) {
      payload['3'] = guidHexes(payload['3']).flatMap(fakeGuid)
    }

    return { at: record.at, kind: record.kind, id: code, payload }
  }
}

const main = async () => {
  const { input, output, windows } = parseArgs(process.argv.slice(2))

  if (input == null || output == null) {
    console.error('usage: node tools/extract-activity-fixture.js <guild-dump.jsonl> <out.jsonl> [--from HH:MM --to HH:MM]…')
    process.exit(2)
  }

  const scrub = scrubber()
  const lines = []
  const rl = readline.createInterface({ input: fs.createReadStream(input), crlfDelay: Infinity })

  for await (const line of rl) {
    const m = /"at":"([^"]+)","kind":"(event|response)","id":(\d+)/.exec(line)

    if (m == null) {
      continue
    }

    const code = Number(m[3])
    const wanted = m[2] === 'response' ? code in RESPONSES : code in EVENTS

    // Joins are kept everywhere: every window needs to know whose id is whose.
    if (!wanted || (!(m[2] === 'response' && code === 2) && !inWindows(m[1], windows))) {
      continue
    }

    const kept = scrub(JSON.parse(line))

    if (kept != null) {
      lines.push(JSON.stringify(kept))
    }
  }

  fs.writeFileSync(output, `${lines.join('\n')}\n`)
  console.log(`${lines.length} records → ${output}`)
}

if (require.main === module) {
  main()
}

module.exports = { EVENTS, RESPONSES, ME_GUID }
