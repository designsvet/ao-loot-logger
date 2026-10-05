/**
 * Local patch (Guild Butler, 2026-10-05) — the member's player-to-player trades, one record per
 * FINISHED trade.
 *
 * The owner's ruling (raid-bot, 2026-10-05, "B"): a looter who trades loot to another member moves
 * the debt to the receiver. That needs to know a trade happened, what moved each way and with whom,
 * from the logger on ONE of the two machines. The bytes allow it — every fact below was read off the
 * owner's recordings of 2026-09-16 and 2026-09-21 (eight trades: seven finished, one cancelled):
 *
 *  - WHO. The partner's name and guild arrive once, at the invitation: as the RESPONSE to our own
 *    invite (op 161) when we asked, as event 176 when we were asked. The inviter never gets 176 and
 *    the invitee never gets the response. Neither repeats later, so an engine started mid-trade
 *    cannot know the partner and says so (`partner.name: null`, `complete: false`) — never a guess.
 *  - WHAT. Event 179 carries the WHOLE trade window, both sides, on every change: our items at
 *    6–16 (object ids, slots, item index, crafter, quality, …, quantity), the partner's at 17–26 (the
 *    same, minus object ids), our silver at 2 and theirs at 4 (×10,000, absent when 0). "Ours" is
 *    always the capturing client. Each update bumps a revision (param 1); only the highest is kept.
 *  - DONE. 180 finishes, 178 cancels — both carry the trade id alone. A cancelled offer is dropped
 *    whole: what somebody put in a window and took back was never traded, and is nobody's business.
 *  - INTEGRITY. Our own accept (request 166) names the revision we accepted, and it equalled the
 *    last 179 in 7 of 7 finished trades — any change to the window resets both accepts in game, so
 *    a finish always follows an accept of the window as it stands. A record whose last update is
 *    not the accepted revision is marked incomplete rather than trusted: OLDER missed an update (a
 *    dropped packet), NEWER missed our later accept or holds two trades under one id.
 *
 * Trade ids are a small per-server counter that resets and repeats (295…459, 1250, 1766, 3792 and
 * then 68–70 within three weeks) — a key for the trade in progress, never an identity. So an
 * invitation always starts a new session, dropping whatever was held under its id: the invite came
 * first in 8 of 8 recorded trades and the revisions restart at 2, so anything already there is an
 * earlier trade whose finish or cancel was lost — and kept, its higher revision would refuse every
 * update of the new one and write the old contents under the new partner. A zone change closes the
 * window in game, so a join clears everything; a session idle for ten minutes is dropped (an invite
 * nobody answered, a finish lost to the sniffer), and no more than eight are held.
 *
 * Hidden names (ruling default 3). In the Ancient Lands the game names every other player `PA`
 * (raid-bot ADR 0125; 3–16 characters is the rule for a real name, so `PA` is never a person). Trading
 * there is party-only, and whether the INVITE masks the partner as well has never been recorded. So a
 * partner is hidden when the invite says `PA`, OR when this zone has already shown a `PA` player
 * (an EvNewCharacter, or a looter in EvOtherGrabbedLoot — where ADR 0125 found the mask): the
 * partner of a party-only trade stands next to us, so in a masked zone the game has masked them —
 * and a real name the invite let slip is not written either. Reading the zone
 * id instead (the Ancient Lands' DRAGON_AREA_*) would be cleaner, but no Join into the Ancient Lands
 * has ever been recorded, so what its parameter 8 looks like is unknown; the `PA` sighting is the
 * signal the engine has actually seen.
 *
 * A zone's characters arrive BEFORE its Join response, not after: on 2026-09-21, 910 EvNewCharacter
 * fell in the three seconds before one of the 34 joins and 107 in the three seconds after, the burst
 * landing 6–11 ms ahead of the join, after a loading gap of seconds (4.1 s from the ChangeCluster
 * response in the sample read). So a join does not simply forget the mask: a `PA` seen in the
 * ARRIVAL_MS before it marks the new zone. One seen just before leaving an Ancient Lands map can
 * mark the next zone too — a name hidden that could have been shown, the safe way to be wrong.
 *
 * Pure: the clock is injected, nothing here reads the network, a file or the console. The wire is
 * parsed (and refused when its shape moved) by the handlers in src/data-handler; the record is
 * written by src/trades/index.js.
 */

