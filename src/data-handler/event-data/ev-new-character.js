const MemoryStorage = require('../../storage/memory-storage')
const Logger = require('../../utils/logger')
const ParserError = require('../parser-error')
const Trades = require('../../trades')

const name = 'EvNewCharacter'

function handle(event) {
  const { allianceName, guildName, playerName } = parse(event)

  // Local patch (Guild Butler, 2026-10-05): a character the game names `PA` marks this zone as one
  // that hides players, so a trade here never writes the partner's name — see
  // src/trades/player-trades.js. Reads the name only; nothing below changes.
  Trades.machine.sawCharacter(playerName)

  let player = MemoryStorage.players.getByName(playerName)

  if (player == null) {
    player = MemoryStorage.players.add({ playerName, guildName, allianceName })
  }

  if (player.guildName !== guildName) {
    player.guildName = guildName
  }

  if (player.allianceName !== allianceName) {
    player.allianceName = allianceName
  }

  Logger.debug('EvNewCharacter', player, event.parameters)
}

function parse(event) {
  const playerName = event.parameters[1]

  if (typeof playerName !== 'string') {
    throw new ParserError('EvNewCharacter has invalid playerName parameter', event)
  }

  const guildName = event.parameters[8]
  const allianceName = event.parameters[51]

  return { allianceName, guildName, playerName }
}

module.exports = { name, handle, parse }
