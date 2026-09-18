#!/usr/bin/env node
/**
 * Read a session recording (`guild-dump-*.jsonl`, written by `DUMP_PACKETS=session`
 * or the 120-second `g` window) and answer the questions the activity-stats plan
 * asks of a recording, without anyone grepping a file of forty thousand lines:
 *
 *   node tools/analyze-recording.js guild-dump-2026-09-10T19-02-44.jsonl --r1
 *   node tools/analyze-recording.js a.jsonl b.jsonl --r2 --code 176 --samples 3
 *
 * It prints: what the file holds (records, span, a code census with the reference
 * tool's names), the stat packets it looked for and the parameter shapes they came
 * in, the "whose object id is me" evidence, the market-mail timing, and a
 * pass/missing line per item of the R1 (open world) and R2 (city) checklists.
 *
 * It DECIDES nothing about the game: a name beside a code is the reference tool's
 * name for that ordinal on the current patch, and the checklists are the plan's own
 * words. `--json` prints the same findings as one object for a script to read.
 */

'use strict'

const fs = require('fs')
const path = require('path')

const CODES = require('./photon-codes.json')

// ── the packets the plan is about ────────────────────────────────────────────
//
// kind: event | request | response — a code means different things on each side.
// qualify: an optional narrower test on the payload (a killing blow, an opened
// chest, a crafter-named reveal, a failed cast), reported beside the plain count.

