const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const Logger = require('./utils/logger')

/**
 * Local patch (Guild Butler, 2026-09-18) — an item is named only by a table that is CURRENT.
 *
 * The game identifies an item on the wire by its INDEX in its own item list, and that list is
 * positional: one insertion near the top renumbers everything after it. Of the 19 updates to
 * ao-bin-dumps' items.txt between 2025-04-23 and 2026-09-08, 18 renumbered between 4.6% and 99.8%
 * of the table (the 19th was a byte-identical re-upload), one to seven weeks apart. A copy of the
 * table is right until the next patch and then wrong nearly everywhere at once, and nothing in the
 * traffic says when that happened.
 *
 * This used to fall back to `items-fallback.js`, a copy frozen on 2026-07-21, whenever the startup
 * download failed. Measured 2026-09-18 it named 12,049 of its 12,071 indexes wrongly, and replayed
 * against the owner's five-hour recording of 2026-09-16 it named 6 of 22,891 item events correctly:
 * a fishing rod came out as a Morgana armoured horse, and the bot priced and judged the horse.
 * Offline, a GitHub hiccup, a slow link, or the capture app starting before the network did, and
 * practically every loot line of the session named the wrong item, with one console line to show
 * for it.
 *
 * So there is no fallback table any more. Names come only from a table known to be current THIS
 * run: downloaded now, or a cached copy the server has just confirmed unchanged (a 304 with no
 * body, where the table is 1.2 MB of text and ~116 KB on the wire). Until one arrives, every item
 * is written as `UNKNOWN_<index>`, the engine's long-standing "I could not name this" marker:
 * honest, inside the bot's line format, and still carrying the index, so a current table can name
 * it later.
 *
 * A failed startup keeps trying in the background, and a running engine re-checks every half hour,
 * because a capture app left open for days outlives a patch. Either way a new table takes over at
 * the next zone change, never mid-zone (see `onZoneChange`).
 *
 * "Current" is only as current as ao-bin-dumps. Its dump lagged the September 2026 patch by at
 * least 39 hours (madvac committed the new numbering 2026-09-01 20:36 UTC, ao-bin-dumps 2026-09-03
 * 11:46 UTC), and nothing in the traffic can tell (README-mac.md, "Item names").
 */

const ITEMS_URL = 'https://raw.githubusercontent.com/ao-data/ao-bin-dumps/master/formatted/items.txt'

/** The startup attempt holds up the whole engine, so it is short; the rest run in the background. */
const STARTUP_TIMEOUT_MS = 8000
const RETRY_TIMEOUT_MS = 60000

/** Without a table: 15s, 30s, 1m, 2m, 5m, then every 10m for as long as it takes. */
const RETRY_DELAYS_MS = [15000, 30000, 60000, 120000, 300000, 600000]

/** With one: is it still the newest? A patch lands at a server maintenance, days or weeks apart. */
const RECHECK_MS = 30 * 60000

/**
 * A real table: 12,237 entries on 2026-09-08, never fewer than 11,589 in any of the 20 versions
 * published since 2025-04-23, each numbered 1..N with no gap. Anything shorter is not a table.
 */
const MIN_ITEMS = 10000

const CACHE_FILE = 'items-cache.json'

/** Raised for text that is not an item table, so its reason is printed as it stands. */
class TableError extends Error {}

/**
 * `items.txt` → `{ items, count, digest }`, or a thrown TableError saying why it is not a table.
 *
 * Strict on purpose. An index means something only in a table that is complete and in order, so a
 * truncated body or an HTML error page is refused outright rather than half-loaded.
 */
const parseItems = (text) => {
  const lines = String(text).trim().split('\n')
  const items = {}

  lines.forEach((line, i) => {
    const raw = line.split(':')
    const itemNumId = Number(raw[0].trim())
    const itemId = (raw[1] ?? '').trim()

    // The same characters the bot's loot-line parser accepts for an item id (AO_LOOT_RE).
    if (itemNumId !== i + 1 || !/^[\w@]+$/.test(itemId)) {
      throw new TableError(`not an item table: line ${i + 1} is not entry ${i + 1}`)
    }

    // A name may hold a colon of its own ("Delivery: Blueprints"); only the first two separate
    // fields. The old parser kept what came before it, so ~520 names were cut short.
    const itemName = raw.slice(2).join(':').trim()

    items[itemNumId] = { itemNumId, itemId, itemName: itemName || itemId }
  })

  if (lines.length < MIN_ITEMS) {
    throw new TableError(`not an item table: ${lines.length} entries`)
  }

  return { items, count: lines.length, digest: crypto.createHash('sha256').update(String(text)).digest('hex') }
}

