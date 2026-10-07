const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

/**
 * The loot-rules level (src/loot-rules.js): the integer the capture app stamps beside the bundled
 * engine and the bot gates trade counting on. It replaced a hand-kept list of engine commits in
 * raid-bot, so what keeps it honest is here: the value, the rule written above it, a README row per
 * level, and the replays each level stands on.
 */

const ENGINE_ROOT = path.join(__dirname, '..')
const FILE = path.join(ENGINE_ROOT, 'src', 'loot-rules.js')
const README = path.join(ENGINE_ROOT, 'README-mac.md')
const source = fs.readFileSync(FILE, 'utf8')
const { LOOT_RULES } = require('../src/loot-rules')

// What each level stands on: the replays that pin its fixes. Deleting one while the level holds would
// leave the bot trusting a fix nothing checks any more. Bumping the level means adding its entry.
const PINNED_BY = {
  1: ['bank-deposit.test.js', 'split-and-trade.test.js', 'zone-change-chest-owner.test.js']
}

test('the level is 1', () => {
  assert.strictEqual(LOOT_RULES, 1)
})

test('the module exports the level and nothing else, as a non-negative integer', () => {
  assert.deepStrictEqual(Object.keys(require('../src/loot-rules')), ['LOOT_RULES'])
  assert.ok(Number.isSafeInteger(LOOT_RULES) && LOOT_RULES >= 0)
})

test('the rule is written above the value', () => {
  const header = source.slice(0, source.indexOf('module.exports'))

  for (const words of [
    'bumped by one by every engine change that alters WHICH pickups are written',
    'a loot-correctness fix',
    'never by anything else',
    'It never goes down',
    '1 = the first level whose pickups',
    'ITSELF declares no level',
    '#19',
    '#21'
  ]) {
    assert.ok(header.replace(/\s*\n\s*\*\s*/g, ' ').includes(words), `the header says: ${words}`)
  }
})

test('the file stays a bare value a build script can load', () => {
  assert.doesNotMatch(source, /\brequire\s*\(/, 'no require')
  assert.match(source, /^module\.exports = \{ LOOT_RULES: \d+ \}\n$/m)
})

test('loaded the way the capture app build loads it, from another folder, it reads the same level', () => {
  // tools/prepare-engine-dist.mjs in the capture app: an ES module that requires this file out of
  // the engine checkout. Run from a temp folder so nothing here resolves by accident.
  const out = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "import { createRequire } from 'node:module'; const r = createRequire(import.meta.url); process.stdout.write(String(r(process.argv[1]).LOOT_RULES))",
      FILE
    ],
    { cwd: os.tmpdir(), encoding: 'utf8' }
  )

  assert.strictEqual(out, String(LOOT_RULES))
})

test('every level up to the current one has a README row and replays that pin it', () => {
  const whole = fs.readFileSync(README, 'utf8')
  const start = whole.indexOf('\n## The loot-rules level')

  assert.ok(start >= 0, 'README-mac.md has a "The loot-rules level" section')

  const next = whole.indexOf('\n## ', start + 1)
  const readme = whole.slice(start, next < 0 ? undefined : next)

  for (let level = 1; level <= LOOT_RULES; level++) {
    assert.match(readme, new RegExp(`^\\| ${level} \\|`, 'm'), `README-mac.md has a row for level ${level}`)
    assert.ok(PINNED_BY[level], `level ${level} names the tests it stands on`)

    for (const file of PINNED_BY[level]) {
      assert.ok(fs.existsSync(path.join(__dirname, file)), `level ${level} stands on test/${file}`)
    }
  }

  assert.doesNotMatch(readme, new RegExp(`^\\| ${LOOT_RULES + 1} \\|`, 'm'), 'no README row past the current level')
})