const TARGETS = [
  { key: 'fame', label: 'Fame gained', kind: 'event', id: 82 },
  { key: 'silver', label: 'Silver picked up (own)', kind: 'event', id: 62 },
  { key: 'respec', label: 'ReSpec points', kind: 'event', id: 84 },
  { key: 'mightFavour', label: 'Might and favour', kind: 'event', id: 497 },
  { key: 'faction', label: 'Faction points', kind: 'event', id: 85 },
  { key: 'health', label: 'Health update', kind: 'event', id: 6, qualify: { label: 'killing blow (no param 3)', test: (p) => !has(p, 3) } },
  { key: 'healths', label: 'Health updates (batched)', kind: 'event', id: 7 },
  { key: 'combat', label: 'In-combat state', kind: 'event', id: 278 },
  { key: 'mob', label: 'New mob', kind: 'event', id: 123 },
  { key: 'harvestStart', label: 'Harvest start', kind: 'event', id: 59 },
  { key: 'harvest', label: 'Harvest finished', kind: 'event', id: 61 },
  { key: 'fishStart', label: 'Fishing start (request)', kind: 'request', id: 316 },
  { key: 'fishCatch', label: 'Fishing catch (request)', kind: 'request', id: 319 },
  // A failed catch OMITS param 1 rather than sending false (recorded 2026-09-18) — the same
  // "absent, never zero" rule the item values follow. Testing for `=== false` never matches.
  { key: 'fishFinish', label: 'Fishing finish (request)', kind: 'request', id: 322, qualify: { label: 'failed (param 1 absent)', test: (p) => p['1'] !== true } },
  // The server's own state machine for a bout: 3 line out · 4 cast · 5 bite · 7/8 a tug
  // · 9 landed · 10 escaped · 15 aborted. Recorded 2026-09-16/18; the reference tool
  // leaves this event unhandled.
  { key: 'fishLanded', label: 'Fishing state (event)', kind: 'event', id: 355, qualify: { label: 'landed (state 9)', test: (p) => num(p['3']) === 9 } },
  { key: 'fishEscaped', label: 'Fishing state (event)', kind: 'event', id: 355, qualify: { label: 'escaped (state 10)', test: (p) => num(p['3']) === 10 } },
  { key: 'fishCancel', label: 'Fishing cancel (request)', kind: 'request', id: 323 },
  { key: 'reward', label: 'Reward granted', kind: 'event', id: 267 },
  { key: 'chest', label: 'New loot chest', kind: 'event', id: 393 },
  { key: 'chestUpdate', label: 'Loot chest update', kind: 'event', id: 394, qualify: { label: 'opened (state 7 or opener list)', test: (p) => num(p['1']) === 7 || Array.isArray(p['3']) } },
  { key: 'cluster', label: 'Change cluster (response)', kind: 'response', id: 41 },
  { key: 'join', label: 'Join (response)', kind: 'response', id: 2 },
  { key: 'shrine', label: 'New shrine', kind: 'event', id: 397 },
  { key: 'dungeonExit', label: 'Random dungeon exit', kind: 'event', id: 325 },
  { key: 'stationStart', label: 'Station action start (request)', kind: 'request', id: 55, qualify: { label: 'repair (type 2)', test: (p) => num(p['2']) === 2 } },
  { key: 'craftStart', label: 'Station action start (request)', kind: 'request', id: 55, qualify: { label: 'craft (type 1)', test: (p) => num(p['2']) === 1 } },
  { key: 'journalFull', label: 'Journal got full', kind: 'event', id: 292 },
  { key: 'stationInfo', label: 'Craft building info', kind: 'event', id: 49 },
  { key: 'stationDone', label: 'Station action finished', kind: 'event', id: 66 },
  { key: 'craftDone', label: 'Craft item finished', kind: 'event', id: 71 },
  { key: 'focus', label: 'Crafting focus update', kind: 'event', id: 10 },
  { key: 'equip', label: 'Equipment reveal', kind: 'event', id: 30, qualify: { label: 'names a crafter (string at 6)', test: (p) => typeof p['6'] === 'string' } },
  { key: 'buyOffer', label: 'Instant buy (request)', kind: 'request', id: 83 },
  { key: 'buyOfferResp', label: 'Instant buy (response)', kind: 'response', id: 83 },
  { key: 'sellSpecific', label: 'Instant sell (request)', kind: 'request', id: 315 },
  { key: 'sellSpecificResp', label: 'Instant sell (response)', kind: 'response', id: 315 },
  { key: 'offers', label: 'Sell-order listing (response)', kind: 'response', id: 81 },
  { key: 'requests', label: 'Buy-order listing (response)', kind: 'response', id: 82 },
  { key: 'createOffer', label: 'Place sell order (request)', kind: 'request', id: 79 },
  { key: 'createRequest', label: 'Place buy order (request)', kind: 'request', id: 80 },
  { key: 'mailList', label: 'Mail list (response)', kind: 'response', id: 174 },
  { key: 'mailBody', label: 'Mail body (response)', kind: 'response', id: 176 },
  { key: 'unreadMails', label: 'New unread mails', kind: 'event', id: 202 },
  { key: 'goldBuy', label: 'Gold market buy (response)', kind: 'response', id: 244 },
  { key: 'goldSell', label: 'Gold market sell (response)', kind: 'response', id: 245 },
  { key: 'tradeInvite', label: 'Player trade invitation', kind: 'event', id: 176 },
  { key: 'tradeUpdate', label: 'Player trade update', kind: 'event', id: 179 },
  { key: 'tradeDone', label: 'Player trade finished', kind: 'event', id: 180 },
  { key: 'character', label: 'New character', kind: 'event', id: 29 },
  { key: 'silverOthers', label: 'Other grabbed loot', kind: 'event', id: 279, qualify: { label: 'silver (param 3 true)', test: (p) => p['3'] === true } }
]

// ── the two checklists, in the plan's words ──────────────────────────────────

const R1 = [
  { label: 'fame events', test: (c) => c.fame >= 1, why: 'kill a mob or gather once' },
  { label: 'silver picked up (own)', test: (c) => c.silver >= 1, why: 'take silver off the floor' },
  { label: 'a killing blow in the health updates', test: (c) => c.health_q >= 1, why: 'kill a mob' },
  { label: 'mobs announced', test: (c) => c.mob >= 3, why: 'three or more kinds nearby' },
  { label: 'harvests finished, three or more', test: (c) => c.harvest >= 3, why: 'three resource types with a tool' },
  { label: 'fishing casts, five or more', test: (c) => c.fishStart >= 5, why: 'five casts' },
  { label: 'a failed cast', test: (c) => c.fishEscaped_q >= 1 || c.fishFinish_q >= 1, why: 'let one fish escape' },
  { label: 'a fishing reward', test: (c) => c.reward >= 1, why: 'land one' },
  { label: 'chests seen, two or more', test: (c) => c.chest >= 2, why: 'open two chests' },
  { label: 'a chest opened', test: (c) => c.chestUpdate_q >= 1, why: 'open one yourself' },
  { label: 'two or more zone joins', test: (c) => c.join >= 2, why: 'enter and leave a dungeon' },
  { label: 'a dungeon cluster in the joins', test: (c, s) => s.joins.some((j) => /RANDOMDUNGEON|@/.test(String(j.cluster))), why: 'the dungeon shows in Join param 8' },
  { label: "own object id settled (Join param 0 seen on an own-only packet)", test: (c, s) => s.ownId.settled, why: 'silver pickup or harvest with param 0 == Join param 0' }
]

