const Trades = require('../../trades')
const TradeWindow = require('../../storage/trade-window')
const { parseBareTradeId } = require('../player-trade-wire')

const name = 'EvPlayerTradeCancel'

/**
 * Local patch (Guild Butler, 2026-10-05): the trade was called off. The session is dropped whole and
 * NOTHING is written — what a partner put in the window and took back was never traded.
 */
function handle(event) {
  const tradeId = parse(event)

  Trades.machine.cancelled(tradeId)
  TradeWindow.ended(tradeId)
}

function parse(event) {
  return parseBareTradeId(event.parameters, name)
}

module.exports = { name, handle, parse }
