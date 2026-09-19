const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { fresh, joinEvent } = require('./helpers')

process.setMaxListeners(50)

/**
 * An item is named only by a table that is current (src/items.js).
 *
 * The game sends an item's INDEX, and the list behind it is positional: one insertion renumbers
 * everything after it. The bundled copy this replaced was frozen on 2026-07-21 and, measured
 * 2026-09-18, named 12,049 of its 12,071 indexes wrongly — index 3018 is a fishing rod in the
 * current table and was a Morgana armoured horse in that one. Every startup that could not reach
 * GitHub wrote every loot line with the wrong item. These tests pin the replacement rule, offline:
 * no table but one confirmed current this run ever names anything.
 */

// Real ids at the index the measurement quoted, so the story reads the way it happened.
const ROD = 'T6_2H_TOOL_FISHINGROD'
const HORSE = 'T8_MOUNT_ARMORED_HORSE_MORGANA@1'

const base = () => {
  const ids = Array.from({ length: 10100 }, (_, i) => `T4_TEST_ITEM_${i + 1}`)

  ids[3016] = ROD // index 3017
  ids[3017] = HORSE // index 3018

  return ids
}

/** ao-bin-dumps' items.txt shape: padded index, padded id, then a name (some hold a colon). */
const render = (ids) => {
  return ids
    .map((id, i) => {
      const index = String(i + 1).padStart(6)
      const name = id === ROD ? "Master's Fishing Rod" : `Name: of ${id}`

      return `${index}: ${id.padEnd(64)} : ${name}`
    })
    .join('\n')
}

// Before and after a patch that inserted one item at the top: every index moves by one.
const BEFORE = render(base())
const AFTER = render(['T8_FARM_DRAKE_BABY', ...base()])

const tmpDir = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'items-test-'))

  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))

  return dir
}

const saveCache = (dir, { text, etag = '"before"' }) => {
  const { ITEMS_URL, CACHE_FILE } = require('../src/items')

  fs.writeFileSync(path.join(dir, CACHE_FILE), JSON.stringify({ url: ITEMS_URL, etag, savedAt: '2026-07-21T12:00:00Z', text }))
}

const offline = () => {
  const error = new TypeError('fetch failed')

  error.cause = Object.assign(new Error('getaddrinfo ENOTFOUND raw.githubusercontent.com'), { code: 'ENOTFOUND' })

  return Promise.reject(error)
}

/**
 * A fresh Items with everything outside the process replaced: `answers` are what the server says,
 * in order (a function per request, or `offline`); requests, console lines and timers are recorded.
 */
const start = async (t, { answers = [], dir = tmpDir(t) } = {}) => {
  const mods = fresh()
  const requests = []
  const logs = []
  const timers = []
  const queue = [...answers]

  // Checked when the test ends: an assert thrown inside fetch would only become download()'s
  // failure reason, and the test would carry on.
  let unexpected = 0

  t.after(() => {
    assert.equal(unexpected, 0, 'requests nobody expected')
    assert.equal(queue.length, 0, 'answers nobody asked for')
  })

  const io = {
    fetch: (url, init) => {
      requests.push({ url, headers: init.headers ?? {} })

      const answer = queue.shift()

      if (answer == null) {
        unexpected += 1

        return offline()
      }

      return answer === offline ? offline() : Promise.resolve(answer())
    },
    cacheDir: () => dir,
    schedule: (fn, ms) => timers.push({ fn, ms }),
    log: (line) => logs.push(...line.split('\n')),
    now: () => Date.parse('2026-09-18T12:00:00Z')
  }

  await mods.Items.init(io)

  /** Fire the one pending timer, as the clock would. */
  const tick = async () => {
    assert.equal(timers.length, 1, 'exactly one check is ever scheduled')

    const { fn } = timers.shift()

    await fn()
  }

  /** A zone change, through the real OpJoin handler. */
  const join = () => mods.OpJoin.handle(joinEvent())

  return { ...mods, requests, logs, timers, tick, join, dir, queue }
}

const ok = (text, etag) => () => new Response(text, { status: 200, headers: etag ? { etag } : {} })
const notModified = (etag) => () => new Response(null, { status: 304, headers: { etag } })
const status = (code) => () => new Response('', { status: code })

test('the ao-bin-dumps format reads as it is: padded, a name may hold a colon, a name may be missing', () => {
  const { parseItems } = require('../src/items')
  const ids = base()
  const text = render(ids).replace(`${ids[9].padEnd(64)} : Name: of ${ids[9]}`, ids[9])

  const { items, count } = parseItems(text)

  assert.equal(count, 10100)
  assert.deepEqual(items[3018], { itemNumId: 3018, itemId: HORSE, itemName: `Name: of ${HORSE}` })
  // An id-only line is named by its id, as before.
  assert.deepEqual(items[10], { itemNumId: 10, itemId: ids[9], itemName: ids[9] })
})

