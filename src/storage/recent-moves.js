/**
 * Local patch (Guild Butler, 2026-09-11) — where a put came FROM.
 *
 * EvInventoryPutItem names the container an item landed in and nothing else.
 * The only packet that names a SOURCE is your own request, OpInventoryMoveItem
 * ("slot 3 of container A to container B"), which the server answers with that
 * put. Measured on a real session (2026-09-10): every request was answered
 * 60–110 ms later, into the container it named.
 *
 * So requests are held briefly and paired with the next put into the same
 * container, oldest first — the server answers in order — and each pairs once,
 * so a request can never explain a later, unrelated put. A put with no request
 * (take-all, a reward, a stack the server moved itself) has no known source,
 * which is exactly what it had before this module existed.
 *
 * 2026-10-05: a split is held here too. OpInventorySplitStack names one container,
 * and the server answers it with a NEW object put into that same container —
 * measured on all 11 splits in the 2026-09-16 and 2026-09-21 recordings, 67–574 ms
 * later. So it is recorded as a request from that container into itself, of kind
 * 'split', and the put it pairs with is the new stack, not anything picked up.
 */

const PAIR_MS = 2_000

let pending = []

const fresh = (now) => pending.filter((move) => now - move.at <= PAIR_MS)

const record = (fromUuid, toUuid, kind = 'move') => {
  const now = Date.now()

  pending = fresh(now)
  pending.push({ fromUuid, toUuid, kind, at: now })
}

/** The oldest unanswered request into `toUuid` — `{ fromUuid, kind }` — or null. Consumed. */
const requestFor = (toUuid) => {
  if (toUuid == null) {
    return null
  }

  pending = fresh(Date.now())

  const at = pending.findIndex((move) => move.toUuid === toUuid)

  if (at < 0) {
    return null
  }

  const [{ fromUuid, kind }] = pending.splice(at, 1)

  return { fromUuid, kind }
}

module.exports = { record, requestFor, PAIR_MS }