/**
 * Guild Butler Capture reads every line this engine prints, and EACCES, EPERM or "permission
 * denied" there mean a fatal CAPTURE-permission failure (FATAL_RULES in the app's
 * src/main/engineAdapter.ts): it stops restarting the engine and sends the member to fix packet
 * capture. A firewall refusing the download, or a read-only folder for the cache, must not say so
 * in those words.
 */
const neutral = (text) => {
  return String(text).replace(/EACCES|EPERM|permission denied|operation not permitted/gi, 'access refused')
}

const describeFailure = (error, timeoutMs) => {
  if (error instanceof TableError) {
    return error.message
  }

  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
    return `no answer within ${timeoutMs / 1000}s`
  }

  const code = error?.cause?.code ?? error?.cause?.errors?.[0]?.code ?? error?.code

  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return 'offline, or the address does not resolve'
  }

  return neutral(code ?? error?.message ?? error)
}

const span = (ms) => {
  return ms >= 60000 ? `${ms / 60000}m` : `${ms / 1000}s`
}

/**
 * Where the cache lives. Run by Guild Butler Capture (ELECTRON_RUN_AS_NODE=1): the working folder,
 * which the app sets to its per-user captures folder for a bundled engine — the one place it
 * guarantees is writable — and to the engine's folder for a development layout. Run by hand:
 * beside the loot log.
 */
const defaultCacheDir = () => {
  if (process.env.ELECTRON_RUN_AS_NODE === '1') {
    return process.cwd()
  }

  return path.dirname(require('./loot-logger').logFileName)
}

/** The cached table, parsed and validated — or null, which only means "download it in full". */
const readCache = async (dir) => {
  let raw

  try {
    raw = await fs.promises.readFile(path.join(dir, CACHE_FILE), 'utf8')
  } catch {
    return null
  }

  try {
    const saved = JSON.parse(raw)

    if (saved.url !== ITEMS_URL || typeof saved.etag !== 'string' || saved.etag.length === 0) {
      return null
    }

    return { ...parseItems(saved.text), etag: saved.etag }
  } catch {
    // Unreadable, or not a table. With no ETag to offer, the request downloads in full, and a
    // good download overwrites this file.
    return null
  }
}

class Items {
  constructor() {
    // index -> { itemNumId, itemId, itemName }. Only ever a CURRENT table, so empty until one is.
    this.items = {}
    this.count = 0
    this.digest = null
    this.etag = null
    // 'live' while a table confirmed current is in use, 'none' until then.
    this.source = 'none'
    // A newer table, waiting for the next zone change.
    this.pending = null
    this.retries = 0
    this.io = null
  }

  /**
   * One attempt at startup, before capture begins, then the background checks. `io` is for the
   * tests, which run offline: the fetch, the cache folder, the timer and the console are theirs.
   */
  async init(io = {}) {
    this.io = {
      fetch: (...args) => fetch(...args),
      cacheDir: defaultCacheDir,
      schedule: (fn, ms) => setTimeout(fn, ms).unref(),
      log: (line) => console.info(line),
      now: () => Date.now(),
      ...io
    }

    const got = await this.download(STARTUP_TIMEOUT_MS, null)

    if (got.table != null) {
      this.use(got.table)
      this.io.log(`[items] ${got.table.count} item names loaded (${got.how}).`)
    } else {
      this.io.log(
        [
          `[items] No current item table (${got.reason}), so loot is written as UNKNOWN_<item number>`,
          '[items] instead of a name: an out-of-date table names the WRONG item, not a missing one.',
          '[items] Retrying in the background; names resume at the first zone change after it arrives.'
        ].join('\n')
      )
    }

    this.scheduleCheck()
  }

