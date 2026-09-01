const GuildIdentity = require('../../storage/guild-identity')
const { guidToAlbionId } = require('../../utils/albion-guid')

const name = 'OpGuildLogRequest'

/**
 * Local patch: remember whose log is being fetched.
 *
 * The log RESPONSE carries no guild id, and the state event that carries the energy total
 * carries the ALLIANCE id. The request is the one message that names the guild itself, on
 * every fetch — which makes it a better source than the drain response this file's sibling
 * uses, because that one only fires if somebody opens the guild screen.
 *
 * Reads nothing else and prints nothing. The page handler does the emitting.
 */
function handle(event) {
  const albionGuildId = guidToAlbionId(event?.parameters?.[0])

  if (albionGuildId === null) {
    return
  }

  GuildIdentity.setGuildId(albionGuildId)
}

module.exports = { name, handle }
