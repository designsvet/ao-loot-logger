const Trades = require('../../trades')
const { parseUpdate } = require('../player-trade-wire')

const name = 'EvPlayerTradeUpdate'

/**
 * Local patch (Guild Butler, 2026-10-05): the whole trade window, both sides, on every change.
 * Only the highest revision is kept — see src/trades/player-trades.js.
 */
function handle(event) {
  Trades.machine.updated(parse(event))
}

function parse(event) {
  return parseUpdate(event.parameters)
}

module.exports = { name, handle, parse }
