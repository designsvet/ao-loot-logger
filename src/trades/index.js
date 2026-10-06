const Items = require('../items')
const MemoryStorage = require('../storage/memory-storage')
const ServerRegion = require('../network/server-region')
const formatPlayerName = require('../utils/format-player-name')
const { green, red } = require('../utils/colors')
const { createPlayerTrades, buildRecord, describeTrade } = require('./player-trades')
const { TradeLog } = require('./trade-log')

/**
 * Local patch (Guild Butler, 2026-10-05) — the live wiring: the trade handlers in src/data-handler
 * feed `machine`; a finish is turned into a record here, written to the trade file (when
 * TRADE_EVENTS=1) and announced on the console like a loot line (always — the console is the
 * member's own screen).
 *
 * `print` is a seam for the tests; the console otherwise.
 */
const Trades = {
  log: new TradeLog(),
  machine: createPlayerTrades(),
  print: (line) => console.info(line),

  /** A finished trade, as `machine.finished` returned it → the written record. */
  commit(trade) {
    const self = MemoryStorage.players.self
    // Each index resolved once: a miss against a current table is logged by `resolve`, once is enough.
    const named = new Map()
    const resolve = (index) => {
      if (!named.has(index)) {
        named.set(index, Items.resolve(index))
      }

      return named.get(index)
    }
    const record = buildRecord(trade, {
      at: new Date(Date.now()).toISOString(),
      // The region token of the packet that finished the trade ("europe" / "americas" / "asia"), the
      // label every line the bot stores carries (festivities, energy) — not the loot line's display
      // name. Read here, synchronously inside the event-180 handler, while it names that packet.
      server: ServerRegion.getPacketRegionToken(),
      self,
      item: resolve
    })

    Trades.log.write(record)

    const partnerName = record.partner.hidden
      ? 'a hidden player'
      : record.partner.name == null
        ? 'an unknown player'
        : formatPlayerName({ playerName: record.partner.name, guildName: record.partner.guild }, red)

    Trades.print(
      describeTrade(record, {
        selfName: self != null ? formatPlayerName(self, green) : 'You',
        partnerName,
        itemName: (index) => resolve(index).itemName
      })
    )

    return record
  }
}

// One exit hook per process, closing whichever Trades is current: the tests re-require this module
// (test/helpers.js `fresh`), and a hook per require trips Node's listener-leak warning.
const CURRENT = Symbol.for('guild-butler.trades.current')

if (globalThis[CURRENT] == null) {
  process.on('exit', () => globalThis[CURRENT].log.close())
}

globalThis[CURRENT] = Trades

module.exports = Trades
