/**
 * Local patch (Guild Butler, 2026-09-18) — the member's own activity, one line per completed thing.
 *
 * Phase 1 of the activity-stats plan (raid-bot `docs/plans/2026-09-capture-activity-stats.md`,
 * rulings Q39). Everything here was pinned against two real recordings made on the owner's Mac
 * (2026-09-16, five hours; 2026-09-18, the market and a fish that got away), and three of the
 * rules below are there because the recordings disagreed with the reference tool's model:
 *
 *  - WHO. The member's object id is the Join response's parameter 0, and the game REISSUES it on
 *    every zone join (79 joins, 79 ids, one character). It is not "the top damage causer": in
 *    group content a partymate out-damages you. Events addressed only to the member carried the
 *    current join id every time — fame 104/105, fishing 239/239, focus 2/2, journals 6/6.
 *  - BROADCAST. Silver pickups (62) and harvests (61) arrive for the players around the member
 *    too (18 of 355 pickups were the member's), so both are filtered on the join id.
 *  - FISH. A catch is RewardGranted (267) inside a bout the server narrates on event 355
 *    (parameter 3: 3 line out · 4 cast · 5 bite · 7/8 a tug · 9 landed · 10 escaped · 15 aborted).
 *    An escape OMITS the success flag rather than sending false.
 *
 * Nothing here deduplicates by payload. A genuine second event can be byte-identical to the first
 * (a craft's fame arrived as 44,640 · 267,840 · 44,640, all real), so resent commands are dropped
 * where they can be told apart — by sequence number, in the Photon parser. The two things that
 * happen at most once per object (a mob's death, a chest's opening) are also guarded per object,
 * which costs nothing and survives a resend the parser could not see.
 *
 * Money and fame are written RAW — the game's fixed-point integers (value × 10,000) — because
 * neither divides evenly (a pickup of 788.535 silver is 7,885,350). The reader divides; the line
 * keeps every digit. Mob and zone ids are written as the game sends them and named downstream,
 * where the tables live.
 *
 * Off unless ACTIVITY_EVENTS=1: the capture app turns it on once it can upload the file.
 */

const EV = {
  Leave: 1,
  HealthUpdate: 6,
  HealthUpdates: 7,
  HarvestFinished: 61,
  TakeSilver: 62,
  UpdateFame: 82,
  UpdateReSpecPoints: 84,
  UpdateCurrency: 85,
  NewMob: 123,
  RewardGranted: 267,
  FishingState: 355,
  NewLootChest: 393,
  UpdateLootChest: 394,
  MightAndFavor: 497
}

const OP = { Join: 2 }

const FISH = { LineOut: 3, Landed: 9, Escaped: 10, Aborted: 15 }

const CHEST_OPENED = 7

/** Numbers arrive as numbers, or as BigInt for 64-bit fields. */
const num = (value) => {
  if (typeof value === 'number') {
    return value
  }

  if (typeof value === 'bigint') {
    return Number(value)
  }

  return NaN
}

const has = (parameters, key) => parameters != null && Object.prototype.hasOwnProperty.call(parameters, key)

/** A GUID arrives as 16 bytes (an array or a buffer); compare as hex. */
const guidHex = (value) => {
  if (value == null) {
    return null
  }

  const bytes = Buffer.isBuffer(value) ? value : Array.isArray(value) || ArrayBuffer.isView(value) ? Buffer.from(value) : null

  return bytes != null && bytes.length === 16 ? bytes.toString('hex') : null
}

/** The chest's opener list: 16-byte GUIDs, either concatenated in one byte array or as an array of them. */
const openerHexes = (value) => {
  if (value == null) {
    return []
  }

  if (Array.isArray(value) && value.length > 0 && typeof value[0] !== 'number') {
    return value.map(guidHex).filter((hex) => hex != null)
  }

  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value)
  const out = []

  for (let i = 0; i + 16 <= bytes.length; i += 16) {
    out.push(bytes.subarray(i, i + 16).toString('hex'))
  }

  return out
}

/**
 * The tracker, with its outputs injected so tests can drive it: `sink(record)` receives each
 * line, `items.get(index)` names an item, `now()` stamps it.
 */
