const Trades = require('../../trades')
const TradeWindow = require('../../storage/trade-window')
const { parseUpdate } = require('../player-trade-wire')

const name = 'EvPlayerTradeUpdate'

/**
 * Local patch (Guild Butler, 2026-10-05): the whole trade window, both sides, on every change.
 * Only the highest revision is kept — see src/trades/player-trades.js.
 */
function handle(event) {
  const update = parse(event)

  Trades.machine.updated(update)

  // Local patch: while it is open, what it hands us is not chest loot — see storage/trade-window.js.
  TradeWindow.updated(update.tradeId)
}

function parse(event) {
  return parseUpdate(event.parameters)
}

module.exports = { name, handle, parse }
