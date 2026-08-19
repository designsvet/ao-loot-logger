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
  EvPartyLootItems: 302,
  EvPartyLootItemsRemoved: 303,
  EvNewLootChest: 393,
  EvUpdateLootChest: 394,
  OpJoin: 2,
  OpInventoryMoveItem: 30
}

class Config {
  constructor() {
    this.events = EVENTS

    this.ROTATE_LOGGER_FILE_KEY = 'd'
    this.RESTART_NETWORK_FILE_KEY = 'r'
    this.TITLE = `AO Loot Logger - v${version}`
  }
}

module.exports = new Config()