const R2 = [
  { label: 'instant buy request + response', test: (c) => c.buyOffer >= 1 && c.buyOfferResp >= 1, why: 'buy from a sell order' },
  { label: 'instant sell request + response', test: (c) => c.sellSpecific >= 1 && c.sellSpecificResp >= 1, why: 'sell into a buy order' },
  { label: 'a listing (the price source for instant deals)', test: (c) => c.offers >= 1 || c.requests >= 1, why: 'open the market' },
  { label: 'a sell order placed', test: (c) => c.createOffer >= 1, why: 'place one (op 79 — layout unread until now)' },
  { label: 'a buy order placed', test: (c) => c.createRequest >= 1, why: 'place one (op 80)' },
  { label: 'mail list', test: (c) => c.mailList >= 1, why: 'open the mailbox' },
  { label: 'mail body', test: (c) => c.mailBody >= 1, why: 'open one sold mail' },
  // One craft action can make many items (8 scythes in one, 2026-09-16), so the test is
  // an action, not a count of two.
  { label: 'a craft action', test: (c) => c.craftStart_q >= 1, why: 'craft anything' },
  { label: 'a crafting journal filled', test: (c) => c.journalFull >= 1, why: 'craft with an empty journal in your bag' },
  { label: 'a repair', test: (c) => c.stationStart_q >= 1, why: 'repair something' },
  { label: 'the station named itself', test: (c) => c.stationInfo >= 1, why: 'event 49 on entering the station' },
  { label: 'craft finished events', test: (c) => c.craftDone >= 2, why: 'wait for both crafts' },
  { label: 'a focus update', test: (c) => c.focus >= 1, why: 'craft one with focus' },
  { label: 'an equipment reveal naming its crafter', test: (c) => c.equip_q >= 1, why: 'craft a piece of gear' },
  { label: 'a player trade, updated and finished', test: (c) => c.tradeUpdate >= 1 && c.tradeDone >= 1, why: 'trade with someone' }
]

// ── reading the file ─────────────────────────────────────────────────────────

const readRecords = (file) => {
  const records = []
  let bad = 0

  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') {
      continue
    }

    try {
      records.push(JSON.parse(line))
    } catch {
      bad += 1
    }
  }

  return { records, bad }
}

/** Numbers arrive as numbers or as the dump's `bigint:123` strings. */
const num = (value) => {
  if (typeof value === 'number') {
    return value
  }

  if (typeof value === 'string' && value.startsWith('bigint:')) {
    return Number(value.slice(7))
  }

  return NaN
}

const has = (payload, key) => payload != null && Object.prototype.hasOwnProperty.call(payload, String(key))

const nameOf = (kind, id) => {
  const table = kind === 'event' ? CODES.events : CODES.operations

  return table[String(id)] ?? '?'
}

/** A payload, compact enough for one line. */
const compact = (payload, maxKeys = 14) => {
  const parts = []

  for (const [key, value] of Object.entries(payload ?? {})) {
    if (key === '252' || key === '253') {
      continue
    }

    if (parts.length >= maxKeys) {
      parts.push('…')
      break
    }

    if (Array.isArray(value)) {
      parts.push(`${key}=[${value.slice(0, 4).map((v) => (typeof v === 'string' ? JSON.stringify(v.slice(0, 16)) : String(v))).join(',')}${value.length > 4 ? `,…×${value.length}` : ''}]`)
    } else if (value != null && typeof value === 'object') {
      parts.push(`${key}=${value._array != null ? `array(${value._array})` : value._buffer != null ? `bytes(${value._buffer})` : 'obj'}`)
    } else if (typeof value === 'string') {
      parts.push(`${key}=${JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value)}`)
    } else {
      parts.push(`${key}=${String(value)}`)
    }
  }

  return parts.join(' ')
}

const keyProfile = (payload) =>
  Object.keys(payload ?? {})
    .filter((k) => k !== '252' && k !== '253')
    .map(Number)
    .sort((a, b) => a - b)
    .join(',')

