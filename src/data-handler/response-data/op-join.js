const MemoryStorage = require('../../storage/memory-storage')
const Logger = require('../../utils/logger')
const PendingSelfLoots = require('../../pending-self-loots')
const OwnContainers = require('../../storage/own-containers')
const ParserError = require('../parser-error')

const name = 'OpJoin'

function handle(event) {
  const { allianceName, guildName, playerName } = parse(event)

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

  MemoryStorage.players.self = player

  // Local patch: which containers are yours — see storage/own-containers.js.
  OwnContainers.learnFromJoin(event.parameters)

  // Local patch: anything looted before we knew who we were is written now.
  PendingSelfLoots.flush(player)

  Logger.debug('OpJoin', player, event.parameters)
}

function parse(event) {
  const playerName = event.parameters[2]

  if (typeof playerName !== 'string') {
    throw new ParserError('OpJoin has invalid playerName parameter')
  }

  const guildName = event.parameters[58]
  const allianceName = event.parameters[79]

  return { allianceName, guildName, playerName }
}

module.exports = { name, handle, parse }
