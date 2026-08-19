const Logger = require('../../utils/logger')

const name = 'EvPartyLootSettingChangedPlayer'

/**
 * Local patch: diagnostics only, no writes.
 *
 * Chest attribution turned out to depend on the party's LOOT SETTING, not just
 * on taking part: with distribution on, a chest broadcasts PartyLootItems with a
 * player name per item (75 items / 75 names observed); with it off, the same
 * event arrives with every array empty. That is a game setting nobody can see
 * from a log after the fact, so record it when it changes — otherwise the next
 * person re-derives it from empty payloads, as we just did.
 */
function handle(event) {
  Logger.debug('EvPartyLootSettingChangedPlayer', {
    params: Object.fromEntries(
      Object.entries(event.parameters)
        .slice(0, 8)
        .map(([k, v]) => [k, Array.isArray(v) ? `array(${v.length})` : v])
    )
  })
}

module.exports = { name, handle }
