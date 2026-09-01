[![Download AO Loot Logger](https://img.shields.io/badge/AO%20Loot%20Logger-Download-blue)](https://github.com/madvac/ao-loot-logger/releases/latest)
[![Discord](https://img.shields.io/badge/discord-join-blue)](https://discord.gg/fvNMF2abXr)

# Albion Online Loot Logger

With AO Loot Logger you can write all the loot grabbed by other players to a file. With this file, you can use [Loot Logger Viewer](https://loot-logger.ddns.net/ao-loot-logger-viewer) to analyze it. <br>
Original Loot Logger Viewer is [HERE](https://matheus.sampaio.us/ao-loot-logger-viewer)

**NOTE:** It does not work with a VPN (i.e. Exit Lag) or playing through Geforce Now.

## Discord

Join the discord server for questions and help: https://discord.gg/fvNMF2abXr


## Funding

You can always [buy me a coffee](https://www.buymeacoffee.com/madvac) ❤️


## How to Use (Windows)

1. Install [Npcap with WinPcap compatibility](https://nmap.org/npcap).
2. Download the latest AO Loot Logger for Windows: https://github.com/madvac/ao-loot-logger/releases/latest
3. Extract the folder somewhere
4. Run `ao-loot-logger.cmd`.
5. The log is written to a file in the same folder as the executable (you can see the full path when AO Loot Logger starts).

## How to Use (Linux)

1. Install `libpcap-dev`: `sudo apt-get install libpcap-dev`
2. Download the latest AO Loot Logger for Linux: https://github.com/madvac/ao-loot-logger/releases/latest
3. Extract the folder somewhere
4. Run `ao-loot-logger`.
5. The log is written to a file in the same folder as the executable (you can see the full path when AO Loot Logger starts).

## How to run from source

1. Install [Node.js](https://nodejs.org/) v24 or newer.
2. **Windows:** Install [Npcap with WinPcap compatibility](https://nmap.org/npcap).
   **Linux:** Install libpcap: `sudo apt-get install libpcap-dev`
3. In the project folder, run `npm install` to install dependencies.
4. Run `npm start`.

## Questions?

Start a [discussion](https://github.com/matheussampaio/ao-loot-logger/discussions).

## Found any problem?

Create an [issue](https://github.com/matheussampaio/ao-loot-logger/issues) so we can get it fixed.

## Guild-screen packet dump (investigation tool, off by default)

A bounded recorder for answering "does my client receive the numbers this screen
draws, and in which message?". It exists for the guild's **Siphoned Energy** screen —
the account total and the rows behind the 📋 log button — but it is not specific to it.

It is **off unless you arm it**, and it writes your guild's data to a file in the
working directory. Read that file before you send it anywhere.

```sh
HIGHLIGHT=1291,5,11 sudo -E node src/index.js
```

Then press **`g`** and open the screen you want explained. The window records every
event, request and response for 120 seconds into `guild-dump-<timestamp>.jsonl`, then
closes itself. `DUMP_PACKETS=1` arms at startup instead, for a run whose stdin is not
a terminal.

`HIGHLIGHT` is the part that saves the afternoon: give it the numbers you can **see**
on the screen (the account total, the territory count, the control cost) and every
packet containing one is called out in the terminal as it arrives. A recording is a
few thousand packets; the ones that matter announce themselves.

Reading the result:

```sh
grep -c . guild-dump-*.jsonl                        # how much arrived
grep '"match"' guild-dump-*.jsonl | head            # the packets carrying a number you can see
jq -r 'select(.match != null) | "\(.kind) \(.id)"' guild-dump-*.jsonl | sort | uniq -c
```

The `id` on a response or request is its operation code, on an event its event code.
Those codes **drift between game patches** (see the note in `src/config.js`), so treat
one you find as a lead to re-derive, not a constant.
