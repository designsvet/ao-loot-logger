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
 */

const WINDOW_MS = 120_000;
const MAX_RECORDS = 8000;

// DUMP_PACKETS=1 arms at startup instead of on a keypress — for the Electron child
// process and any run whose stdin is not a terminal, where the key never arrives.
let armedAt = process.env.DUMP_PACKETS === '1' ? Date.now() : 0;
let records = 0;

/** Open (or restart) the window. Returns the seconds it will stay open. */
const arm = () => {
  armedAt = Date.now();
  records = 0;

  return WINDOW_MS / 1000;
};

const disarm = () => {
  armedAt = 0;
};

const isOpen = () => armedAt > 0 && Date.now() - armedAt <= WINDOW_MS;

/** Should this packet be written? Consumes one of the window's budget. */
const shouldDump = () => {
  if (!isOpen()) {
    return false;
  }

  if (records >= MAX_RECORDS) {
    return false;
  }

  records += 1;

  return true;
};

const written = () => records;

module.exports = { arm, disarm, isOpen, shouldDump, written, WINDOW_MS, MAX_RECORDS };
