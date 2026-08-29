# AO Loot Logger — macOS (personal build)

Upstream (`matheussampaio/ao-loot-logger`) is **stuck on Photon Protocol 16 and
decodes nothing** against live Albion — it captures packets, prints `ALBION
DETECTED`, and logs zero events. This clone therefore tracks **`madvac/ao-loot-logger`**,
a fork that implements **Protocol 18**.

Verified on 2026-08-17 against 2822 packets captured on this machine: 3458
EventData messages decode with **zero leftover bytes and zero errors**, where
upstream's decoder failed on every one.

## Run it

```sh
cd "/Users/boris/Library/CloudStorage/Dropbox/Discord Bot/ao-loot-logger"
sudo node src/index.js
```

- `sudo` because capture needs `/dev/bpf*`, which is `root:wheel` here. (The
  no-sudo alternative is Wireshark's ChmodBPF helper.)
- Start it **before** the fight; it only logs what happens near you while running.
- The log lands next to this file as `loot-events-<date>.txt` — that exact file
  is what you drop into the raid's officer thread for the bot's 📦 Loot session.
- Green `ALBION DETECTED` = capture is live. `(cannot open BPF device)` = sudo
  did not take, and nothing will ever be recorded.
- A `[status]` line prints every 60s: your character name and lines written.

## What actually gets logged

Loot taken **from something with an owner** — a player's corpse, a mob's bag,
and (per the code) an outpost or world/dungeon LOOT chest, whose owner string is
copied onto each item by `EvAttachItemContainer`. In that case `looted_from`
holds the chest's identifier rather than a player name.

**Where each kind of loot actually comes from:**

| source | who you can see | how |
|---|---|---|
| corpse / mob bag | **everyone nearby**, named | `EvOtherGrabbedLoot` (279) — proven live |
| loot chest (Morgana camp, dungeon, random spawn) | **yourself, named; others named too when partied** | chest registers via `EvNewLootChest` (393) so your own pickups carry its real name; `PartyLootItems` (302) names a player per item — attribution is taken from there, since the removals identify items only by TYPE and cannot be matched when two members are owed the same type |
| **territory / guild storage** | **everyone, named** | **the game's own per-chest log** (Actions → Chest Log on THAT chest) — better than capture, and no capture needed |

Measured 2026-08-19: a `TREASURE_SOLO_UNCOMMON` chest logged own pickups under
its real name, and a party-loot assignment carried **14 items, 14 names**. Note
the party pair also fires for MOB BAGS when you are in a party, duplicating
`EvOtherGrabbedLoot` — so this fork takes the party path for CHESTS only.

Territory storage is a *building with access control* (measured: every container
attach there sits among `NewBuilding` / `AccessStatus` / `NewFortificationBuilding`,
with no loot event at all), so its items carry no owner and the logger cannot
tell a withdrawal from a pickup.

**`LOG_UNKNOWN_SOURCE=1`** logs your own pickups from such unregistered
containers anyway, as `looted_from = @UNKNOWN_CONTAINER`. Off by default on
purpose: it would record gear you took OUT of guild storage as loot, which
inflates what you "looted" and drags your donation compliance down in the bot's
report. Use it for testing, not for a live raid.

**Deposits are not loot, and for a while they were logged as loot.** Reported
2026-08-29: items dropped INTO a hideout chest turned up in the log as pickups.
`EvInventoryPutItem` fires for every container the client is watching, not just
your backpack, and carries no direction — taking an item out of a chest and
dropping one in arrive identically. The only thing keeping a deposit out of the
log is that it has no owner and no chest is in play; the chest window had stopped
being able to say "no chest is in play", because EVERY container attach extended
it, so a chest name from an earlier raid stayed "recent" for as long as you kept
opening containers — including the hideout chest you were depositing into.

Now two separate clocks: any container activity opens the debug-dump window, and
only a chest that NAMES itself arms attribution (re-armed by that same chest while
you empty it). Ten minutes after the last chest, an ownerless pickup is dropped
again, which is the right answer for a deposit, a bank withdrawal or a mount-bag
shuffle. `npm test` pins it, the hideout case included.

One narrow case survives by design: moving items into a bag while literally
standing at a chest you looted seconds ago is still indistinguishable from taking
them out of it. Telling those apart needs the destination container to be
identifiable as yours, and nothing measured so far says it is — so it is written
down rather than guessed at.

**Chest attribution depends on the party's LOOT MODE — this is the big one.**

| party loot mode | what a chest tells your client |
|---|---|
| **party loot / distribution** | `PartyLootItems` names EVERY item and EVERY member (75 items / 75 names observed) — full attribution |
| **free-for-all** | nothing usable: either no assignment at all, or one with every array empty (params 7/8 = `-1`). Nobody is attributable, not even party members |

Measured 2026-08-19 across seven chests. Your OWN pickups always log either way
(via `EvInventoryPutItem`, under the chest's real name). Anyone outside the
party is never attributable regardless of mode.

**So: run party-loot mode if you want the group's chest loot on the report.**

**Chest attribution also requires you to be IN the distribution.**
Measured across five chests on 2026-08-19. When you take part, the assignment
event names every item and every player (75 items / 75 names on one chest), and
this fork writes a line per item for everyone but you. When you merely stand
next to a chest that others empty, your client receives the chest's REGISTRATION
and nothing else — no assignment, no removal, no names. So a member who wants
the group's chest loot recorded has to be looting it too.

**Other players' pickups — corpses AND chests, by two different events.**

- Corpses/bags: `EvOtherGrabbedLoot` (279). Measured — 16 events in the 30s
  around a death, naming both enemy looters.
- Chests: `PartyLootItems` (302) + `PartyLootItemsRemoved` (303), wired here as a
  local patch. 302 assigns items to player NAMES (parameter 10 is a `string[]`,
  one name per item); 303 says which actually left the chest; the join is the
  attribution. A line is written only on 303, so an item earmarked but not taken
  is never logged, and a replayed 303 cannot double-log.

An earlier note here claimed chests were unattributable. That was wrong: it was
measured with a build subscribed to ten event codes, none of them 302/303, so
the silence was the instrument's, not the server's.

The file is created lazily, on the first captured pickup, so an empty folder
usually means "nothing qualifying has been looted yet".

## Local patches on top of the fork

Kept in one commit so `git pull madvac main` stays easy:

1. **Pre-`OpJoin` self-loot is held, not dropped.** Your own pickups are
   attributed to `players.self`, which is only set when you join a map — so
   starting the logger mid-zone silently discarded everything you looted until
   your next zone change. Those pickups now wait in `src/pending-self-loots.js`
   and are written the moment your character is identified.
2. **The item-name fetch is bounded** (`AbortSignal.timeout(8000)`). It had no
   timeout, so a slow or 503-ing GitHub stalled startup in silence for 15s+.
3. **`[status]` heartbeat** every 60s, and the log path resolves to this folder
   (the fork's `'..','..'` is right for its packaged binary, not for source).

## Notes

- No capture through a VPN (NordVPN included) or GeForce Now.
- Update: `git pull madvac main` (may need to re-apply the patches above).
- GPL-3.0, like both upstream and the fork.
- `sample-loot-borys.txt` / `sample-loot-maria.txt` are synthetic two-uploader
  captures for exercising the bot without the game running;
  `test-fixtures-packets.json` holds the real packets used to verify the decoder.
