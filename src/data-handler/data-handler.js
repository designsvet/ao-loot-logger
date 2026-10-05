const RequestData = require('./request-data')
const ResponseData = require('./response-data')
const EventData = require('./event-data')
const Logger = require('../utils/logger')
const MemoryStorage = require('../storage/memory-storage')
const ChestWindow = require('../storage/chest-window')
const ParserError = require('./parser-error')
const Config = require('../config')
const DumpWindow = require('../storage/dump-window')
const PacketDump = require('../utils/packet-dump')
const Activity = require('../activity')
const ParseHealth = require('../storage/parse-health')

/**
 * Local patch (2026-09-28): every packet handed to a handler goes through here, so each call and
 * each throw is counted per handler — what the heartbeat's `[health]` line is computed from (see
 * storage/parse-health.js). Any throw counts, not only a ParserError: a field that moves or changes
 * type can surface as either, and in normal play handlers throw nothing else (none in the
 * 2026-09-21 or 2026-09-28 debug logs). Rethrown untouched, so the catch below logs as before.
 */
function run(handler, event) {
  ParseHealth.call(handler.name)

  try {
    return handler.handle(event)
  } catch (error) {
    ParseHealth.failure(handler.name)
    throw error
  }
}

/**
 * Local patch: the member's activity lines (src/activity). Isolated in its own catch — an activity
 * bug may cost an activity line, never a loot line. Events are fed before the loot switch, which
 * returns early; responses after it (in a `finally`), because the OpJoin handler is where a newer
 * item table takes over (Items.onZoneChange) and the zone line reports which table names the zone.
 */
function feedActivity(kind, event) {
  if (!Activity.log.enabled) {
    return
  }

  try {
    if (kind === 'event') {
      Activity.onEvent(event)
    } else {
      Activity.onResponse(event)
    }
  } catch (error) {
    Logger.warn('activity handler failed', error)
  }
}


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

      // Local patch: the guild-screen instrument. Ahead of the switch on purpose —
      // a packet we already handle for another reason is still a packet the guild
      // screen might be reading, and dumping only the `default` branch would hide
      // exactly those. Costs one boolean while the window is shut.
      if (DumpWindow.shouldDump(eventId)) {
        PacketDump.write('event', eventId, event.parameters)
      }

      feedActivity('event', event)

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
          return run(EventData.EvInventoryPutItem, event)

        case Config.events.EvNewCharacter:
          return run(EventData.EvNewCharacter, event)

        case Config.events.EvNewEquipmentItem:
          return run(EventData.EvNewEquipmentItem, event)

        case Config.events.EvNewSiegeBannerItem:
          return run(EventData.EvNewSiegeBannerItem, event)

        case Config.events.EvNewSimpleItem:
          return run(EventData.EvNewSimpleItem, event)

        case Config.events.EvNewLoot:
          return run(EventData.EvNewLoot, event)

        case Config.events.EvAttachItemContainer:
          return run(EventData.EvAttachItemContainer, event)

        case Config.events.EvDetachItemContainer:
          return run(EventData.EvDetachItemContainer, event)

        // Local patch: the daily bonus rotation. Both candidate codes land on one handler
        // that rejects anything not shaped like FestivitiesUpdate (see the handler).
        case Config.events.EvFestivitiesUpdate:
        case Config.events.EvFestivitiesUpdateLegacy:
        case Config.events.EvFestivitiesUpdateLegacy2:
          return run(EventData.EvFestivitiesUpdate, event)

        case Config.events.EvGuildState:
          return run(EventData.EvGuildState, event)

        case Config.events.EvCharacterStats:
          return run(EventData.EvCharacterStats, event)

        case Config.events.EvOtherGrabbedLoot:
          return run(EventData.EvOtherGrabbedLoot, event)

        // Local patch: chest loot. EvOtherGrabbedLoot is corpse/bag scoped and
        // never fires for a chest, so without these two a chest emptied by four
        // people logs nothing but your own pickups.
        case Config.events.EvPartyLootSettingChangedPlayer:
          return run(EventData.EvPartyLootSettingChangedPlayer, event)

        case Config.events.EvPartyLootItems:
          return run(EventData.EvPartyLootItems, event)

        case Config.events.EvPartyLootItemsRemoved:
          return run(EventData.EvPartyLootItemsRemoved, event)

        // What a real chest actually sends: removal by item TYPE, nameless.
        case Config.events.EvPartyLootItemTypesRemoved:
          return run(EventData.EvPartyLootItemTypesRemoved, event)

         case Config.events.EvNewLootChest:
          return run(EventData.EvNewLootChest, event)

        case Config.events.EvUpdateLootChest:
          return run(EventData.EvUpdateLootChest, event)

        // Local patch (Guild Butler, 2026-10-05): player trades — see src/trades/player-trades.js.
        // Through run() like every handler, so a moved field shows in the [health] line.
        case Config.events.EvInvitationPlayerTrade:
          return run(EventData.EvInvitationPlayerTrade, event)

        case Config.events.EvPlayerTradeUpdate:
          return run(EventData.EvPlayerTradeUpdate, event)

        case Config.events.EvPlayerTradeCancel:
          return run(EventData.EvPlayerTradeCancel, event)

        case Config.events.EvPlayerTradeFinished:
          return run(EventData.EvPlayerTradeFinished, event)

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

    // Local patch: requests matter as much as responses here — the request is what
    // NAMES the operation you just triggered, so pressing the log button and seeing
    // one outgoing code is how the response beside it gets identified.
    if (DumpWindow.shouldDump(eventId)) {
      PacketDump.write('request', eventId, event?.parameters ?? {})
    }

    try {
      switch (eventId) {
        case Config.events.OpInventoryMoveItem:
          return run(RequestData.OpInventoryMoveItem, event)

        // Both carry the guild id; only this side of the exchange does.
        case Config.events.OpGuildLogPage:
        case Config.events.OpGuildLogPageLarge:
          return run(RequestData.OpGuildLogRequest, event)

        // Local patch (Guild Butler, 2026-10-05): our accept names the revision agreed — see
        // src/trades/player-trades.js.
        case Config.events.OpPlayerTradeAcceptTrade:
          return run(RequestData.OpPlayerTradeAcceptTrade, event)

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

    // Local patch: the likeliest carrier. The screen's numbers answer a request the
    // client just made, and unhandled responses have only ever gone to `silly` —
    // console-only, so nothing about them survived the session.
    if (DumpWindow.shouldDump(eventId)) {
      PacketDump.write('response', eventId, event?.parameters ?? {}, {
        returnCode: event?.returnCode,
        debugMessage: event?.debugMessage
      })
    }

    try {
      switch (eventId) {
        case Config.events.OpJoin:
          return run(ResponseData.OpJoin, event)

        case Config.events.OpGuildEnergyDrain:
          return run(ResponseData.OpGuildEnergyDrain, event)

        case Config.events.OpGuildLogPage:
          return run(ResponseData.OpGuildLogPage, event)

        // Local patch (Guild Butler, 2026-10-05): the answer to our trade invitation, which is where
        // the partner's name is when WE asked — see src/trades/player-trades.js.
        case Config.events.OpInviteToPlayerTrade:
          return run(ResponseData.OpInviteToPlayerTrade, event)

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
    } finally {
      feedActivity('response', event)
    }
  }
}

module.exports = DataHandler
