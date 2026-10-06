const Trades = require('../../trades')
const { parseAccept } = require('../player-trade-wire')

const name = 'OpPlayerTradeAcceptTrade'

/**
 * Local patch (Guild Butler, 2026-10-05): our own accept, naming the revision accepted — the check
 * that the last update we saw is the one that was agreed (src/trades/player-trades.js, INTEGRITY).
 */
function handle(event) {
  Trades.machine.accepted(parse(event))
}

function parse(event) {
  return parseAccept(event.parameters)
}

module.exports = { name, handle, parse }
