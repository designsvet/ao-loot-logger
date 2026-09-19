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

One attach may still re-arm the window: the chest's OWN container, resolved by the
id `EvNewLootChest` registered it under, so it carries that chest's name. Measured
in a real capture — a Keeper camp chest logged pickups 2m23s apart — and it cannot
fire on your bank, a mount bag or a hideout chest, all of which attach with no
owner, which is exactly why an ownerless pickup is dropped in the first place.

Two cases survive by design, written down rather than guessed at. Moving items into
a bag while literally standing at a chest you looted seconds ago is still
indistinguishable from taking them out of it. And **a pickup that merges into a
stack you already hold is written twice** — measured 2026-08-29: five chest pickups
each produced a second line at the same millisecond carrying the merged total (`10`
then `14` potions; `1` then `2` jackets). The second line is your own pre-existing
stack being re-announced while the chest window is legitimately open, so no amount
of window tightening reaches it. Both need the destination container to be
identifiable as yours, and nothing measured so far provides it.

**An item the table does not know is still logged.** After a game patch a new
item has no name here until ao-bin-dumps publishes the new list, and with no
current item table at all (next section) no item has one. Your OWN pickups of
such an item used to be
dropped with only a console warning, while ANOTHER player's were logged as
`UNKNOWN_<id>` — so a member could donate gear that never appeared in their
looted column. Every path now falls back the same way, the chest assignment and
the siege banner included (they still dropped theirs until 2026-09-18): an
unnamed item is honest and joinable by id downstream, a missing one is not
recoverable at all.

**Chest attribution depends on the party's LOOT MODE — this is the big one.**

| party loot mode | what a chest tells your client |
|---|---|
| **party loot / distribution** | `PartyLootItems` names EVERY item and EVERY member (75 items / 75 names observed) — full attribution |
| **free-for-all** | nothing usable: either no assignment at all, or one with every array empty (params 7/8 = `-1`). Nobody is attributable, not even party members |

Measured 2026-08-19 across seven chests. Your OWN pickups logged either way
there (via `EvInventoryPutItem`, under the chest's real name) — but not
everywhere: in the Ancient Lands (2026-09-14) a chest assigned to you sends no
`EvInventoryPutItem` at all; the game moves the items into your bag by itself.
Anyone outside the party is never attributable regardless of mode.

**So: run party-loot mode if you want the group's chest loot on the report.**

**Chest attribution also requires you to be IN the distribution.**
Measured across five chests on 2026-08-19. When you take part, the assignment
event names every item and every player (75 items / 75 names on one chest), and
this fork writes a line per item for everyone, you included — your own share is
written at assignment since 2026-09-14. A put-item or move-item that follows for
the same item is skipped. The match is by object id where the assignment's ids
are the ones the pickup carries (an assumption: no captured packet has shown it
yet), and otherwise by chest and item type within the chest window. The type
match exists because a pickup event carries the id of the object that ends up
in the destination slot (measured 2026-09-14), so an item that merges into, or
splits from, a stack in your bag arrives under that stack's id. A pickup under
another id that comes after the window is still written a second time. When
you merely stand next to a chest that others empty, your client receives the
chest's REGISTRATION and nothing else — no assignment, no removal, no names. So
a member who wants the group's chest loot recorded has to be looting it too.

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

## Item names: from a current table, or not at all

The game sends an item as a NUMBER — its position in the game's own item list —
and the engine names it from a copy of that list (ao-bin-dumps'
`formatted/items.txt`). The list is positional, so one item inserted near the
top renumbers everything below it. Measured 2026-09-18 across every version
ao-bin-dumps published since 2025-04-23: 18 of 19 updates renumbered between
4.6% and 99.8% of the table (the 19th was a byte-identical re-upload), one to
seven weeks apart. A copy of the list is right until the next patch, and then
wrong nearly everywhere at once.

Until 2026-09-18 the engine fell back to a copy bundled in `src/items-fallback.js`
whenever the startup download failed — no network, a GitHub hiccup, an 8-second
timeout, or the capture app starting before Wi-Fi did. That copy was frozen on
2026-07-21. Against the current list it named **12,049 of its 12,071 numbers
wrongly** (first difference at 23: `T3_FARM_OX_BABY`, now `T8_FARM_DRAKE_BABY`;
184 is `T1_SEAWEED`, it said `T1_FISHSAUCE_LEVEL3`; 3018 is a fishing rod, it said
`T8_MOUNT_ARMORED_HORSE_MORGANA@1`). Replayed against the 2026-09-16 five-hour
recording, it named **6 of 22,891** item events correctly. Practically every loot
line of such a session named the wrong item, the bot priced and judged the wrong
item, and the only trace was one console line.

**The rule now: names come only from a table known to be current this run.**

- **At startup** the engine downloads the list (8s limit, as before). If it
  keeps a copy from an earlier run (`items-cache.json`), it asks the server
  whether that copy is still current; a `304` answer means yes and costs no
  download. A copy is **never used without that answer**: offline there is no
  telling whether a patch has happened since it was saved, and a copy one patch
  behind names the wrong item — exactly the failure above.
- **With no current table**, every item is written as `UNKNOWN_<number>` /
  `Unknown Item (<number>)`, the marker this engine already used for items newer
  than its table. It is inside the bot's line format (`AO_LOOT_RE`), the bot
  already reads it as "the engine's table is behind the game" and prices it as
  unknown, never as zero — and it keeps the number, so a current table can name
  it later. No change to the loot file's format.
- **A failed startup keeps trying** in the background: 15s, 30s, 1m, 2m, 5m,
  then every 10m. A table that arrives takes over **at the next zone change**,
  never mid-zone: our own chest share is matched to the pickup that follows it
  by item type (`storage/assignment-written.js`), and an `UNKNOWN_` on one side
  and a real name on the other would not match, writing the pickup twice. The
  new map's own items can arrive before its Join response (seen in
  `test-fixtures-packets.json`), so items already held are renamed by the new
  table at that moment too.