const createActivity = ({ sink, items, now = () => Date.now() }) => {
  const self = { id: null, previousId: null, guid: null, name: null, fameTotal: null }
  let zone = null
  let mobs = new Map() // object id -> { index, hp }
  let damaged = new Set() // object ids the member has hit this zone
  let killed = new Set() // object ids whose death was already written
  let chests = new Map() // object id -> { name, rarity }
  let opened = new Set() // chest object ids already written
  let bout = null // { rod, spot, rewards: [] }

  const itemId = (index) => {
    const item = items.get(num(index))

    return item != null ? item.itemId : `UNKNOWN_${num(index)}`
  }

  // Every item travels with its index: a name is only as good as the table that produced it, and
  // the engine's fallback table is positional and stale (see src/items.js). The zone line says
  // which table was in use, so a reader can re-resolve the index instead of trusting the name.
  const itemRef = (index) => ({ item: itemId(index), index: num(index) })

  const emit = (t, fields) => {
    sink({ v: 1, t, at: now(), char: self.name, zone, ...fields })
  }

  const isSelf = (id) => self.id != null && num(id) === self.id

  const onJoin = (p) => {
    const id = num(p[0])

    if (!Number.isFinite(id) || typeof p[2] !== 'string') {
      return // shape check: silent on a payload this does not recognise
    }

    self.previousId = self.id
    self.id = id
    self.guid = guidHex(p[1]) ?? self.guid
    self.name = p[2]
    zone = typeof p[8] === 'string' ? p[8] : null

    // Object ids are per zone: nothing seen before the join can be matched after it.
    mobs = new Map()
    damaged = new Set()
    killed = new Set()
    chests = new Map()
    opened = new Set()
    bout = null

    const fameTotal = num(p[35])

    if (Number.isFinite(fameTotal)) {
      self.fameTotal = Math.max(self.fameTotal ?? 0, fameTotal)
    }

    emit('zone', { items: items.source ?? 'unknown', ...(Number.isFinite(fameTotal) ? { fame_total: fameTotal } : {}) })
  }

  const onHit = (target, delta, died, causer) => {
    if (!(delta < 0)) {
      return
    }

    if (isSelf(causer)) {
      damaged.add(target)
    }

    if (!died || !damaged.has(target) || killed.has(target)) {
      return
    }

    const mob = mobs.get(target)

    if (mob == null) {
      return // a player, or something that never announced itself as a mob
    }

    killed.add(target)
    emit('kill', { mob: mob.index, hp: mob.hp })
  }

  const onEvent = (p) => {
    const code = num(p[252])

    switch (code) {
      case EV.UpdateFame: {
        const actor = num(p[0])
        const gain = num(p[2])
        const total = num(p[1])

        if (!Number.isFinite(gain)) {
          return
        }

        // Addressed to the member alone, under the CURRENT zone's id. An event under the previous
        // zone's id counts only if its running total is new: on 2026-09-16 the one such event was a
        // stale copy of a gain from 45 seconds earlier — same gain, same total, a total BELOW the
        // current one — and counting it broke the fame audit by exactly its amount.
        if (actor !== self.id) {
          const isLateButNew = actor === self.previousId && Number.isFinite(total) && self.fameTotal != null && total > self.fameTotal

          if (!isLateButNew) {
            return
          }
        }

        if (Number.isFinite(total)) {
          self.fameTotal = Math.max(self.fameTotal ?? 0, total)
        }

        emit('fame', { gain, premium: p[5] === true, ...(Number.isFinite(total) ? { total } : {}) })
        return
      }

      case EV.TakeSilver: {
        if (!isSelf(p[0]) || !Number.isFinite(num(p[3]))) {
          return
        }

        emit('silver', {
          yield: num(p[3]),
          cluster_tax: num(p[4]) || 0,
          guild_tax: num(p[5]) || 0,
          alliance_tax: num(p[6]) || 0,
          premium: p[7] === true
        })
        return
      }

      case EV.UpdateReSpecPoints: {
        const gained = num(p[2])

        if (!Number.isFinite(gained)) {
          return
        }

        emit('respec', { gained, paid: num(p[3]) || 0 })
        return
      }

      case EV.MightAndFavor: {
        const might = num(p[1])
        const favor = num(p[4])

        if (!Number.isFinite(might) && !Number.isFinite(favor)) {
          return
        }

        emit('might', {
          might: might || 0,
          might_bonus: num(p[2]) || 0,
          might_premium: num(p[3]) || 0,
          favor: favor || 0,
          favor_bonus: num(p[5]) || 0,
          favor_premium: num(p[6]) || 0
        })
        return
      }

      case EV.UpdateCurrency: {
        const gained = num(p[3])

        if (!Number.isFinite(gained)) {
          return
        }

        emit('faction', { city: num(p[2]), gained, ...(Number.isFinite(num(p[9])) ? { total: num(p[9]) } : {}) })
        return
      }

      case EV.HarvestFinished: {
        if (!isSelf(p[0]) || !Number.isFinite(num(p[4]))) {
          return
        }

        emit('harvest', { ...itemRef(p[4]), std: num(p[5]) || 0, bonus: num(p[6]) || 0, premium: num(p[7]) || 0 })
        return
      }

      case EV.FishingState: {
        if (!isSelf(p[0])) {
          return
        }

        const state = num(p[3])

        if (state === FISH.LineOut) {
          bout = {
            rod: Number.isFinite(num(p[2])) ? itemId(p[2]) : null,
            rod_index: Number.isFinite(num(p[2])) ? num(p[2]) : null,
            rewards: []
          }
        } else if (bout != null && (state === FISH.Landed || state === FISH.Escaped)) {
          emit('fish', {
            outcome: state === FISH.Landed ? 'landed' : 'escaped',
            rod: bout.rod,
            rod_index: bout.rod_index,
            catch: state === FISH.Landed ? bout.rewards : []
          })
          bout = null
        } else if (state === FISH.Aborted) {
          bout = null
        }

        return
      }

      case EV.RewardGranted: {
        // Fishing is the only place a reward was seen (2 of 2, and every one on 2026-09-18).
        if (bout == null || !Number.isFinite(num(p[1]))) {
          return
        }

        bout.rewards.push({ ...itemRef(p[1]), qty: num(p[3]) || 1 })
        return
      }

      case EV.NewMob: {
        const id = num(p[0])

        if (Number.isFinite(id) && Number.isFinite(num(p[1]))) {
          mobs.set(id, { index: num(p[1]), hp: Number.isFinite(num(p[14])) ? num(p[14]) : null })
        }

        return
      }

      case EV.HealthUpdate: {
        // A killing blow OMITS the new health (Photon drops zeros).
        onHit(num(p[0]), num(p[2]), !has(p, 3), num(p[6]))
        return
      }

      case EV.HealthUpdates: {
        // The batched form: one target, parallel arrays. In an array a zero cannot be dropped, so a death is a 0.
        const target = num(p[0])
        const deltas = Array.isArray(p[2]) ? p[2] : []
        const healths = Array.isArray(p[3]) ? p[3] : []
        const causers = Array.isArray(p[6]) ? p[6] : []

        deltas.forEach((delta, i) => onHit(target, num(delta), num(healths[i]) === 0, num(causers[i])))
        return
      }

      case EV.NewLootChest: {
        const id = num(p[0])

        if (Number.isFinite(id) && typeof p[3] === 'string') {
          chests.set(id, { name: p[3], rarity: Number.isFinite(num(p[21])) && num(p[21]) >= 0 ? num(p[21]) : num(p[23]) })
        }

        return
      }

      case EV.UpdateLootChest: {
        const id = num(p[0])

        if (self.guid == null || opened.has(id)) {
          return
        }

        // Parameter 3 lists the players with a right to the chest; parameter 1 is its state, 7 once
        // opened (an update carrying the list and no state is an opening too). Both must hold.
        const openers = openerHexes(p[3])
        const isOpened = num(p[1]) === CHEST_OPENED || (!has(p, 1) && openers.length > 0)

        if (!isOpened || !openers.includes(self.guid)) {
          return // not opened, or not the member's
        }

        const chest = chests.get(id)

        opened.add(id)
        emit('chest', { name: chest?.name ?? null, rarity: Number.isFinite(chest?.rarity) ? chest.rarity : null })
        return
      }

      default:
    }
  }

  return {
    onEvent: (event) => onEvent(event?.parameters ?? {}),
    onResponse: (event) => {
      if (num(event?.parameters?.[253]) === OP.Join) {
        onJoin(event.parameters)
      }
    },
    state: () => ({ self: { ...self }, zone, mobs: mobs.size, bout })
  }
}

module.exports = { createActivity, EV, OP, FISH, CHEST_OPENED, __test: { num, guidHex, openerHexes } }
