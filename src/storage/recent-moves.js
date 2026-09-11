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
 */

const PAIR_MS = 2_000

let pending = []

const fresh = (now) => pending.filter((move) => now - move.at <= PAIR_MS)

const record = (fromUuid, toUuid) => {
  const now = Date.now()

  pending = fresh(now)
  pending.push({ fromUuid, toUuid, at: now })
}

/** The source of the oldest unanswered request into `toUuid`, or null. Consumed. */
const sourceOf = (toUuid) => {
  if (toUuid == null) {
    return null
  }

  pending = fresh(Date.now())

  const at = pending.findIndex((move) => move.toUuid === toUuid)

  if (at < 0) {
    return null
  }

  const [move] = pending.splice(at, 1)

  return move.fromUuid
}

module.exports = { record, sourceOf, PAIR_MS }