const TTL_MS = 10 * 60_000
const MAX_SESSIONS = 8
const ARRIVAL_MS = 2000

/** The name the game writes for a player it hides (raid-bot `HIDDEN_LOOTER_NAME`, ADR 0125). */
const HIDDEN_NAME = 'PA'

/** Whole value, trimmed, any case — never a substring: a real `PAladin` is a person. */
const isHiddenName = (name) => typeof name === 'string' && name.trim().toUpperCase() === HIDDEN_NAME

const createPlayerTrades = ({ now = () => Date.now(), ttlMs = TTL_MS, maxSessions = MAX_SESSIONS } = {}) => {
  let sessions = new Map() // trade id -> session
  let zone = null
  let maskedZone = false
  let lastMaskAt = null

  const sweep = () => {
    const t = now()

    for (const [tradeId, session] of sessions) {
      if (t - session.touchedAt > ttlMs) {
        sessions.delete(tradeId)
      }
    }
  }

  /** The session for this trade id, opened if there is none (an app started mid-trade). */
  const sessionFor = (tradeId) => {
    sweep()

    let session = sessions.get(tradeId)

    if (session == null) {
      session = {
        tradeId,
        initiator: null,
        partner: null, // { objId, name, guild } — the object id never leaves memory
        inviteSeen: false,
        revision: null,
        content: null,
        acceptedRevision: null,
        touchedAt: now()
      }
      sessions.set(tradeId, session)

      // Over the cap: the one touched longest ago goes.
      while (sessions.size > maxSessions) {
        let oldest = null

        for (const candidate of sessions.values()) {
          if (oldest == null || candidate.touchedAt < oldest.touchedAt) {
            oldest = candidate
          }
        }

        sessions.delete(oldest.tradeId)
      }
    }

    session.touchedAt = now()

    return session
  }

  /**
   * An invitation, either way: `initiator` is 'self' (we asked: response 161) or 'partner' (event
   * 176). Always a new trade — a session already held under this id is an earlier one (see above).
   */
  const invited = ({ tradeId, initiator, partner }) => {
    sessions.delete(tradeId)

    const session = sessionFor(tradeId)

    session.initiator = initiator
    session.partner = { objId: partner.objId ?? null, name: partner.name ?? null, guild: partner.guild ?? null }
    session.inviteSeen = true
  }

  /** The trade window as it stands. An update older than the one held is ignored. */
  const updated = ({ tradeId, revision, gave, got, silverGave, silverGot }) => {
    const session = sessionFor(tradeId)

    if (session.revision != null && revision < session.revision) {
      return false
    }

    session.revision = revision
    session.content = { gave, got, silverGave, silverGot }

    return true
  }

  /** Our own accept names the revision it accepted. Nothing to attach it to: nothing to do. */
  const accepted = ({ tradeId, revision }) => {
    sweep()

    const session = sessions.get(tradeId)

    if (session != null) {
      session.acceptedRevision = revision
      session.touchedAt = now()
    }
  }

  /** Cancelled: forgotten whole, offer included. Nothing is ever written for it. */
  const cancelled = (tradeId) => {
    sessions.delete(tradeId)
  }

  /**
   * Finished: the trade as it closed, or null when there is nothing to say — no session (expired,
   * or the engine started after the last update) or no update ever seen.
   */
  const finished = (tradeId) => {
    sweep()

    const session = sessions.get(tradeId)

    sessions.delete(tradeId)

    if (session == null || session.content == null) {
      return null
    }

    const hidden = maskedZone || isHiddenName(session.partner?.name)
    // No accept seen (the partner accepted last, or the request was lost) is not evidence of a gap.
    const intact = session.acceptedRevision == null || session.revision === session.acceptedRevision

    return {
      tradeId,
      zone,
      initiator: session.initiator,
      partner: hidden
        ? { name: null, guild: null, hidden: true }
        : { name: session.partner?.name ?? null, guild: session.partner?.guild ?? null, hidden: false },
      revision: session.revision,
      acceptedRevision: session.acceptedRevision,
      complete: session.inviteSeen && intact,
      gave: session.content.gave,
      got: session.content.got,
      silverGave: session.content.silverGave,
      silverGot: session.content.silverGot
    }
  }

  /** A zone join: the game closes every trade window; the zone is masked if its arrival burst was. */
  const zoneChanged = (zoneId = null) => {
    sessions = new Map()
    zone = typeof zoneId === 'string' ? zoneId : null
    maskedZone = lastMaskAt != null && now() - lastMaskAt <= ARRIVAL_MS
  }

  /** A player's name as the game sent it (EvNewCharacter, EvOtherGrabbedLoot's looter). `PA` marks the zone. */
  const sawCharacter = (name) => {
    if (isHiddenName(name)) {
      maskedZone = true
      lastMaskAt = now()
    }
  }

  return {
    invited,
    updated,
    accepted,
    cancelled,
    finished,
    zoneChanged,
    sawCharacter,
    size: () => sessions.size,
    state: () => ({ zone, maskedZone, sessions: [...sessions.keys()] })
  }
}

