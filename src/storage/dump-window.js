/**
 * Local patch (Guild Butler, 2026-09-01) — the guild-screen instrument.
 *
 * Standing question: when you open the guild's Siphoned Energy screen, does your
 * client receive the numbers the screen draws — the account total, and the rows
 * behind the 📋 log button?
 *
 * It must: the client renders them. What is not known is WHICH message carries
 * them and in what shape. The reference enum names a `GetGuildEnergyDrainInfo`
 * operation and `GuildVaultInfo` / `GuildStats` / `UpdateCurrency` events, but
 * operation codes drift between game patches (see src/config.js), so the code is
 * a lead, not an answer. The only way to know is to look.
 *
 * So: for a bounded window, write EVERY event, request and response to its own
 * file, with values. Deliberately not the debug log — winston rotates that at
 * 5MB across two files, which is exactly enough to eat a large log response, and
 * mixing this into the loot log makes both unreadable.
 *
 * OFF by default. This dumps your guild's data to a file on your disk; arm it
 * when you mean to, and read the file before sharing it.
 *
 * Two modes since 2026-09-09:
 *
 *  - `g` / DUMP_PACKETS=1 — the original 120-second window, for "open one screen
 *    and see what arrives".
 *  - DUMP_PACKETS=session — the WHOLE run, until Ctrl-C, for the activity-stats
 *    recordings (which stats does an evening of play put on the wire, and in what
 *    shape). A twenty-minute session is tens of thousands of records; the cap is
 *    there to stop a forgotten terminal filling a disk overnight, not to bound a
 *    recording. Events with no event code (the Move stream, half of all traffic,
 *    carrying an object id and a position blob) are skipped in this mode: they are
 *    exactly the presence data nobody should be recording for twenty minutes, and
 *    they answer nothing the recording asks.
 */

const WINDOW_MS = 120_000;
const MAX_RECORDS = 8000;
const SESSION_MAX_RECORDS = 2_000_000;

// DUMP_PACKETS=1 arms at startup instead of on a keypress — for the Electron child
// process and any run whose stdin is not a terminal, where the key never arrives.
let session = process.env.DUMP_PACKETS === 'session';
let armedAt = process.env.DUMP_PACKETS === '1' || session ? Date.now() : 0;
let records = 0;

/** Open (or restart) the bounded window. Returns the seconds it will stay open. */
const arm = () => {
  session = false;
  armedAt = Date.now();
  records = 0;

  return WINDOW_MS / 1000;
};

/** Open the session recording: stays open until `disarm()`. */
const armSession = () => {
  session = true;
  armedAt = Date.now();
  records = 0;
};

const disarm = () => {
  armedAt = 0;
  session = false;
};

const isSession = () => session && armedAt > 0;

const isOpen = () => armedAt > 0 && (session || Date.now() - armedAt <= WINDOW_MS);

/**
 * Should this packet be written? Consumes one of the window's budget.
 *
 * `id` is the event or operation code the caller read off the packet; a session
 * recording declines a packet without one (see the header). The bounded window
 * keeps taking everything, because that is what its investigation asked for.
 */
const shouldDump = (id) => {
  if (!isOpen()) {
    return false;
  }

  if (session && id == null) {
    return false;
  }

  if (records >= (session ? SESSION_MAX_RECORDS : MAX_RECORDS)) {
    return false;
  }

  records += 1;

  return true;
};

const written = () => records;

module.exports = {
  arm,
  armSession,
  disarm,
  isOpen,
  isSession,
  shouldDump,
  written,
  WINDOW_MS,
  MAX_RECORDS,
  SESSION_MAX_RECORDS
};
