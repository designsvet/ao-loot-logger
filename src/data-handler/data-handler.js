const RequestData = require('./request-data')
const ResponseData = require('./response-data')
const EventData = require('./event-data')
const Logger = require('../utils/logger')
const MemoryStorage = require('../storage/memory-storage')
const ChestWindow = require('../storage/chest-window')
const ParserError = require('./parser-error')
const Config = require('../config')


/**
 * Local patch: does this unhandled event mention a known player? If so it is a
 * candidate attribution channel and worth seeing in full.
 */
function namesInPayload(event) {
  const known = MemoryStorage.players.players

  for (const [key, value] of Object.entries(event.parameters)) {
    if (typeof value !== 'string' || value.length < 3 || known[value] == null) {
      continue
    }

    return Logger.debug('UNPROCESSED_EVENT NAMES A PLAYER', {
      code: event.parameters[252],
      matchedAtParam: key,
      playerName: value,
      payload: Object.fromEntries(
        Object.entries(event.parameters)
          .slice(0, 14)
          .map(([k, v]) => [k, Array.isArray(v) ? `array(${v.length}): ${v.slice(0, 5).join(',')}` : v])
      )
    })
  }
}

class DataHandler {
  static handleEventData(event) {
    try {
      // DEBUG: Log all incoming events for troubleshooting
      // Remove or comment out after confirming everything works

      const eventId = event?.parameters?.[252]

      // Protocol 18 fix: eventCode in header may not always be 1
      // We filter by checking if parameters[252] exists (event ID parameter)
      // This is more robust than checking eventCode === 1
      if (!event || !eventId) {
        return
      }

      switch (eventId) {
        // Local patch: re-enabled. The fork left self-loot off ("not supported yet"
        // in the Protocol 18 issue), which is why a player's OWN pickups never
        // logged. Code 26 and the handler's params (0 ObjectId, 1 slot, 2 guid)
        // both match the reference implementation.
        case Config.events.EvInventoryPutItem:
          return EventData.EvInventoryPutItem.handle(event)

        case Config.events.EvNewCharacter:
          return EventData.EvNewCharacter.handle(event)

        case Config.events.EvNewEquipmentItem:
          return EventData.EvNewEquipmentItem.handle(event)

        case Config.events.EvNewSiegeBannerItem:
          return EventData.EvNewSiegeBannerItem.handle(event)

        case Config.events.EvNewSimpleItem:
          return EventData.EvNewSimpleItem.handle(event)

        case Config.events.EvNewLoot:
          return EventData.EvNewLoot.handle(event)

        case Config.events.EvAttachItemContainer:
          return EventData.EvAttachItemContainer.handle(event)

        case Config.events.EvDetachItemContainer:
          return EventData.EvDetachItemContainer.handle(event)

        // Local patch: the daily bonus rotation. Both candidate codes land on one handler
        // that rejects anything not shaped like FestivitiesUpdate (see the handler).
        case Config.events.EvFestivitiesUpdate:
        case Config.events.EvFestivitiesUpdateLegacy:
          return EventData.EvFestivitiesUpdate.handle(event)

        case Config.events.EvGuildState:
          return EventData.EvGuildState.handle(event)

        case Config.events.EvCharacterStats:
          return EventData.EvCharacterStats.handle(event)

        case Config.events.EvOtherGrabbedLoot:
          return EventData.EvOtherGrabbedLoot.handle(event)

        // Local patch: chest loot. EvOtherGrabbedLoot is corpse/bag scoped and
        // never fires for a chest, so without these two a chest emptied by four
        // people logs nothing but your own pickups.
        case Config.events.EvPartyLootSettingChangedPlayer:
          return EventData.EvPartyLootSettingChangedPlayer.handle(event)

        case Config.events.EvPartyLootItems:
          return EventData.EvPartyLootItems.handle(event)

        case Config.events.EvPartyLootItemsRemoved:
          return EventData.EvPartyLootItemsRemoved.handle(event)

        // What a real chest actually sends: removal by item TYPE, nameless.
        case Config.events.EvPartyLootItemTypesRemoved:
          return EventData.EvPartyLootItemTypesRemoved.handle(event)

         case Config.events.EvNewLootChest:
          return EventData.EvNewLootChest.handle(event)

        case Config.events.EvUpdateLootChest:
          return EventData.EvUpdateLootChest.handle(event)

        default:
          // Local patch: `silly` goes to the console only, so unknown events were
          // invisible to any after-the-fact analysis — which is exactly what you
          // need when asking "did the server tell us who looted that chest?".
          // At debug level this lands in debug-logs.txt, compact enough to grep.
          if (process.env.LOG_UNPROCESSED) {
            Logger.debug(`UNPROCESSED_EVENT code=${eventId} params=${Object.keys(event.parameters).join(',')}`)
          }

          // Local patch: the standing question is whether ANY event we do not
          // handle carries another player's name — i.e. a hidden attribution
          // channel for chest loot. Keys alone cannot answer that, and dumping
          // every value would bury the log (5863 unknown events in 3.5 minutes).
          // So dump only events whose payload mentions a player we already know
          // about: that is precisely the shape of the thing being hunted, and it
          // costs nothing during ordinary play. No special test run needed.
          namesInPayload(event)

          // Local patch (ADR 0102): is this unhandled event the daily bonus rotation under a
          // different number? Its shape is unmistakable, so one login answers the question the
          // two wired candidates cannot.
          EventData.EvFestivitiesUpdate.scan(event, 'event')

          // While a chest is in play, dump unhandled events IN FULL. This is the
          // only shape of evidence that can answer "does anything name an
          // out-of-party looter" — key-only logs and a known-player matcher both
          // structurally cannot.
          if (ChestWindow.shouldDump()) {
            Logger.debug('CHEST_WINDOW_EVENT', {
              code: eventId,
              // EVERY parameter, not the first 16: the one time a dump carried a
              // guild and alliance, the cap hid whatever followed — and a player
              // NAME following a guild is exactly the thing being hunted.
              payload: Object.fromEntries(
                Object.entries(event.parameters).map(([k, v]) => [
                  k,
                  Array.isArray(v) ? `array(${v.length}): ${v.slice(0, 8).join(',')}` : v
                ])
              )
            })
          }
      }
    } catch (error) {
      if (error instanceof ParserError) {
        Logger.warn(error, event)
      } else {
        Logger.error(error, event)
      }
    }
  }

  static handleRequestData(event) {
    const eventId = event?.parameters?.[253]

    try {
      switch (eventId) {
        case Config.events.OpInventoryMoveItem:
          return RequestData.OpInventoryMoveItem.handle(event)

        default:
          EventData.EvFestivitiesUpdate.scan(event, 'request')
          if (process.env.LOG_UNPROCESSED) Logger.silly('handleRequestData', event.parameters)
      }
    } catch (error) {
      if (error instanceof ParserError) {
        Logger.warn(error, event)
      } else {
        Logger.error(error, event)
      }
    }
  }

  static handleResponseData(event) {
    const eventId = event?.parameters?.[253]

    try {
      switch (eventId) {
        case Config.events.OpJoin:
          return ResponseData.OpJoin.handle(event)

        case Config.events.OpGuildEnergyDrain:
          return ResponseData.OpGuildEnergyDrain.handle(event)

        default:
          EventData.EvFestivitiesUpdate.scan(event, 'response')
          if (process.env.LOG_UNPROCESSED) Logger.silly('handleResponseData', event.parameters)
      }
    } catch (error) {
      if (error instanceof ParserError) {
        Logger.warn(error, event)
      } else {
        Logger.error(error, event)
      }
    }
  }
}

module.exports = DataHandler
