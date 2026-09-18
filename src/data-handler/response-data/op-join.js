const MemoryStorage = require('../../storage/memory-storage')
const Logger = require('../../utils/logger')
const PendingSelfLoots = require('../../pending-self-loots')
const AssignmentWritten = require('../../storage/assignment-written')
const Items = require('../../items')
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

  // Local patch: a new map numbers its objects afresh, so the chest-share ids the
  // last map wrote (storage/assignment-written.js) mean nothing here — and one
  // left over must not silence a real pickup that happens to reuse its number.
  AssignmentWritten.clear()

  // Local patch: a newer item table takes over here, between zones, never inside
  // one — see Items.onZoneChange in src/items.js. The new map's own objects can
  // arrive BEFORE this response (test-fixtures-packets.json: five EvNewSimpleItem
  // at reliable seq 27-31, this response at 32), so what is already held is
  // renamed by the new table too, or a stack of ours named by the old one would
  // not match a chest share named by the new one.
  if (Items.onZoneChange()) {
    MemoryStorage.loots.rename((itemNumId) => Items.resolve(itemNumId))
  }

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