- **A running engine re-checks every 30 minutes** (a `304` again, so no
  download), because a capture app left open for days outlives a patch. A
  changed list is announced and takes over at the next zone change the same way.
  A failed re-check keeps the table in hand: it was current when last confirmed.
- **A download that is not a whole table is refused**: fewer than 10,000
  entries, a number out of sequence, or an id the bot's parser would not accept.
  All 20 published versions pass (11,589–12,237 entries, numbered 1..N).

**"Current" means current as ao-bin-dumps publishes it, not as the game has
it.** The list is dumped from the game client after a patch, and the dump can
lag. On 2026-09-01 at 20:36 UTC madvac's fork committed a list with the new
numbering while ao-bin-dumps still served the July one. It caught up on
2026-09-03 at 11:46 UTC, with the same 12,237 ids in the same positions. For at
least 39 hours, then, a download that succeeded named items wrongly: existing
items carried the wrong names, not only new ones going unnamed, because the
list is positional. Nothing in the traffic shows this is happening (see the
last point below). The 30-minute re-check picks up the new list once it is
published.

What it looks like on the console:

```
[items] 12237 item names loaded (downloaded).
[items] 12237 item names loaded (cached copy, confirmed current).
[items] No current item table (offline, or the address does not resolve), so loot is written as UNKNOWN_<item number>
[items] Current item table arrived (12237 items); names resume at your next zone change.
[items] Naming items from the current table now (12237 items).
```

The cache lives beside the loot log when you run the engine by hand, and in the
capture app's per-user captures folder when the app runs it (the app sets that
as the working folder). It is a cache only — delete it at will. Nothing printed
here uses the words the capture app reads as a capture-permission failure
(`EACCES`, `EPERM`, "permission denied"), so a firewall or a read-only folder
cannot stop the app restarting the engine; `npm test` pins that.

Weighed and not done:

- **Keep a bundled copy, refreshed at build time** (the capture app's CI already
  prepares the engine). A fresh build would be right only until the next patch
  — one to seven weeks — and then wrong everywhere with nothing to say so. That
  is the old failure on a timer, so the bundled copy is deleted outright rather
  than kept as a trap.
- **Trust the cached copy offline when it is young.** A day-old copy is right
  most of the time, but when a patch lands inside that day it names every item
  wrongly, confidently. An `UNKNOWN_` loses nothing that a current table cannot
  recover; a wrong name does.
- **Sanity-check a table against the traffic.** Neither signal holds up on the
  2026-09-16 recording: the highest number the game sent in five hours was
  11,920, inside even the stale copy's 12,071, so "a number past the end" never
  fires; and "equipment events name equipment" scored 82% on the stale copy
  against 87% on the current one — the lists are grouped by family, so a shift
  mostly lands on another item of the same kind.

## Local patches on top of the fork

Kept in one commit so `git pull madvac main` stays easy:

