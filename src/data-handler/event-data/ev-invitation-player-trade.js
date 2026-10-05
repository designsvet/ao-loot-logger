const Trades = require('../../trades')
const { parseInvite } = require('../player-trade-wire')

const name = 'EvInvitationPlayerTrade'

/**
 * Local patch (Guild Butler, 2026-10-05): somebody invited us to trade. The only packet that names
 * the partner when THEY asked (the response to 161 is the inviter's) — see src/trades/player-trades.js.
 */
function handle(event) {
  const { tradeId, partner } = parse(event)

  Trades.machine.invited({ tradeId, initiator: 'partner', partner })
}

function parse(event) {
  return parseInvite(event.parameters, name)
}

module.exports = { name, handle, parse }
