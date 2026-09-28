/**
 * Local patch (Guild Butler, 2026-08-19) — the decisive instrument.
 *
 * Standing question: when ANOTHER player — in your party or not — takes an item
 * out of an open-world / castle / outpost chest, does your client receive
 * ANYTHING naming them?
 *
 * Everything measured so far says no, but every "no" so far was measured with an
 * instrument that could not have seen a yes: unhandled events logged their
 * parameter KEYS only, and the name-matcher can only match players the client
 * already knows about — which excludes exactly the out-of-party stranger the
 * question is about.
 *
 * So: while a chest is in play, dump every unhandled event WITH ITS VALUES.
 * Bounded by a short window and a hard event cap, because a blanket dump is
 * 5863 events per 3.5 minutes and unreadable.
 *
 * ---------------------------------------------------------------------------
 * TWO clocks, and keeping them apart is the whole point (2026-08-29).
 *
 *   - the DUMP window opens on ANY container activity, because the debugging
 *     question above wants the widest net a bounded log can carry;
 *   - the ATTRIBUTION window opens ONLY when a chest names itself, and nothing
 *     else may extend it. It decides what gets WRITTEN to the loot log.
 *
 * They used to be one clock, and that is how a hideout deposit was logged as
 * chest loot. EvAttachItemContainer touches on EVERY container attach — your
 * bank, a mount bag, the hideout chest you are standing at — so `openedAt` was
 * pushed forward by the very deposit being misattributed, and a chest name from
 * hours earlier stayed "recent" for as long as you kept opening containers. The
 * comment below promised "seconds"; the code delivered "until you stop playing".
 * A window anything can extend is not a window.
 */

const WINDOW_MS = 90_000;
const MAX_DUMPS_PER_WINDOW = 1500;

/** Dump clock: any container activity. Debug only — never decides a log line. */
let activityAt = 0;
let dumps = 0;

/** Attribution clock: a chest named itself. Only this may name a loot source. */
let namedAt = 0;
let lastChestName = null;

/** Container activity happened — open (or extend) the DUMP window only. */
const touch = () => {
  const now = Date.now();

  if (now - activityAt > WINDOW_MS) {
    dumps = 0; // a fresh window gets a fresh budget
  }

  activityAt = now;
};

/**
 * A chest announced itself, by name — the only thing that may arm attribution.
 * A nameless chest event still counts as activity, so the dump window opens,
 * but it must NOT re-arm a name it does not carry.
 */
const named = (chestName) => {
  touch();

  if (typeof chestName !== 'string' || chestName.length === 0) {
    return;
  }

  lastChestName = chestName;
  namedAt = Date.now();
};

/** Should this unhandled event be dumped in full? */
const shouldDump = () => {
  if (Date.now() - activityAt > WINDOW_MS) {
    return false;
  }

  if (dumps >= MAX_DUMPS_PER_WINDOW) {
    return false;
  }

  dumps += 1;

  return true;
};

/**
 * The chest you are standing at, if one named itself recently.
 *
 * EvNewLootChest registers a chest by OBJECT id while EvAttachItemContainer
 * delivers items under a CONTAINER id, and the two do not always match — when
 * they don't, items arrive with no owner and every pickup is dropped, which is
 * how a whole chest run logged nothing. Taking items seconds after a chest
 * announced itself is enough to name the source honestly.
 *
 * "Seconds" is load-bearing, and it is the attribution clock that keeps it so.
 * Outside the window this returns null and an ownerless pickup goes back to
 * being dropped — which is the right answer for a deposit, a bank withdrawal or
 * a mount-bag shuffle, none of which the client tells us the origin of.
 */
const recentChestName = () => (Date.now() - namedAt <= WINDOW_MS ? lastChestName : null);

/**
 * A zone change ends attribution (2026-09-28). No chest in the map you left can be the
 * source of anything you pick up in the next one, and "the next one" is usually where the
 * bank is: 90 seconds is plenty to walk out of an open-world camp, zone into the hideout and
 * start moving gear, and every ownerless put there was named after the camp chest. Measured
 * in the same capture: across 12 joins, no chest named itself in the burst of new-map
 * objects that arrives before the join response, so clearing here drops nothing of the new
 * map's. Only attribution is cleared — the dump window is debugging and keeps its own clock.
 */
const zoneChanged = () => {
  namedAt = 0;
  lastChestName = null;
};

module.exports = { touch, named, shouldDump, recentChestName, zoneChanged, WINDOW_MS };