// ── the analysis ─────────────────────────────────────────────────────────────

const analyze = (records, options = {}) => {
  const samplesWanted = options.samples ?? 2
  const census = new Map()
  const perKind = { event: 0, request: 0, response: 0, other: 0 }
  const hits = new Map(TARGETS.map((t) => [t.key, { count: 0, qualified: 0, profiles: new Map(), samples: [] }]))
  // Several targets may watch one code (event 355 is both "landed" and "escaped").
  const targetIndex = new Map()

  for (const t of TARGETS) {
    const key = `${t.kind}:${t.id}`

    targetIndex.set(key, [...(targetIndex.get(key) ?? []), t])
  }

  // What the game answered each market action — the only proof a deal went through,
  // because the reply's parameter table is empty.
  const MARKET_REPLIES = new Set([79, 80, 83, 315, 244, 245])
  const replies = new Map()
  const joins = []
  const ownOnly = { silver: new Set(), harvest: new Set() }
  const healthCausers = new Map()
  const healthTargets = new Map()
  const characters = new Map()
  const mails = { lists: [], bodies: [] }
  let first = null
  let last = null

  for (const record of records) {
    const kind = ['event', 'request', 'response'].includes(record.kind) ? record.kind : 'other'
    const id = record.id == null ? null : Number(record.id)
    const payload = record.payload ?? {}

    perKind[kind] += 1

    if (record.at) {
      first = first ?? record.at
      last = record.at
    }

    const censusKey = `${kind}:${id}`

    census.set(censusKey, (census.get(censusKey) ?? 0) + 1)

    for (const target of targetIndex.get(censusKey) ?? []) {
      const hit = hits.get(target.key)
      const profile = keyProfile(payload)

      hit.count += 1
      hit.profiles.set(profile, (hit.profiles.get(profile) ?? 0) + 1)

      if (target.qualify && target.qualify.test(payload)) {
        hit.qualified += 1
      }

      if (hit.samples.length < samplesWanted) {
        hit.samples.push(compact(payload))
      }
    }

    if (kind === 'response' && MARKET_REPLIES.has(id)) {
      const code = record.rc == null ? 'not recorded' : String(record.rc)
      const row = replies.get(id) ?? new Map()

      row.set(code, (row.get(code) ?? 0) + 1)
      replies.set(id, row)
    }

    // The evidence the "whose object id is me" question needs.
    if (kind === 'response' && id === 2) {
      joins.push({ at: record.at, objectId: num(payload['0']), name: payload['2'], cluster: payload['8'] })
    } else if (kind === 'event' && id === 62) {
      ownOnly.silver.add(num(payload['0']))
    } else if (kind === 'event' && id === 61) {
      ownOnly.harvest.add(num(payload['0']))
    } else if (kind === 'event' && id === 6) {
      const causer = num(payload['6'])
      const target6 = num(payload['0'])

      healthCausers.set(causer, (healthCausers.get(causer) ?? 0) + 1)
      healthTargets.set(target6, (healthTargets.get(target6) ?? 0) + 1)
    } else if (kind === 'event' && id === 29 && typeof payload['1'] === 'string') {
      characters.set(num(payload['0']), payload['1'])
    } else if (kind === 'response' && id === 174) {
      mails.lists.push(record.at)
    } else if (kind === 'response' && id === 176) {
      mails.bodies.push(record.at)
    }
  }

  // Own id: a Join's param 0 that ALSO appears as the actor of an own-only packet.
  const joinIds = [...new Set(joins.map((j) => j.objectId).filter((n) => Number.isFinite(n)))]
  const ownId = {
    joinIds,
    matches: joinIds.map((objectId) => ({
      objectId,
      silver: ownOnly.silver.has(objectId),
      harvest: ownOnly.harvest.has(objectId),
      causedHits: healthCausers.get(objectId) ?? 0,
      tookHits: healthTargets.get(objectId) ?? 0,
      namedByNewCharacter: characters.get(objectId) ?? null
    })),
    settled: false,
    note: ''
  }

  ownId.settled = ownId.matches.some((m) => m.silver || m.harvest)

  if (joinIds.length === 0) {
    ownId.note = 'no Join response in the recording — change zone once while recording'
  } else if (ownId.settled) {
    ownId.note = 'a Join param 0 is the actor of an own-only packet: that is the member'
  } else if (ownId.matches.some((m) => m.causedHits > 0)) {
    ownId.note = 'Join param 0 causes hits but no own-only packet confirms it — pick up silver or gather once'
  } else {
    ownId.note = 'Join param 0 appears on no combat or own-only packet — the Q24 mismatch stands; record a fight AND a pickup in the same zone'
  }

  // Mail timing: a body that precedes every list is a body nobody asked for.
  const firstList = mails.lists[0] ?? null
  const unpromptedBodies = firstList == null ? mails.bodies.length : mails.bodies.filter((at) => at < firstList).length

  const counts = {}

  for (const [key, hit] of hits) {
    counts[key] = hit.count
    counts[`${key}_q`] = hit.qualified
  }

  const state = { joins, ownId, mails: { lists: mails.lists.length, bodies: mails.bodies.length, unpromptedBodies } }
  const checklist = (items) => items.map((item) => ({ label: item.label, pass: Boolean(item.test(counts, state)), why: item.why }))

  return {
    records: records.length,
    perKind,
    span: { first, last, seconds: first && last ? Math.max(0, Math.round((Date.parse(last) - Date.parse(first)) / 1000)) : null },
    census: [...census.entries()]
      .map(([key, count]) => {
        const [kind, id] = key.split(':')

        return { kind, id: id === 'null' ? null : Number(id), name: id === 'null' ? '(no code)' : nameOf(kind, id), count }
      })
      .sort((a, b) => b.count - a.count),
    targets: TARGETS.map((t) => {
      const hit = hits.get(t.key)

      return {
        key: t.key,
        label: t.label,
        kind: t.kind,
        id: t.id,
        name: nameOf(t.kind, t.id),
        count: hit.count,
        qualified: t.qualify ? { label: t.qualify.label, count: hit.qualified } : null,
        profiles: [...hit.profiles.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([keys, count]) => ({ keys, count })),
        samples: hit.samples
      }
    }),
    ownId,
    mails: state.mails,
    replies: [...replies.entries()].map(([id, codes]) => ({ id, name: nameOf('response', id), codes: Object.fromEntries(codes) })),
    checks: { r1: checklist(R1), r2: checklist(R2) }
  }
}

