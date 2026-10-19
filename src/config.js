const { version } = require('../package.json')

// October 2026: DebugAggroInfo was removed after NewMob (123).
// Event ordinals below are explicit, checked against the primary enum and
// October 15 traffic for profiles (142), pickups (278) and Might/Favor (496).
// Operation codes did not move. See docs/2026-10-protocol-hotfix.md.
const EVENTS = {
  EvInventoryPutItem: 26,
  EvNewCharacter: 29,
  EvNewEquipmentItem: 30,
  EvNewSiegeBannerItem: 31,
  EvNewSimpleItem: 32,
  EvNewLoot: 98,
  EvAttachItemContainer: 99,
  EvDetachItemContainer: 100,
  // 143 is kill history now; its arrays must never enter the profile parser.
  EvCharacterStats: 142,
  EvOtherGrabbedLoot: 278,
  // Local patch: absent from the fork, so loot chests never registered as containers
  // and every self-pickup from one hit "cant find container". Derived from
  // Triky313/AlbionOnline-StatisticsAnalysis EventCodes.cs enum ordinals, whose
  // values match all ten codes above EXACTLY (verified 2026-08-19).
  // Local patch: chest attribution (see ev-party-loot-items*.js). Codes derived
  // from the reference enum's ordinals, calibrated against the ten codes above
  // which match it exactly at offset 0. They DRIFT between game patches — other
  // repos carry 300/301 and 297/298 — so re-derive rather than trusting a doc.
  EvPartyLootSettingChangedPlayer: 236,
  EvPartyLootItems: 301,
  EvPartyLootItemsRemoved: 302,
  EvPartyLootItemTypesRemoved: 303,
  EvNewLootChest: 392,
  EvUpdateLootChest: 393,
  // Festivities is 518 again. Preserve the existing shape-validated candidates:
  // unlike other handlers, this handler ignores a non-matching parallel-array shape.
  EvFestivitiesUpdate: 518,
  EvFestivitiesUpdateLegacy: 519,
  EvFestivitiesUpdateLegacy2: 511,
  // Local patch: the guild's siphoned-energy total and the guild screen's drain
  // block. Both codes were READ off the live client on 2026-09-01 (see the
  // guild-energy-dump investigation), not derived from the reference enum — its
  // ordinals for these did not line up, which is the same drift the note above
  // warns about. Both handlers validate the payload's SHAPE and stay silent when it
  // does not match, so a patch that renumbers them degrades to no data rather than
  // to wrong data.
  EvGuildState: 103,
  OpGuildEnergyDrain: 414,
  // The guild log, fetched a page at a time as you scroll it. Request param 2 is the
  // offset; the sibling 'large' operation (415 here) was requested twice in two
  // recordings and answered NEITHER time, so paging this one is the only path.
  OpGuildLogPage: 159,
  OpGuildLogPageLarge: 160,
  OpJoin: 2,
  OpInventoryMoveItem: 30
}

class Config {
  constructor() {
    this.events = EVENTS

    this.ROTATE_LOGGER_FILE_KEY = 'd'
    this.RESTART_NETWORK_FILE_KEY = 'r'
    // Local patch: arm the guild-screen packet dump (src/storage/dump-window.js).
    this.DUMP_PACKETS_KEY = 'g'
    this.TITLE = `AO Loot Logger - v${version}`
  }
}

module.exports = new Config()