  /**
   * The request, conditional whenever there is a copy to offer: `known` (the newest table in
   * memory) or else the cache on disk. A 304 proves the copy is what the server would send now.
   * A copy is never used WITHOUT that answer — it is right only until the next patch, and offline
   * there is no telling whether that has happened.
   */
  async download(timeoutMs, known) {
    let dir = null
    let copy = known

    try {
      dir = this.io.cacheDir()

      if (copy == null) {
        copy = await readCache(dir)
      }
    } catch {
      // No cache folder only makes the download a full one.
    }

    try {
      const response = await this.io.fetch(ITEMS_URL, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: copy?.etag != null ? { 'If-None-Match': copy.etag } : {}
      })

      if (response.status === 304 && copy != null) {
        return { table: copy, how: 'cached copy, confirmed current' }
      }

      if (!response.ok) {
        return { reason: `HTTP ${response.status}` }
      }

      const text = await response.text()
      const table = { ...parseItems(text), etag: response.headers.get('etag') }

      await this.saveCache(dir, table.etag, text)

      return { table, how: 'downloaded' }
    } catch (error) {
      return { reason: describeFailure(error, timeoutMs) }
    }
  }

  /** Written whole and then renamed, so a crash mid-write never leaves half a table to read. */
  async saveCache(dir, etag, text) {
    if (dir == null || etag == null) {
      return
    }

    const file = path.join(dir, CACHE_FILE)
    const partial = `${file}.${process.pid}.tmp`
    const saved = { url: ITEMS_URL, etag, savedAt: new Date(this.io.now()).toISOString(), text }

    try {
      await fs.promises.writeFile(partial, JSON.stringify(saved))
      await fs.promises.rename(partial, file)
    } catch (error) {
      await fs.promises.rm(partial, { force: true }).catch(() => {})
      this.io.log(`[items] Could not save ${CACHE_FILE} in ${dir} (${neutral(error.code ?? 'write failed')}).`)
    }
  }

  /** Short retries while there is no table to name items with; a slow re-check once there is. */
  scheduleCheck() {
    let delay = RECHECK_MS

    if (this.source !== 'live' && this.pending == null) {
      delay = RETRY_DELAYS_MS[Math.min(this.retries, RETRY_DELAYS_MS.length - 1)]
      this.retries += 1
    }

    this.io.schedule(() => this.check().catch((error) => Logger.warn('[items] check failed', neutral(error?.stack ?? error))), delay)
  }

  async check() {
    try {
      const newest = this.pending ?? (this.source === 'live' ? this : null)
      const got = await this.download(RETRY_TIMEOUT_MS, newest)

      if (got.table == null) {
        if (newest == null) {
          const next = RETRY_DELAYS_MS[Math.min(this.retries, RETRY_DELAYS_MS.length - 1)]

          this.io.log(`[items] Still no current item table (${got.reason}); next try in ${span(next)}.`)
        } else {
          // The table in hand was current when last confirmed; one missed check changes nothing.
          Logger.debug('[items] re-check failed', got.reason)
        }

        return
      }

      if (newest != null && got.table.digest === newest.digest) {
        return
      }

      this.pending = got.table
      this.io.log(
        newest == null
          ? `[items] Current item table arrived (${got.table.count} items); names resume at your next zone change.`
          : `[items] The item table changed upstream — a game patch renumbers items — so names switch to the new one (${got.table.count} items) at your next zone change.`
      )
    } finally {
      this.scheduleCheck()
    }
  }

  /**
   * Called by OpJoin, after the zone's own bookkeeping is reset; true when a new table took over.
   * It takes over HERE, not the moment it lands, so one zone is never named by two tables: our own
   * chest share is matched to the pickup that follows it by item TYPE
   * (storage/assignment-written.js), and `UNKNOWN_123` on one side and a real name on the other
   * would not match — the pickup would be written twice. OpJoin renames what is already held.
   */
  onZoneChange() {
    if (this.pending == null) {
      return false
    }

    this.use(this.pending)
    this.pending = null
    this.io.log(`[items] Naming items from the current table now (${this.count} items).`)

    return true
  }

  use(table) {
    this.items = table.items
    this.count = table.count
    this.digest = table.digest
    this.etag = table.etag
    this.source = 'live'
  }

  get(itemNumId) {
    return this.items[itemNumId]
  }

  /**
   * What a loot line calls an item: the table's entry, or `UNKNOWN_<index>`. The bot reads that id
   * as "the engine's table is behind the game" (captureHealth.ts, UnknownItem) and prices it as
   * unknown, never as zero.
   */
  resolve(itemNumId) {
    const item = this.items[itemNumId]

    if (item != null) {
      return item
    }

    // With a current table a miss is news: an item newer than the table. Without one every item
    // misses, and the startup banner has said so once already.
    if (this.source === 'live') {
      Logger.warn('item num id not found', itemNumId)
    }

    return { itemNumId, itemId: `UNKNOWN_${itemNumId}`, itemName: `Unknown Item (${itemNumId})` }
  }
}

module.exports = new Items()
module.exports.parseItems = parseItems
module.exports.ITEMS_URL = ITEMS_URL
module.exports.CACHE_FILE = CACHE_FILE
module.exports.RETRY_DELAYS_MS = RETRY_DELAYS_MS
module.exports.RECHECK_MS = RECHECK_MS
