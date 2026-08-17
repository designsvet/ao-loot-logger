process.on('uncaughtException', async (error) => {
  console.error(error)

  await new Promise((resolve) => setTimeout(resolve, 25000))
})

process.on('unhandledRejection', async (reason) => {
  console.error(reason)

  await new Promise((resolve) => setTimeout(resolve, 25000))
})

const LootLogger = require('./loot-logger')

const { green, red, cyan, orange } = require('./utils/colors')
const AlbionNetwork = require('./network/albion-network')
const checkNewVersion = require('./check-new-version')
const DataHandler = require('./data-handler/data-handler')
const Items = require('./items')
const KeyboardInput = require('./keyboard-input')

const Config = require('./config')

main()

async function main() {
  setWindowTitle(Config.TITLE)

  console.info(`${Config.TITLE}
`)

  await Promise.all([checkNewVersion(), Items.init()])

  AlbionNetwork.on('add-listener', (device) => {
    console.info(`Listening to ${device.name}`)
  })

  AlbionNetwork.on('event-data', DataHandler.handleEventData)
  AlbionNetwork.on('request-data', DataHandler.handleRequestData)
  AlbionNetwork.on('response-data', DataHandler.handleResponseData)

  // Server region detection event
  AlbionNetwork.on('server-detected', (server) => {
    console.info(`\n\t${cyan('CURRENT SERVER')}: ${server.name} (${server.region})\n`)
    setWindowTitle(`[${server.name}] ${Config.TITLE}`)
  })

  AlbionNetwork.on('online', () => {
    console.info(`\n\t${green('ALBION DETECTED')}. Loot events should be logged.`)
    // Don't set title here, wait for server detection
  })

  AlbionNetwork.on('offline', () => {
    console.info(
      `\n\t${red(
        'ALBION NOT DETECTED'
      )}. \n\n\tIf Albion is running, press "${Config.RESTART_NETWORK_FILE_KEY}" to restart the network listeners or restart AO Loot Logger.\n`
    )

    setWindowTitle(`[OFF] ${Config.TITLE}`)
  })

  AlbionNetwork.init()


  KeyboardInput.on('key-pressed', (key) => {
    const CTRL_C = '\u0003'

    switch (key) {
      case CTRL_C:
        return exit()

      case Config.RESTART_NETWORK_FILE_KEY.toLocaleLowerCase():
      case Config.RESTART_NETWORK_FILE_KEY.toUpperCase():
        return restartNetwork()

      case Config.ROTATE_LOGGER_FILE_KEY.toLocaleLowerCase():
      case Config.ROTATE_LOGGER_FILE_KEY.toUpperCase():
        return rotateLogFile()
    }
  })

  KeyboardInput.init()

  startHeartbeat()

  console.info([
    '',
    `Logs will be written to ${LootLogger.logFileName}`,
    '',
    `You can always press "${Config.ROTATE_LOGGER_FILE_KEY}" to start a new log file.`,
    '',
    `Join the Discord server: ${cyan('https://discord.gg/fvNMF2abXr')} (Ctrl + click to open).`,
    '',
    `${orange('AO Loot Logger Viewer can be found here:')} ${cyan('https://loot-logger.ddns.net/ao-loot-logger-viewer')} (Ctrl + click to open).`
  ].join('\n'))
}

// Local patch: one line a minute, so "is this thing on?" is answerable without
// alt-tabbing into the game and hoping.
function startHeartbeat() {
  const MemoryStorage = require('./storage/memory-storage')
  const PendingSelfLoots = require('./pending-self-loots')

  setInterval(() => {
    const self = MemoryStorage.players.self
    const parts = [
      self ? `character: ${self.playerName}` : 'character: not identified yet (change zone once)',
      `lines written: ${LootLogger.linesWritten}`
    ]

    if (PendingSelfLoots.size() > 0) {
      parts.push(`held: ${PendingSelfLoots.size()}`)
    }

    console.info(`[status] ${parts.join(' · ')}`)
  }, 60000).unref()
}

function restartNetwork() {
  console.info(`\n\tRestarting network listeners...\n`)

  AlbionNetwork.close()
  AlbionNetwork.init()

  setWindowTitle(Config.TITLE)
}

function setWindowTitle(title) {
  process.stdout.write(
    String.fromCharCode(27) + ']0;' + title + String.fromCharCode(7)
  )
}

function exit() {
  console.info('Exiting...')

  process.exit(0)
}

function rotateLogFile() {
  LootLogger.close()
  LootLogger.createNewLogFileName()

  console.info(
    `\nFrom now on, logs will be written to ${LootLogger.logFileName}. The file is only created when the first loot event is detected.\n`
  )
}
