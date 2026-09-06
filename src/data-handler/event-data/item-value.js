const ServerRegion = require('../../network/server-region')

/**
 * ADR 0110 Spike A — the game's own estimated market value, printed and nothing else.
 *
 * The two item-reveal events carry a value the client uses for its own tooltip. Parameter 4 is
 * the estimated MARKET value; parameter 5, on equipment only, is the estimated BLACK MARKET
 * value. Our fork walked straight past both — `ev-new-equipment-item.js` labelled parameter 5
 * "numeric value (optional, purpose unknown)" — while the Statistics Analysis Tool has read
 * them by name for years (`Network/Events/NewEquipmentItemEvent.cs`,
 * `NewSimpleItemEvent.cs`, storing them on `DiscoveredItem.EstimatedMarketValueInternal`).
 *
 * **Raw values travel raw.** SAT's `Common/FixPoint.cs` has `InternalFactor = 10000L` and
 * `DoubleValue => InternalValue / InternalFactor`, so the wire number is silver × 10,000 —
 * but the conversion is deliberately NOT done here. A wrong constant baked into an installed
 * engine is fixed only by a release every member has to take; the same constant on the server
 * is fixed by a deploy. So this prints the integer the game sent and lets the reader own the
 * interpretation, exactly as the festivities handler passes .NET ticks through unconverted.
 *
 * This module PRINTS. It writes no loot, touches no storage and decides nothing — the spike's
 * whole method is "add the two parameter reads, print only".
 */

/** Region → the token the bot stores. Null when the region has not been detected yet. */
function serverToken() {
  const server = ServerRegion.getCurrentServer()

  return server && typeof server.region === 'string' ? server.region.toLowerCase() : null
}

/**
 * An item with no market value omits the parameter ENTIRELY — it does not send 0.
 *
 * Measured on a real capture (2026-08-28, 5,405 reveals): parameter 4 is absent on exactly
 * seven ids, every one of them genuinely untradeable — `T4/T5/T7/T8_SKILLBOOK_NONTRADABLE`,
 * `T6/T8_TRASH`, `QUESTITEM_TOKEN_SMUGGLER` — and present on all 3,785 equipment reveals.
 * Absent and zero must therefore stay distinguishable downstream: `null` here, never 0, since
 * "no market" and "worth nothing" are different claims about an item.
 */
function readValue(parameters, index) {
  const value = parameters[index]

  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * One line per reveal. Same contract as `[festivities]`: a tag, then one JSON object.
 *
 * Nothing personal is in it by construction — an item id, a quality, a region and two numbers
 * the SERVER computed. That is the ADR 0110 §5 admission test in its clearest form: server
 * truth with no personal dimension.
 */
function printItemValue({ itemId, quality, parameters }) {
  const marketValue = readValue(parameters, 4)
  const blackMarketValue = readValue(parameters, 5)

  // Nothing to say about an item the game itself prices at nothing.
  if (marketValue === null && blackMarketValue === null) {
    return
  }

  console.info(
    `[value] ${JSON.stringify({
      server: serverToken(),
      itemId,
      quality,
      marketValue,
      blackMarketValue,
      at: new Date().toISOString()
    })}`
  )
}

module.exports = { printItemValue, readValue }