/**
 * The line the trade file holds — record v1. `item(index)` names an item by the engine's one rule
 * (src/items.js `resolve`: a current table, else `UNKNOWN_<index>`); `self` is the joined character.
 *
 * What is NEVER here, by construction: crafter names (third parties), object ids (ours or the
 * partner's), durability, spells and passives, and parameters 3 and 5 of the update (unknown; gold
 * has not been tradable since 2017). Only what this list builds can reach the file.
 */
const buildRecord = (trade, { at, server = null, self = null, item }) => {
  const line = (entry) => ({ index: entry.index, item: item(entry.index).itemId, qty: entry.qty, quality: entry.quality })
  const text = (value) => (typeof value === 'string' && value.trim() !== '' ? value : null)

  return {
    v: 1,
    t: 'trade',
    at,
    server: text(server),
    zone: trade.zone ?? null,
    tradeId: trade.tradeId,
    initiator: trade.initiator ?? null,
    self: { name: text(self?.playerName), guild: text(self?.guildName), alliance: text(self?.allianceName) },
    partner: { name: trade.partner.name, guild: text(trade.partner.guild), hidden: trade.partner.hidden },
    revision: trade.revision,
    acceptedRevision: trade.acceptedRevision,
    complete: trade.complete,
    gave: trade.gave.map(line),
    got: trade.got.map(line),
    silverGave: trade.silverGave,
    silverGot: trade.silverGot
  }
}

/**
 * The console line, in the loot line's manner:
 * `18:14:36 UTC: {UA} [VITRYLA] Bors traded 11x Major Gigantify Potion to [VITRYLA] Guildmate.`
 * Names are passed in already formatted (the loot line's alliance, guild and colour); items are
 * named by `itemName(index)`.
 */
const describeTrade = (record, { selfName, partnerName, itemName }) => {
  const date = new Date(record.at)
  const clock = [date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()].map((n) => String(n).padStart(2, '0')).join(':')
  const silver = (n) => `${n.toLocaleString('en-US')} silver`
  const goods = (entries, amount) => [...entries.map((e) => `${e.qty}x ${itemName(e.index)}`), ...(amount > 0 ? [silver(amount)] : [])].join(', ')

  const gave = goods(record.gave, record.silverGave)
  const got = goods(record.got, record.silverGot)
  let what

  if (gave !== '' && got !== '') {
    what = `traded ${gave} to ${partnerName} for ${got}`
  } else if (gave !== '') {
    what = `traded ${gave} to ${partnerName}`
  } else if (got !== '') {
    what = `received ${got} from ${partnerName}`
  } else {
    what = `finished an empty trade with ${partnerName}`
  }

  return `${clock} UTC: ${selfName} ${what}.${record.complete ? '' : ' (incomplete: the trade was already open when capture started, or an update or accept was missed)'}`
}

module.exports = { createPlayerTrades, buildRecord, describeTrade, isHiddenName, HIDDEN_NAME, TTL_MS, MAX_SESSIONS, ARRIVAL_MS }
