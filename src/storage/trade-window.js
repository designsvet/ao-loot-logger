/**
 * Local patch (Guild Butler, 2026-10-05) — is a player trade open?
 *
 * What a trade hands you arrives like a pickup: new objects and a put into your inventory, with no
 * request of yours to pair it with. Inside the chest window that put was written as loot from the
 * chest that named itself last — in the obvious place for it, too: a hand-over right after a boss
 * chest. So while a trade is open, and for a moment after it ends, an ownerless put is not a pickup.
 *
 * Measured on the 2026-09-16 and 2026-09-21 recordings (7 finished trades, 1 cancelled):
 *   - every trade opens with PlayerTradeUpdate (179) at revision 2, both sides empty, and sends
 *     another on every change; AcceptChange (181) comes with each, and when either side accepts;
 *   - it ends with Finished (180) or Cancel (178), both `{0: tradeId}`; on the giving side the
 *     hand-over (each item's last update and its deletion, 27) lands in the same millisecond as
 *     180, just BEFORE it;
 *   - trades lasted 6–23 s, never more than 5.3 s between two of these events.
 *
 * The receiving side has never been recorded — every trade there with items was ours to give — so
 * whether its put lands just before 180 or just after is not known. Both are covered: the trade is
 * open up to 180, and GRACE_MS after it.
 *
 * Fed by the trade decoder's own handlers (src/data-handler/event-data/ev-player-trade-*.js), after
 * their strict parse, and kept apart from its sessions on purpose: those open on an invite too and
 * live ten minutes, and an invite nobody answers (176) must not hide chest loot. So this opens on
 * 179 alone, an end only counts for the trade that is open, a trade whose end was lost stops
 * counting IDLE_MS after its last update, and a zone change ends it outright.
 */

const IDLE_MS = 5 * 60_000
const GRACE_MS = 2_000

/** The open trade, `{ id, at }` with `at` its last update, or null. */
let open = null
let endedAt = -Infinity

/** PlayerTradeUpdate: a trade is open, or still is. */
const updated = (tradeId) => {
  open = { id: tradeId, at: Date.now() }
}

/** PlayerTradeFinished or PlayerTradeCancel. */
const ended = (tradeId) => {
  if (open == null || open.id !== tradeId) {
    return
  }

  open = null
  endedAt = Date.now()
}

const zoneChanged = () => {
  open = null
  endedAt = -Infinity
}

/** Could a put right now be part of a trade? */
const isLive = () => {
  const now = Date.now()

  return (open != null && now - open.at <= IDLE_MS) || now - endedAt <= GRACE_MS
}

module.exports = { updated, ended, zoneChanged, isLive, IDLE_MS, GRACE_MS }
