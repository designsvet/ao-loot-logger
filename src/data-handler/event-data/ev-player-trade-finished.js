const Trades = require('../../trades')
const TradeWindow = require('../../storage/trade-window')
const { parseBareTradeId } = require('../player-trade-wire')

const name = 'EvPlayerTradeFinished'

/**
 * Local patch (Guild Butler, 2026-10-05): the trade went through. The last update seen is the trade;
 * it is written as one record (src/trades/index.js). No session, or no update ever seen, writes nothing.
 */
function handle(event) {
  const tradeId = parse(event)
  const trade = Trades.machine.finished(tradeId)

  // Local patch: the hand-over may land just after this — see storage/trade-window.js.
  TradeWindow.ended(tradeId)

  if (trade != null) {
    Trades.commit(trade)
  }
}

function parse(event) {
  return parseBareTradeId(event.parameters, name)
}

module.exports = { name, handle, parse }
