const Trades = require('../../trades')
const { parseBareTradeId } = require('../player-trade-wire')

const name = 'EvPlayerTradeFinished'

/**
 * Local patch (Guild Butler, 2026-10-05): the trade went through. The last update seen is the trade;
 * it is written as one record (src/trades/index.js). No session, or no update ever seen, writes nothing.
 */
function handle(event) {
  const trade = Trades.machine.finished(parse(event))

  if (trade != null) {
    Trades.commit(trade)
  }
}

function parse(event) {
  return parseBareTradeId(event.parameters, name)
}

module.exports = { name, handle, parse }
