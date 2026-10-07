/**
 * Local patch (Guild Butler, 2026-10-06): the engine's LOOT-RULES LEVEL.
 *
 * THE RULE: an integer, bumped by one by every engine change that alters WHICH pickups are written
 * — a loot-correctness fix: a line written that was not loot, or loot that was not written — and
 * never by anything else. Not by item names or a new item table, not by the shape or wording of a
 * loot line, not by trades, activity lines, [status] or [health], not by a decoder fix that
 * changes no pickup. It never goes down.
 *
 * 1 = the first level whose pickups the bot's trade counting (raid-bot ADR 0168, slice B) may
 * count. It vouches for the pickup behaviour of protocol18 at 30124f1, which carries three fixes,
 * each pinned by a replay cut from a recording of the owner's:
 *   - #13's 44e969d: a bank deposit near a chest is no longer written as chest loot
 *     (test/bank-deposit.test.js, 2026-09-28);
 *   - #19: a stack split or a player trade near a chest is no longer written as chest loot
 *     (test/split-and-trade.test.js, 2026-09-21);
 *   - #21: an item keeps no chest from the last map (test/zone-change-chest-owner.test.js,
 *     2026-09-16) — object 609's 17:44:49.958 gauntlets, taken out of the member's own island
 *     storage, had been written as boss-lair chest loot 96 s before trade 327.
 * 30124f1 ITSELF declares no level — this file did not exist there — so a capture app built over it
 * stamps none, sends none, and the bot counts none of its pickups. The first engine that declares
 * level 1 is the commit that adds this file (feat/loot-rules-level, merged into protocol18 after
 * 30124f1; README-mac.md's table records its merge), and it changes no pickup.
 *
 * WHO READS IT: the capture app's build (tools/prepare-engine-dist.mjs) requires this file from the
 * engine checkout and stamps the number beside the bundle as ENGINE_LOOT_RULES; the app sends it as
 * `X-Capture-Loot-Rules` with every upload, and the bot counts a run's pickups toward a trade only
 * when its level is at least the bot's minimum. A missing level counts as none. It replaced a list
 * of engine commit shas kept by hand in raid-bot: a sha has no order, so every engine commit —
 * loot-relevant or not, a rebase included — needed a new entry, while a level is raised once, by
 * the change that earns it.
 *
 * WHEN YOU BUMP IT: add the level's row to README-mac.md ("The loot-rules level") and its pinning
 * tests to test/loot-rules.test.js, which refuses a level without both. A patch the capture app
 * applies on top of this engine that changes which pickups are written must bump it as well.
 * Keep this file a bare value: no require, nothing to run — a build script loads it.
 */
module.exports = { LOOT_RULES: 1 }
