/**
 * Local patch (Guild Butler, 2026-09-28) — is a game update breaking the decoder?
 *
 * An Albion patch around 2026-09-23 moved one field of EvAttachItemContainer. From then on EVERY
 * container attach threw, the deposit guard went with it, and bank deposits were written as loot.
 * The engine said so on every attach — as a `[warn]` in each member's local debug log, which
 * nobody reads. It took five days and a member's wrong loot for anyone to notice.
 *
 * So every dispatch to a handler is counted here, and every exception a handler throws, and the
 * heartbeat prints a verdict once a minute (`[health] parse ok` / `[health] parse broken: …`) for
 * the capture app to show and report.
 *
 * **A count alone would cry wolf.** Some failures are ordinary: measured on 2026-09-21, before the
 * patch, EvOtherGrabbedLoot failed 9 of 1,204 times (silver grabs that carry no quantity). What a
 * patch does is different in kind — the moved field made the attach fail 5 of 5. So a handler is
 * BROKEN when, within the last ten minutes, it failed at least MIN_FAILURES times AND on at least
 * half of its calls. The first bank visit after that patch would have tripped it; the silver grabs
 * never come near it.
 *
 * What this cannot see: a patch that renumbers an event code. The handler then simply stops being
 * called, and silence has no failure rate. That drift arrives through the upstream watch instead —
 * madvac's daily job re-derives the codes (see .github/workflows/upstream-sync.yml on main).
 */

const WINDOW_MS = 10 * 60_000
const BUCKET_MS = 60_000
const MIN_FAILURES = 5

/** name → per-minute buckets `{ at, calls, failures }`, oldest first. */
let byHandler = new Map()

const bucket = (name, now) => {
  const at = now - (now % BUCKET_MS)
  let buckets = byHandler.get(name)

  if (buckets == null) {
    buckets = []
    byHandler.set(name, buckets)
  }

  const last = buckets[buckets.length - 1]

  if (last != null && last.at === at) {
    return last
  }

  const fresh = { at, calls: 0, failures: 0 }

  buckets.push(fresh)

  // Nothing older than the window is ever read again.
  while (buckets.length > 0 && buckets[0].at <= now - WINDOW_MS - BUCKET_MS) {
    buckets.shift()
  }

  return fresh
}

/** A packet was handed to this handler. */
const call = (name) => {
  bucket(name, Date.now()).calls += 1
}

/** …and the handler threw on it. */
const failure = (name) => {
  bucket(name, Date.now()).failures += 1
}

/** Every handler failing on most of its calls in the last ten minutes, by name. */
const broken = (now = Date.now()) => {
  const out = []

  for (const [name, buckets] of byHandler) {
    let calls = 0
    let failures = 0

    for (const b of buckets) {
      if (b.at > now - WINDOW_MS) {
        calls += b.calls
        failures += b.failures
      }
    }

    if (failures >= MIN_FAILURES && failures * 2 >= calls) {
      out.push({ name, failures, calls })
    }
  }

  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * The heartbeat's second line, printed every minute whatever it says: an engine that reports
 * nothing is an engine too old to have this, and "ok" must never be read into that silence.
 */
const statusLine = (now = Date.now()) => {
  const list = broken(now)

  if (list.length === 0) {
    return '[health] parse ok'
  }

  return `[health] parse broken: ${list.map((b) => `${b.name} ${b.failures}/${b.calls}`).join(', ')} (last 10 min)`
}

/** Test seam — module state would otherwise leak between cases. */
const reset = () => {
  byHandler = new Map()
}

module.exports = { call, failure, broken, statusLine, reset, WINDOW_MS, MIN_FAILURES }