1. **Pre-`OpJoin` self-loot is held, not dropped.** Your own pickups are
   attributed to `players.self`, which is only set when you join a map — so
   starting the logger mid-zone silently discarded everything you looted until
   your next zone change. Those pickups now wait in `src/pending-self-loots.js`
   and are written the moment your character is identified.
2. **The item-name fetch is bounded** (`AbortSignal.timeout(8000)`). It had no
   timeout, so a slow or 503-ing GitHub stalled startup in silence for 15s+.
   Since 2026-09-18 a failed fetch no longer falls back to a bundled list; see
   "Item names: from a current table, or not at all" above.
3. **`[status]` heartbeat** every 60s, and the log path resolves to this folder
   (the fork's `'..','..'` is right for its packaged binary, not for source).
4. **A deposit, an equip or a shuffle near a chest is not loot** (2026-09-11).
   Within 90s of a chest naming itself, every ownerless item put anywhere was
   written as a pickup from that chest — gear dropped INTO the guild chest, and
   gear moved between your own equipment and inventory, included. A put into a
   container you have open, or one your own move request shows came out of your
   own container, is now dropped (`src/storage/own-containers.js`,
   `src/storage/recent-moves.js`). A withdrawal from a guild chest near a named
   chest is still indistinguishable from loot.
5. **Run by Guild Butler Capture, the loot log goes to the app's captures
   folder, not into the app** (2026-09-18). The app starts the engine with
   `ELECTRON_RUN_AS_NODE=1`, working in its per-user captures folder, but the
   log went beside the engine anyway, and for the engine the app bundles that
   is inside the installed app. Measured on this Mac with app 0.8.2: three loot
   logs in `Guild Butler Capture.app/Contents/Resources/engine`, which
   `codesign --verify --deep --strict` named as the only files breaking the
   bundle's seal, and none in
   `~/Library/Application Support/guild-butler-capture/captures`. On Windows
   that folder is the install dir, which every update replaces, and a Mac user
   without admin rights cannot write there at all. The log now follows the
   working folder when the app runs the engine, as `debug-logs.txt` and the
   packet dumps already did. A run by hand still writes beside this clone
   (`logDir` in `src/loot-logger.js`).

## Notes

- No capture through a VPN (NordVPN included) or GeForce Now.
- Update: `git pull madvac main` (may need to re-apply the patches above).
  madvac refreshes `src/items-fallback.js` every few weeks; this fork deleted it
  on 2026-09-18, so resolve that conflict by keeping it deleted
  (`git rm src/items-fallback.js`). The `check-items-and-ids` workflow that
  regenerates it upstream has never run on this fork (a fork's scheduled
  workflows stay off until someone enables them), and would write to `main`,
  not `protocol18`.
- GPL-3.0, like both upstream and the fork.
- `sample-loot-borys.txt` / `sample-loot-maria.txt` are synthetic two-uploader
  captures for exercising the bot without the game running;
  `test-fixtures-packets.json` holds the real packets used to verify the decoder.

## Recording a whole session (the activity-stats step 0)

The 120-second `g` window answers "what arrives when I open this screen". The
activity-stats plan (raid-bot, `docs/plans/2026-09-capture-activity-stats.md`)
asks a different question — which stats does an **evening of play** put on the
wire, and in what shape — so there is a session-long mode:

```sh
cd ao-loot-logger
sudo DUMP_PACKETS=session ALBION_IFACE=en0 node src/index.js
```

(`route -n get default | grep interface` names the interface.) It announces the
file it is writing (`guild-dump-<timestamp>.jsonl`, next to the loot log), records
every event, request and response until you press **Ctrl-C**, and prints the count
once the file is flushed. A twenty-minute session is tens of thousands of records
and a few megabytes. Events with no code — the Move stream, half of all traffic —
are left out in this mode: they are position data and answer nothing here.

Then read it with the analyzer, which grades the recording against the plan's own
checklists and prints the parameter shapes it found:

```sh
node tools/analyze-recording.js guild-dump-2026-09-10T19-02-44.jsonl --r1
node tools/analyze-recording.js guild-dump-2026-09-10T20-15-01.jsonl --r2
node tools/analyze-recording.js guild-dump-*.jsonl --code 176 --samples 4   # every record of one code
```

**R1 — open world, 20–30 minutes:** kill mobs of three or more kinds (one solo, one
in a party); gather three resource types with a tool; fish five casts including one
that gets away; open two chests; pick silver up off the floor; enter and leave a
solo dungeon. The analyzer also settles **whose object id is "me"** — a Join's
parameter 0 has to turn up as the actor of an own-only packet (a silver pickup, a
harvest) — which is the one question a personal page cannot be built without.

**R2 — a city, 15 minutes:** buy instantly, sell instantly, place a sell order and a
buy order, open the mailbox and read one sold mail, craft two items (one with
focus), repair, and do one player-to-player trade.

Names beside codes come from `tools/photon-codes.json` — the reference tool's
enum on the current patch. Both enums shift when the game inserts a member, so a
name is a lead, not a spec; the parameter shape is what the handlers are pinned to.

The file holds your guild's data — player names, ids, amounts. Read it before
sharing it; it is gitignored on purpose.

**What the two step-0 recordings changed (2026-09-16 and 2026-09-18, R1 13/13 and R2 15/15
between them).** Four rules the checklists had wrong, because they were written from the
reference tool's model rather than the wire:

- A fish that gets away **omits** the success flag on the finish request; it never sends
  `false`. The server's own bout state (event 355, parameter 3) says it outright: 9 landed,
  10 escaped. Same "absent, never zero" rule the item values follow.
- One craft action can make many items (eight scythes in one), so the check is an action,
  not a count of two. A filled crafting journal is its own event (292) and now has a line.
- The game answers a market sale or an order with an **empty** parameter table. Whether it
  went through lives only in the response's return code, which the recorder threw away until
  this change — records now carry `rc` (and `dm`, the debug message, when there is one), and
  the analyzer prints them per market reply. Recordings made before this say "not recorded".
- Several checklist targets can watch one code now (event 355 is both "landed" and "escaped").

## Activity lines (phase 1 of the activity stats) — off unless `ACTIVITY_EVENTS=1`

```sh
sudo ACTIVITY_EVENTS=1 ALBION_IFACE=en0 node src/index.js
```

Beside every `loot-events-<stamp>.txt` the engine then writes `activity-events-<stamp>.jsonl`:
one JSON object per completed thing the member did, for the capture app to upload. Every line
carries `v` (1), `t` (the kind), `at` (epoch ms), `char` and `zone`:

| `t` | written when | fields |
| --- | --- | --- |
| `zone` | every zone join | `items` (`live`: a current item table names this zone's items; `none`: no current table, every item is `UNKNOWN_<index>`), `fame_total` |
| `fame` | fame gained | `gain`, `total`, `premium` |
| `silver` | the member picks silver up | `yield`, `cluster_tax`, `guild_tax`, `alliance_tax`, `premium` |
| `harvest` | a gather finishes | `item`, `index`, `std`, `bonus`, `premium` |
| `fish` | a bout ends | `outcome` (`landed`/`escaped`), `rod`, `rod_index`, `catch: [{item, index, qty}]` |
| `kill` | a mob the member hit dies | `mob` (index), `hp` |
| `chest` | the member opens a chest | `name`, `rarity` |
| `respec`, `might`, `faction` | as the game reports them | the game's own fields |

Fame, silver and respec are **raw fixed-point integers** (value × 10,000) — neither divides evenly,
and the reader divides. Mob and zone ids are written as sent and named downstream.

Three rules, each learned from the step-0 recordings (the "why" is in `src/activity/activity.js`):
the member is the Join's parameter 0, reissued on every zone join; silver pickups and harvests are
broadcast for everyone nearby and are filtered to the member; nothing is deduplicated by payload.

**Resends are dropped in the Photon parser now, for loot too.** The server resends a reliable
command it did not see acknowledged; the game client drops the repeat by sequence number, and until
this change the engine decoded it twice — a whole craft's events, health updates, pickups. The
parser now drops a repeat by (connection, direction, channel, sequence number), never by content,
because a genuine second event can be identical to the first. `PHOTON_DEDUPE=0` turns it off to
compare. A new `[activity]` line every minute reports lines written and resends dropped (a separate
line, so the capture app's `[status]` pattern never sees it).

**Item names come from a current table, or not at all** (see "Item names: from a current table,
or not at all" above; the stale bundled table this paragraph used to warn about is gone). Activity
lines carry the raw index beside every name, and the zone line says whether a current table named
the zone (`live`) or none did (`none`). The zone line is written after the zone change has switched
tables, so it describes the zone it opens.

To cut a test fixture from a recording (the only way a recording enters the repo):
`node tools/extract-activity-fixture.js <dump> test/fixtures/<name>.jsonl --from HH:MM --to HH:MM`.
It keeps only what the tracker reads and replaces the member's name, every character GUID and
hideout instance ids.
