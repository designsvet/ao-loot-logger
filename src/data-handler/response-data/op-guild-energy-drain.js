const ServerRegion = require('../../network/server-region')
const GuildIdentity = require('../../storage/guild-identity')
const { guidToAlbionId } = require('../../utils/albion-guid')

const name = 'OpGuildEnergyDrain'

/**
 * Local patch: the guild screen's drain block — and the only place the guild's own id
 * is known to arrive.
 *
 *   0  guildId       byte[16]
 *   1  territories   int   alliance territories held
 *   2  controlCost   int   territory control cost
 *
 * Observed as {0: <VITRYLA>, 1: 5, 2: 11} against a screen reading 5 territories and
 * 11/20 control cost. The screen's drain PERCENTAGE is not in this response — it is
 * presumably derived client-side from those two numbers, and is deliberately not
 * guessed at here.
 *
 * The id is the reason this handler matters beyond the drain: the energy total rides
 * an event that names the guild but carries only the ALLIANCE id, so without this the
 * reader has a name and nothing to key on. Remembering it here is what lets every
 * later energy line be attributed.
 */

const MAX_COUNT = 1e6

function read(params) {
  const albionGuildId = guidToAlbionId(params[0])

  if (albionGuildId === null) {
    return null
  }

  const territories = params[1]
  const controlCost = params[2]

  for (const value of [territories, controlCost]) {
    if (!Number.isInteger(value) || value < 0 || value > MAX_COUNT) {
      return null
    }
  }

  return { albionGuildId, territories, controlCost }
}

function serverToken() {
  const server = ServerRegion.getCurrentServer()

  return server && typeof server.region === 'string' ? server.region.toLowerCase() : null
}

function handle(event) {
  const drain = read(event.parameters)

  if (drain === null) {
    return
  }

  GuildIdentity.setGuildId(drain.albionGuildId)

  console.info(
    `[energy-drain] ${JSON.stringify({
      server: serverToken(),
      code: event.parameters[253],
      ...drain
    })}`
  )
}

module.exports = { name, handle, read }
