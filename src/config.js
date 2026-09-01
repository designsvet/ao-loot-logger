const { version } = require('../package.json')

// Photon/Albion event and operation codes (fixed for the game protocol version in use)
const EVENTS = {
  EvInventoryPutItem: 26,
  EvNewCharacter: 29,
  EvNewEquipmentItem: 30,
  EvNewSiegeBannerItem: 31,
  EvNewSimpleItem: 32,
  EvNewLoot: 98,
  EvAttachItemContainer: 99,
  EvDetachItemContainer: 100,
  EvCharacterStats: 143,
  EvOtherGrabbedLoot: 279,
  // Local patch: absent from the fork, so loot chests never registered as containers
  // and every self-pickup from one hit "cant find container". Derived from
  // Triky313/AlbionOnline-StatisticsAnalysis EventCodes.cs enum ordinals, whose
  // values match all ten codes above EXACTLY (verified 2026-08-19).
  // Local patch: chest attribution (see ev-party-loot-items*.js). Codes derived
  // from the reference enum's ordinals, calibrated against the ten codes above
  // which match it exactly at offset 0. They DRIFT between game patches — other
  // repos carry 300/301 and 297/298 — so re-derive rather than trusting a doc.
  EvPartyLootSettingChangedPlayer: 237,
  EvPartyLootItems: 302,
  EvPartyLootItemsRemoved: 303,
  EvPartyLootItemTypesRemoved: 304,
  EvNewLootChest: 393,
  EvUpdateLootChest: 394,
  // Local patch: the daily bonus rotation (FestivitiesUpdate). TWO candidates, because the
  // sources disagree and only live traffic settles it: 518 is the ordinal in the reference
  // enum this table is calibrated against (which matches all twelve codes above exactly),
  // 511 is an older IL2CPP dump of Albion.Common.dll. Both are dispatched to the same
  // handler, which validates the payload's SHAPE and stays silent when it does not match —
  // so the wrong number costs nothing and the right one works on whichever patch we are on.
  // 2026-09-01: the code moved 518 -> 519. Read off the live client with the packet
  // dumper after the daily-bonus board went silent for two days — the payload is
  // UNCHANGED (five parallel arrays, same fields), only the ordinal moved, which is the
  // drift the note at the top of this file warns about. Both previous codes stay wired:
  // the handler validates the payload's shape and stays silent on a mismatch, so an old
  // code that now belongs to something else costs nothing.
  EvFestivitiesUpdate: 519,
  EvFestivitiesUpdateLegacy: 518,
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
