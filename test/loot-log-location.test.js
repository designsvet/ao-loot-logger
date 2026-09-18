const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

/**
 * Where the loot log goes (src/loot-logger.js, logDir).
 *
 * Guild Butler Capture runs the engine it bundles from inside the installed app, with its working
 * folder set to the app's per-user captures folder. The log went beside the ENGINE instead — into
 * the app itself. Measured 2026-09-18 on the owner's Mac: three loot logs in
 * Guild Butler Capture.app/Contents/Resources/engine, which `codesign --verify` named as the only
 * files breaking the bundle's seal, and none in the captures folder the app watches.
 */

const ENGINE_ROOT = path.join(__dirname, '..')
const LOOT_LOGGER = path.join(ENGINE_ROOT, 'src', 'loot-logger.js')

const tmpDir = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loot-log-'))

  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))

  return dir
}

/** A real engine process, started the way it is started, that logs one pickup or only names its file. */
const logFileOf = ({ cwd, capture, write = false }) => {
  const env = { ...process.env }

  delete env.ELECTRON_RUN_AS_NODE

  if (capture) {
    env.ELECTRON_RUN_AS_NODE = '1'
  }

  const script = `
    const LootLogger = require(${JSON.stringify(LOOT_LOGGER)})
    if (${write}) {
      LootLogger.write({
        date: new Date('2026-09-18T15:53:41Z'),
        itemId: 'T4_BAG',
        itemName: "Adept's Bag",
        quantity: 1,
        lootedBy: { playerName: 'Bors', guildName: 'VITRYLA' },
        lootedFrom: { playerName: '@MOB_TEST' }
      })
      LootLogger.close()
    }
    console.log(JSON.stringify(LootLogger.logFileName))
  `

  const out = execFileSync(process.execPath, ['-e', script], { cwd, env, encoding: 'utf8' })
  const last = out.trim().split('\n').at(-1)

  return JSON.parse(last)
}

test('run by the capture app, the log goes to the folder the app gave it — never into the app', (t) => {
  const captures = tmpDir(t)
  const before = fs.readdirSync(ENGINE_ROOT).filter((f) => f.startsWith('loot-events-'))

  const file = logFileOf({ cwd: captures, capture: true, write: true })

  assert.equal(path.dirname(file), fs.realpathSync(captures))
  assert.match(fs.readFileSync(file, 'utf8'), /^timestamp_utc;.*\n.*;Bors;T4_BAG;Adept's Bag;1;;;@MOB_TEST;/)

  const after = fs.readdirSync(ENGINE_ROOT).filter((f) => f.startsWith('loot-events-'))

  assert.deepEqual(after, before, 'nothing written beside the engine — in a packaged build, inside the app')
})

test('run by hand, the log still goes beside the engine, wherever it was started from', (t) => {
  const elsewhere = tmpDir(t)

  const file = logFileOf({ cwd: elsewhere, capture: false })

  assert.equal(path.dirname(file), ENGINE_ROOT)
})

test('the rule on its own', () => {
  const { logDir } = require('../src/loot-logger')

  assert.equal(logDir({ ELECTRON_RUN_AS_NODE: '1' }, '/data/captures'), '/data/captures')
  assert.equal(logDir({}, '/data/captures'), ENGINE_ROOT)
  // Only the app's own value counts: anything else is a hand run.
  assert.equal(logDir({ ELECTRON_RUN_AS_NODE: '0' }, '/data/captures'), ENGINE_ROOT)
})
