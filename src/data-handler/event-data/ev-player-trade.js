const Config = require('../../config')
const Logger = require('../../utils/logger')
const TradeWindow = require('../../storage/trade-window')
const ParserError = require('../parser-error')

const name = 'EvPlayerTrade'

/**
 * Local patch (2026-10-05): a player trade's lifecycle, for storage/trade-window.js and nothing
 * else — what was traded, and with whom, is not read here. One handler for the four codes, as for
 * FestivitiesUpdate: they share the trade id at parameter 0, and only the update has more shape.
 */
function handle(event) {
  const { code, tradeId, revision } = parse(event)

  Logger.debug('EvPlayerTrade', { code, tradeId, revision })

  switch (code) {
    case Config.events.EvPlayerTradeUpdate:
      return TradeWindow.updated(tradeId)

    case Config.events.EvPlayerTradeAcceptChange:
      return TradeWindow.accepted(tradeId)

    case Config.events.EvPlayerTradeFinished:
    case Config.events.EvPlayerTradeCancel:
      return TradeWindow.ended(tradeId)
  }
}

function parse(event) {
  const code = event.parameters[252]
  const tradeId = event.parameters[0]

  if (!Number.isInteger(tradeId)) {
    throw new ParserError('EvPlayerTrade has invalid tradeId parameter')
  }

  if (code !== Config.events.EvPlayerTradeUpdate) {
    return { code, tradeId }
  }

  // The update is the one that opens a trade, so it is held to its whole recorded shape: a
  // revision, and both sides' item arrays — empty, but present, even when nothing is offered.
  const revision = event.parameters[1]

  if (!Number.isInteger(revision)) {
    throw new ParserError('EvPlayerTradeUpdate has invalid revision parameter')
  }

  if (!Array.isArray(event.parameters[6]) || !Array.isArray(event.parameters[18])) {
    throw new ParserError('EvPlayerTradeUpdate has invalid item parameters')
  }

  return { code, tradeId, revision }
}

module.exports = { name, handle, parse }
