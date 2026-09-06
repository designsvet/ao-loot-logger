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
 * Measured on a real capture (2026-08-28, one Europe session of 17 minutes): 5,405 parsed item
 * reveals — 3,785 `EvNewEquipmentItem`, 1,616 `EvNewSimpleItem`, 4 `EvNewSiegeBannerItem`.
 * Parameter 4 is present on 3,785/3,785 equipment reveals and absent on 147 simple ones, which
 * are SEVEN ITEM IDS OBSERVED IN THAT CAPTURE at 21 reveals each: `T4/T5/T7/T8_SKILLBOOK_-`
 * `NONTRADABLE`, `T6/T8_TRASH`, `QUESTITEM_TOKEN_SMUGGLER` — names as resolved by the BUNDLED
 * `items-fallback.js`, which is the table that capture used; `items.js` fetches live
 * ao-bin-dumps at startup and the two number the same items differently. The set is open, not
 * closed: `T6_SKILLBOOK_NONTRADABLE` and `T7_TRASH` are obvious siblings that simply never
 * appeared. And the implication runs one way only — `T4_SILVERBAG_NONTRADABLE` says
 * NONTRADABLE in the game's own id and DOES carry a parameter 4 (exactly 10,000 silver), so
 * absence means "the client sent no value", not "the item cannot be traded".
 *
 * The value `0` never appears: the smallest parameter 4 in 5,254 readings is 108,937, and the
 * smallest parameter 5 in 2,945 is 29,827,959. Absent and zero must therefore stay
 * distinguishable downstream — `null` here, never 0, since "no market" and "worth nothing" are
 * different claims about an item.
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
