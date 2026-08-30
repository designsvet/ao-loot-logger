const test = require('node:test')
const assert = require('node:assert')

const { fresh, useFakeClock } = require('./helpers')

// The dump window and the attribution window used to be one clock. That is how a
// hideout deposit became chest loot, so these pin them apart.

test('plain container activity never names a chest', (t) => {
  const { ChestWindow } = fresh()
  useFakeClock(t)

  ChestWindow.touch()

  assert.equal(ChestWindow.recentChestName(), null)
})

test('a chest that names itself is attributable for the window, then is not', (t) => {
  const { ChestWindow } = fresh()
  const clock = useFakeClock(t)

  ChestWindow.named('@CHEST_TREASURE_SOLO_UNCOMMON')
  assert.equal(ChestWindow.recentChestName(), '@CHEST_TREASURE_SOLO_UNCOMMON')

  clock.advance(ChestWindow.WINDOW_MS)
  assert.equal(ChestWindow.recentChestName(), '@CHEST_TREASURE_SOLO_UNCOMMON')

  clock.advance(1)
  assert.equal(ChestWindow.recentChestName(), null)
})

test('opening containers does not keep a chest name alive', (t) => {
  const { ChestWindow } = fresh()
  const clock = useFakeClock(t)

  ChestWindow.named('@CHEST_TREASURE_SOLO_UNCOMMON')

  // Your bank, a mount bag, the hideout chest: an attach every ten seconds for
  // an hour. Under the old single clock every one of these pushed the window
  // forward and the name never went stale.
  for (let i = 0; i < 360; i++) {
    clock.advance(10_000)
    ChestWindow.touch()
  }

  assert.equal(ChestWindow.recentChestName(), null)
})

test('a nameless chest event does not re-arm a stale name', (t) => {
  const { ChestWindow } = fresh()
  const clock = useFakeClock(t)

  ChestWindow.named('@CHEST_TREASURE_SOLO_UNCOMMON')
  clock.advance(ChestWindow.WINDOW_MS + 1)

  ChestWindow.named(undefined)

  assert.equal(ChestWindow.recentChestName(), null)
})

test('the debugging instrument still opens on plain activity', (t) => {
  const { ChestWindow } = fresh()
  const clock = useFakeClock(t)

  assert.equal(ChestWindow.shouldDump(), false, 'nothing happening, nothing to dump')

  ChestWindow.touch()
  assert.equal(ChestWindow.shouldDump(), true)

  clock.advance(ChestWindow.WINDOW_MS + 1)
  assert.equal(ChestWindow.shouldDump(), false)
})