test('text that is not a whole table is refused, not half-loaded', () => {
  const { parseItems } = require('../src/items')
  const lines = BEFORE.split('\n')

  assert.throws(() => parseItems(lines.slice(0, 5000).join('\n')), /5000 entries/, 'a truncated body')
  assert.throws(() => parseItems('<!DOCTYPE html>\n<html>rate limited</html>'), /line 1 is not entry 1/, 'an error page')
  assert.throws(
    () => parseItems([...lines.slice(0, 10), ...lines.slice(11)].join('\n')),
    /line 11 is not entry 11/,
    'a gap renumbers everything after it, so it is refused'
  )
  assert.throws(
    () => parseItems(lines.map((l, i) => (i === 7 ? '     8: T4_BAD;ID : Broken' : l)).join('\n')),
    /line 8/,
    'an id the bot could not parse'
  )
})

test('a startup download names items, and leaves a copy for the next start', async (t) => {
  const s = await start(t, { answers: [ok(AFTER, '"after"')] })

  assert.equal(s.Items.source, 'live')
  assert.equal(s.Items.resolve(3018).itemId, ROD)
  assert.match(s.logs[0], /\[items\] 10101 item names loaded \(downloaded\)/)

  const saved = JSON.parse(fs.readFileSync(path.join(s.dir, 'items-cache.json'), 'utf8'))

  assert.equal(saved.etag, '"after"')
  assert.equal(saved.text, AFTER)
  // Then a slow re-check, not a retry: a table is in hand.
  assert.equal(s.timers[0].ms, s.Items.RECHECK_MS)
})

test('offline at startup: every item is UNKNOWN_<index> — never a name from an old table', async (t) => {
  const s = await start(t, { answers: [offline] })

  assert.equal(s.Items.source, 'none')
  assert.deepEqual(s.Items.resolve(3018), {
    itemNumId: 3018,
    itemId: 'UNKNOWN_3018',
    itemName: 'Unknown Item (3018)'
  })
  assert.equal(s.Items.get(3018), undefined)
  assert.match(s.logs.join('\n'), /No current item table \(offline, or the address does not resolve\)/)
  assert.equal(s.timers[0].ms, 15000, 'and the first retry is quick')
})

test('a cached copy is NOT used on its own: offline, it could be a patch behind — this one is', async (t) => {
  const dir = tmpDir(t)

  // The copy on disk is the table from before the patch, which the game no longer uses.
  saveCache(dir, { text: BEFORE })

  const s = await start(t, { answers: [offline], dir })

  assert.equal(s.requests[0].headers['If-None-Match'], '"before"', 'it was offered to the server')
  assert.equal(s.Items.source, 'none')
  assert.equal(s.Items.resolve(3018).itemId, 'UNKNOWN_3018', 'the horse is exactly the wrong answer this prevents')
})

test('a cached copy the server confirms (304) names items, without downloading the table again', async (t) => {
  const dir = tmpDir(t)

  saveCache(dir, { text: AFTER, etag: '"after"' })

  const s = await start(t, { answers: [notModified('"after"')], dir })

  assert.equal(s.requests[0].headers['If-None-Match'], '"after"')
  assert.equal(s.Items.source, 'live')
  assert.equal(s.Items.resolve(3018).itemId, ROD)
  assert.match(s.logs[0], /cached copy, confirmed current/)
})

test('a cached copy the server has replaced is replaced, on disk too', async (t) => {
  const dir = tmpDir(t)

  saveCache(dir, { text: BEFORE, etag: '"before"' })

  const s = await start(t, { answers: [ok(AFTER, '"after"')], dir })

  assert.equal(s.Items.resolve(3018).itemId, ROD)
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'items-cache.json'), 'utf8')).etag, '"after"')
})

test('a corrupt cache is ignored: the download is a full one and rewrites it', async (t) => {
  const dir = tmpDir(t)

  fs.writeFileSync(path.join(dir, 'items-cache.json'), '{"url": "https://raw.githubusercontent.com/ao-da')

  const s = await start(t, { answers: [ok(AFTER, '"after"')], dir })

  assert.equal(s.requests[0].headers['If-None-Match'], undefined, 'nothing to offer')
  assert.equal(s.Items.source, 'live')
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'items-cache.json'), 'utf8')).etag, '"after"')
})

test('an answer that is not a table names nothing — an error page, or an error status', async (t) => {
  const page = await start(t, { answers: [ok('<!DOCTYPE html><html>Too many requests</html>', '"x"')] })

  assert.equal(page.Items.source, 'none')
  assert.match(page.logs.join('\n'), /not an item table/)
  assert.equal(fs.existsSync(path.join(page.dir, 'items-cache.json')), false, 'and nothing bad is cached')

  const down = await start(t, { answers: [status(503)] })

  assert.equal(down.Items.source, 'none')
  assert.match(down.logs.join('\n'), /HTTP 503/)
})

