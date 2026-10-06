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
  // Local patch (Guild Butler, 2026-10-05): player-to-player trades (src/trades/player-trades.js).
  // The ordinals of Triky313/AlbionOnline-StatisticsAnalysis 3c90f93 (EventCodes.cs:182-187,
  // OperationCodes.cs:166-172), at offset 0 like every code above, and matched payload for payload
  // against the owner's recordings of 2026-09-16 and 2026-09-21 (eight trades). Only 176 has been
  // seen again since the ~09-28 game patch (live debug logs, 2026-10-04/05); the rest are believed,
  // not re-read. The handlers validate shape and throw on a mismatch, so a renumbering shows in the
  // [health] line: a drift of one either way hands the update handler a cancel's or a finish's bare
  // {0} (no revision, broken), and the finish handler an update (refused for carrying one).
  //   - The INVITER gets only the response to 161 (partner name at 1, guild at 2, trade id at 6);
  //     the INVITEE gets only event 176, in the same layout. Reading events alone loses the
  //     partner on 7 of the 8 recorded trades.
  //   - 181 (AcceptChange) is listed for the code table only: it carries nothing the record
  //     needs, so nothing handles it.
  EvInvitationPlayerTrade: 176,
  EvPlayerTradeCancel: 178,
  EvPlayerTradeUpdate: 179,
  EvPlayerTradeFinished: 180,
  EvPlayerTradeAcceptChange: 181,
  OpInviteToPlayerTrade: 161, // its RESPONSE is handled
  OpPlayerTradeAcceptTrade: 166, // its REQUEST is handled (the revision we accepted)
  OpJoin: 2,
  OpInventoryMoveItem: 30,
  // Local patch (2026-10-05): a split is not loot (see ev-inventory-put-item.js). The SAT ordinal,
  // at offset 0 like the anchors above; its shape was read off all 11 splits in the 2026-09-16 and
  // 2026-09-21 recordings, before the ~09-28 patch, and has not been re-read since.
  OpInventorySplitStack: 33
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
