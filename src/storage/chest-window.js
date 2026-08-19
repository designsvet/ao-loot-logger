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
 */

const WINDOW_MS = 90_000;
const MAX_DUMPS_PER_WINDOW = 1500;

let openedAt = 0;
let dumps = 0;

/** A chest event happened — open (or extend) the window. */
const touch = () => {
  const now = Date.now();

  if (now - openedAt > WINDOW_MS) {
    dumps = 0; // a fresh window gets a fresh budget
  }

  openedAt = now;
};

/** Should this unhandled event be dumped in full? */
const shouldDump = () => {
  if (Date.now() - openedAt > WINDOW_MS) {
    return false;
  }

  if (dumps >= MAX_DUMPS_PER_WINDOW) {
    return false;
  }

  dumps += 1;

  return true;
};

module.exports = { touch, shouldDump, WINDOW_MS };