/** Every record of one code, any kind — for reading a shape the summary only counts. */
const codeReport = (records, code, samples) =>
  records
    .filter((r) => Number(r.id) === code)
    .slice(0, samples)
    .map((r) => `${r.at ?? ''} ${r.kind} ${code} ${nameOf(r.kind, code)} · ${compact(r.payload, 40)}`)

// ── rendering ────────────────────────────────────────────────────────────────

const pad = (s, n) => String(s).padEnd(n)

const render = (summary, options = {}) => {
  const out = []
  const top = options.top ?? 30
  const wantR1 = options.r1 ?? true
  const wantR2 = options.r2 ?? true

  out.push(`Records: ${summary.records} (events ${summary.perKind.event}, requests ${summary.perKind.request}, responses ${summary.perKind.response})`)
  out.push(`Span: ${summary.span.first ?? '?'} → ${summary.span.last ?? '?'}${summary.span.seconds != null ? ` (${Math.floor(summary.span.seconds / 60)}m ${summary.span.seconds % 60}s)` : ''}`)
  out.push('')
  out.push(`Census — top ${top} of ${summary.census.length} distinct codes (names: ${CODES.source.split(' — ')[0]})`)

  for (const row of summary.census.slice(0, top)) {
    out.push(`  ${pad(row.count, 7)} ${pad(row.kind, 9)} ${pad(row.id ?? '-', 5)} ${row.name}`)
  }

  out.push('')
  out.push('Stat packets — count · qualified · key profiles · first sample')

  for (const t of summary.targets) {
    const q = t.qualified ? ` · ${t.qualified.count} ${t.qualified.label}` : ''
    const profiles = t.profiles.map((p) => `{${p.keys}}×${p.count}`).join(' ')

    out.push(`  ${pad(t.count, 6)} ${pad(`${t.kind} ${t.id}`, 13)} ${pad(t.label, 34)} ${t.name}${q}`)

    if (t.count > 0) {
      out.push(`         keys ${profiles}`)

      for (const sample of t.samples) {
        out.push(`         ${sample}`)
      }
    }
  }

  out.push('')
  out.push('Whose object id is "me"')

  if (summary.ownId.joinIds.length === 0) {
    out.push(`  ${summary.ownId.note}`)
  } else {
    for (const m of summary.ownId.matches) {
      out.push(`  Join param 0 = ${m.objectId}: silver pickup ${m.silver ? 'yes' : 'no'} · harvest ${m.harvest ? 'yes' : 'no'} · caused ${m.causedHits} hits · took ${m.tookHits} hits · NewCharacter name ${m.namedByNewCharacter ?? '—'}`)
    }

    out.push(`  → ${summary.ownId.note}`)
  }

  if (summary.replies.length > 0) {
    out.push('')
    out.push('Market replies — return code per reply (0 = Photon OK; "not recorded" = a recorder older than 2026-09-18)')

    for (const r of summary.replies) {
      out.push(`  response ${pad(r.id, 4)} ${pad(r.name, 32)} ${Object.entries(r.codes).map(([code, n]) => `${code}×${n}`).join('  ')}`)
    }
  }

  out.push('')
  out.push(`Market mail — lists ${summary.mails.lists} · bodies ${summary.mails.bodies} · bodies before any list ${summary.mails.unpromptedBodies}${summary.mails.bodies > 0 && summary.mails.unpromptedBodies === 0 ? ' (every body followed a list: the mailbox was open)' : ''}`)

  const renderChecks = (title, checks) => {
    out.push('')
    out.push(title)

    for (const c of checks) {
      out.push(`  ${c.pass ? 'PASS   ' : 'MISSING'} ${pad(c.label, 52)} ${c.pass ? '' : `← ${c.why}`}`)
    }

    const passed = checks.filter((c) => c.pass).length

    out.push(`  ${passed}/${checks.length}`)
  }

  if (wantR1) {
    renderChecks('R1 — open world', summary.checks.r1)
  }

  if (wantR2) {
    renderChecks('R2 — a city', summary.checks.r2)
  }

  return out.join('\n')
}

