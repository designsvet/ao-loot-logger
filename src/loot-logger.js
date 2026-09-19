const fs = require('fs')
const path = require('path')

const { red, green } = require('./utils/colors')
const formatPlayerName = require('./utils/format-player-name')
const ServerRegion = require('./network/server-region')

/**
 * Local patch (2026-09-18) — the folder the loot log goes to.
 *
 * Run by hand (`sudo node src/index.js`): beside this engine, the clone folder the README points
 * at. The fork's '..','..' targets its packaged binary; from source it put logs one directory
 * ABOVE the clone, where nobody looks for them.
 *
 * Run by Guild Butler Capture, which starts the engine on Electron's own Node
 * (ELECTRON_RUN_AS_NODE=1) in the folder captures belong in: its per-user captures folder for the
 * engine it bundles, the engine folder for a development layout. Beside the engine is the wrong
 * answer there. Measured 2026-09-18 on the owner's Mac (app 0.8.2): three loot logs inside
 * Guild Butler Capture.app/Contents/Resources/engine, `codesign --verify` naming exactly those three
 * as "file added" to the sealed bundle, and none in the captures folder the app watches. On Windows
 * that folder is the install dir, which an update replaces; for a Mac user without admin rights it
 * is not writable at all. debug-logs.txt and the packet dumps already follow the working folder.
 */
const logDir = (env = process.env, cwd = process.cwd()) => {
  return env.ELECTRON_RUN_AS_NODE === '1' ? cwd : path.join(__dirname, '..')
}

class LootLogger {
  constructor() {
    this.stream = null
    this.logFileName = null
    this.linesWritten = 0 // local patch: what the heartbeat reports

    this.createNewLogFileName()

    // Register the exit handler only once, not on every log file rotation
    process.on('exit', () => {
      this.close()
    })
  }

  init() {
    if (this.stream != null) {
      this.stream.close()
    }

    this.stream = fs.createWriteStream(this.logFileName, { flags: 'a' })

    const header = [
      'timestamp_utc',
      'looted_by__alliance',
      'looted_by__guild',
      'looted_by__name',
      'item_id',
      'item_name',
      'quantity',
      'looted_from__alliance',
      'looted_from__guild',
      'looted_from__name',
      'server__region'
    ].join(';')

    this.stream.write(header + '\n')
  }

  createNewLogFileName() {
    const d = new Date()

    const datetime = [
      d.getFullYear(),
      d.getMonth() + 1,
      d.getDate(),
      d.getHours(),
      d.getMinutes(),
      d.getSeconds()
    ]
      .map((n) => n.toString().padStart(2, '0'))
      .join('-')

    this.logFileName = path.join(logDir(), `loot-events-${datetime}.txt`)
  }

  write({ date, itemId, quantity, itemName, lootedBy, lootedFrom }) {
    if (this.stream == null) {
      this.init()
    }

    this.linesWritten += 1

    // Deliberately the SETTLED server, not ServerRegion.getPacketServer(): a held pickup is
    // written on a later packet (pending-self-loots flushes on the next zone join), and this only
    // fills the file's display column, mid-session — nowhere near the login burst that made the
    // lines the bot stores (festivities, energy) read the packet instead.
    const server = ServerRegion.getCurrentServer()
    const serverName = server ? server.name : ''

    const line = [
      date.toISOString(),
      lootedBy.allianceName ?? '',
      lootedBy.guildName ?? '',
      lootedBy.playerName,
      itemId,
      itemName,
      quantity,
      lootedFrom.allianceName ?? '',
      lootedFrom.guildName ?? '',
      lootedFrom.playerName,
      serverName
    ].join(';')

    this.stream.write(line + '\n')

    console.info(
      this.formatLootLog({
        date,
        lootedBy,
        lootedFrom,
        quantity,
        itemName
      })
    )
  }

  formatLootLog({ date, lootedBy, itemName, lootedFrom, quantity }) {
    const hours = date.getUTCHours().toString().padStart(2, '0')
    const minute = date.getUTCMinutes().toString().padStart(2, '0')
    const seconds = date.getUTCSeconds().toString().padStart(2, '0')

    return `${hours}:${minute}:${seconds} UTC: ${formatPlayerName(
      lootedBy,
      green
    )} looted ${quantity}x ${itemName} from ${formatPlayerName(
      lootedFrom,
      red
    )}.`
  }

  close() {
    if (this.stream != null) {
      this.stream.close()
    }

    this.stream = null
  }
}

module.exports = new LootLogger()
module.exports.logDir = logDir
