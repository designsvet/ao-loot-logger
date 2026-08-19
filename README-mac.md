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

**Your own pickups log even when the container is unknown.** Items whose
container never registered (you started the logger while already standing at the
chest, or a container class that never announces itself) are written with
`looted_from = @UNKNOWN_CONTAINER` rather than dropped — who took what is the
part that matters, and the source column is display only.

**Watch for:** if ordinary bank or guild-chest shuffling starts appearing as
loot, that placeholder is why — say so and it gets gated behind a flag.

**Not needed anyway for guild/territory storage:** the game's own chest-log
export already records those withdrawals WITH the player's name, for everyone,
no capture required.

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