// ── command line ─────────────────────────────────────────────────────────────

const parseArgs = (argv) => {
  const options = { files: [], r1: null, r2: null, top: 30, samples: 2, code: null, json: false }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]

    if (arg === '--r1') options.r1 = true
    else if (arg === '--r2') options.r2 = true
    else if (arg === '--json') options.json = true
    else if (arg === '--top') options.top = Number(argv[++i])
    else if (arg === '--samples') options.samples = Number(argv[++i])
    else if (arg === '--code') options.code = Number(argv[++i])
    else if (arg.startsWith('--')) throw new Error(`unknown option ${arg}`)
    else options.files.push(arg)
  }

  // Asking for one checklist hides the other; asking for none shows both.
  if (options.r1 == null && options.r2 == null) {
    options.r1 = true
    options.r2 = true
  }

  return options
}

const main = () => {
  const options = parseArgs(process.argv.slice(2))

  if (options.files.length === 0) {
    console.error('usage: node tools/analyze-recording.js <guild-dump-*.jsonl>… [--r1] [--r2] [--top N] [--samples N] [--code N] [--json]')
    process.exit(2)
  }

  const records = []
  let bad = 0

  for (const file of options.files) {
    const read = readRecords(path.resolve(file))

    // A spread passes every record as an ARGUMENT, and a real 32-minute recording is
    // 130k of them: Node throws RangeError: Maximum call stack size exceeded, on
    // exactly the input this tool exists for. Append one at a time.
    for (const record of read.records) {
      records.push(record)
    }

    bad += read.bad
  }

  records.sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')))

  const summary = analyze(records, options)

  if (options.json) {
    console.log(JSON.stringify(summary, null, 1))
    return
  }

  console.log(render(summary, { top: options.top, r1: options.r1 === true, r2: options.r2 === true }))

  if (bad > 0) {
    console.log(`\n(${bad} unreadable lines skipped)`)
  }

  if (options.code != null) {
    console.log(`\nAll records with code ${options.code} (first ${options.samples * 5}):`)

    for (const line of codeReport(records, options.code, options.samples * 5)) {
      console.log(`  ${line}`)
    }
  }
}

if (require.main === module) {
  main()
}

module.exports = { analyze, render, readRecords, parseArgs, TARGETS, R1, R2, __test: { num, has, compact, keyProfile } }
