const Trades = require('../../trades')
const Logger = require('../../utils/logger')
const { parseInvite } = require('../player-trade-wire')

const name = 'OpInviteToPlayerTrade'

/**
 * Local patch (Guild Butler, 2026-10-05): the answer to OUR invitation — the only packet that names
 * the partner when we asked (they get event 176, we never do). A refused invite ("You can't trade
 * here", an auto-reject) comes back with a non-zero return code and opens nothing.
 */
function handle(event) {
  if (event.returnCode !== 0) {
    Logger.debug('OpInviteToPlayerTrade refused', { returnCode: event.returnCode })
    return
  }

  const { tradeId, partner } = parse(event)

  Trades.machine.invited({ tradeId, initiator: 'self', partner })
}

function parse(event) {
  return parseInvite(event.parameters, name)
}

module.exports = { name, handle, parse }