test('a failed startup keeps trying, and a table that arrives takes over at the next zone change', async (t) => {
  const s = await start(t, { answers: [offline, offline, ok(AFTER, '"after"')] })

  await s.tick()
  assert.match(s.logs.at(-1), /Still no current item table .*next try in 30s/)
  assert.equal(s.timers[0].ms, 30000)

  await s.tick()
  assert.match(s.logs.at(-1), /arrived \(10101 items\); names resume at your next zone change/)

  // Mid-zone, nothing changes: a chest share and its pickup must be named by the same table.
  assert.equal(s.Items.source, 'none')
  assert.equal(s.Items.resolve(3018).itemId, 'UNKNOWN_3018')

  // The next map's own items can arrive before its Join response; what is held is renamed.
  s.EvNewSimpleItem.handle({ parameters: { 0: 4000, 1: 3018, 2: 1 } })
  assert.equal(s.MemoryStorage.loots.getById(4000).itemId, 'UNKNOWN_3018')

  s.join()

  assert.equal(s.Items.source, 'live')
  assert.equal(s.Items.resolve(3018).itemId, ROD)
  assert.equal(s.MemoryStorage.loots.getById(4000).itemId, ROD)
  assert.match(s.logs.at(-1), /Naming items from the current table now/)
  assert.equal(s.timers[0].ms, s.Items.RECHECK_MS, 'from then on, the slow re-check')
})

test('retries back off to every ten minutes and never stop', async (t) => {
  const s = await start(t, { answers: Array(9).fill(offline) })
  const delays = [s.timers[0].ms]

  for (let i = 0; i < 8; i++) {
    await s.tick()
    delays.push(s.timers[0].ms)
  }

  assert.deepEqual(delays, [15000, 30000, 60000, 120000, 300000, 600000, 600000, 600000, 600000])
})

test('a running engine outlives a patch: the re-check finds the new table and switches at a zone change', async (t) => {
  const s = await start(t, { answers: [ok(BEFORE, '"before"'), notModified('"before"'), ok(AFTER, '"after"')] })

  assert.equal(s.Items.resolve(3018).itemId, HORSE, 'right, before the patch')

  await s.tick()
  assert.equal(s.requests[1].headers['If-None-Match'], '"before"')
  assert.equal(s.Items.pending, null, 'unchanged: nothing to switch to')

  // The patch: the game now calls the fishing rod 3018.
  await s.tick()
  assert.match(s.logs.at(-1), /changed upstream .* at your next zone change/)

  s.join()

  assert.equal(s.Items.resolve(3018).itemId, ROD)
})

test('a failed re-check keeps the table in hand: it was current when last confirmed', async (t) => {
  const s = await start(t, { answers: [ok(AFTER, '"after"'), offline] })

  await s.tick()

  assert.equal(s.Items.source, 'live')
  assert.equal(s.Items.resolve(3018).itemId, ROD)
  assert.equal(s.timers[0].ms, s.Items.RECHECK_MS)
})

test('with no table, an unknown item is not a warning per pickup; with one, it is news', async (t) => {
  const s = await start(t, { answers: [offline] })
  const warned = []

  s.Logger.warn = (...args) => warned.push(args)

  s.Items.resolve(1)
  s.Items.resolve(2)
  assert.equal(warned.length, 0, 'the startup banner already said so, once')

  s.Items.source = 'live'
  s.Items.resolve(999_999)
  assert.deepEqual(warned, [['item num id not found', 999_999]])
})

/**
 * Guild Butler Capture reads every engine line and treats these words as a fatal capture-permission
 * failure (copied from FATAL_RULES in its src/main/engineAdapter.ts): it stops restarting the engine
 * and tells the member to fix packet capture. A firewall or a read-only folder here must not.
 */
const APP_FATAL_RE =
  /operation not permitted|permission denied|EPERM|EACCES|\/dev\/bpf|BIOC[A-Z]+|must be run as root|(?:need|requires?|try)\s+(?:running\s+(?:as|with)\s+)?(?:root|sudo)|wpcap\.dll|npcap|winpcap|specified module could not be found|NODE_MODULE_VERSION|cannot find module/i

test('what this prints never reads as a capture-permission failure to the capture app', async (t) => {
  const blocked = () => {
    const error = new TypeError('fetch failed')

    error.cause = Object.assign(new Error('connect EACCES 185.199.108.133:443'), { code: 'EACCES' })

    return Promise.reject(error)
  }

  const s = await start(t, { answers: [() => blocked()] })

  assert.match(s.logs.join('\n'), /access refused/)

  // A cache folder that cannot be written.
  const writeFile = fs.promises.writeFile

  fs.promises.writeFile = () => {
    return Promise.reject(Object.assign(new Error("EACCES: permission denied, open 'items-cache.json.1.tmp'"), { code: 'EACCES' }))
  }
  t.after(() => {
    fs.promises.writeFile = writeFile
  })

  const r = await start(t, { answers: [ok(AFTER, '"after"')] })

  assert.equal(r.Items.source, 'live', 'a cache that cannot be saved costs nothing but the cache')
  assert.match(r.logs.join('\n'), /Could not save items-cache.json .*access refused/)

  for (const line of [...s.logs, ...r.logs]) {
    assert.doesNotMatch(line, APP_FATAL_RE, line)
  }
})
