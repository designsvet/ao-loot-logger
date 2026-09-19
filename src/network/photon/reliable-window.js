/**
 * Local patch (Guild Butler, 2026-09-18) — drop Photon's resent reliable commands.
 *
 * When the server does not see our client acknowledge a reliable command in time, it sends the
 * command AGAIN, with the same sequence number. The game client throws the repeat away by that
 * number. This engine sniffs the wire instead of being the client, and until this patch it read
 * the number and ignored it — so every resend was decoded twice.
 *
 * Measured on the owner's five-hour recording of 2026-09-16: the fame events summed to exactly
 * the change in the character's own running fame total PLUS 357,120 — the fame of one craft
 * whose whole block of events (the new items, three fame events, six journal fills, the finish)
 * arrived a second time 227 ms later. Health updates, loot reveals and journal fills showed the
 * same repeats. A resend is byte-identical and carries the original's number; nothing in the
 * payload can tell it apart from a genuine second event, because a genuine one can be identical
 * too (that craft's three fame events were 44,640 · 267,840 · 44,640 — all three real, the
 * journals prove it). So the only correct place to drop a repeat is here, by its number.
 *
 * The key has to name the CONNECTION AND DIRECTION, not just the channel. Both directions of a
 * connection number their own commands from 1, and the engine sees both — keyed by channel alone,
 * the committed packet fixture collides 681 times on commands that are different. A packet with
 * no connection key (the fixture replays, the tests) is never deduplicated, which keeps every
 * existing replay exactly as it was.
 *
 * Sequence numbers climb for the life of a connection. A repeat is always recent, so each
 * (connection, channel) keeps a window of the numbers it has seen near the top; a number far
 * BELOW the top means the connection started over (a reconnect on the same ports), and resets it.
 */

const WINDOW = 4096

class ReliableWindow {
  constructor(window = WINDOW) {
    this.window = window
    this.channels = new Map() // `${connection}#${channel}` -> { max, seen:Set }
    this.dropped = 0
  }

  /** True when this command was already delivered — the caller skips it. */
  isRepeat(connection, channel, sequence) {
    if (connection == null || !Number.isInteger(sequence)) {
      return false
    }

    const key = `${connection}#${channel}`
    let state = this.channels.get(key)

    if (state == null || sequence < state.max - this.window) {
      // First sight of this channel, or it started over: remember and deliver.
      state = { max: sequence, seen: new Set([sequence]) }
      this.channels.set(key, state)

      return false
    }

    if (state.seen.has(sequence)) {
      this.dropped += 1

      return true
    }

    state.seen.add(sequence)

    if (sequence > state.max) {
      state.max = sequence

      // Forget what fell out of the window, in one pass once it has grown past two windows.
      if (state.seen.size > this.window * 2) {
        for (const seen of state.seen) {
          if (seen < state.max - this.window) {
            state.seen.delete(seen)
          }
        }
      }
    }

    return false
  }

  /**
   * A connection announced a new session (CONNECT / VERIFY_CONNECT / DISCONNECT). Pass BOTH
   * directions: a session starts over on each side at once, and a reconnect on the same ports
   * would otherwise have its first commands taken for repeats of the last session's — the
   * window only catches a restart once the new numbers are far below the old top.
   */
  reset(...connections) {
    for (const connection of connections) {
      if (connection == null) {
        continue
      }

      for (const key of [...this.channels.keys()]) {
        if (key.startsWith(`${connection}#`)) {
          this.channels.delete(key)
        }
      }
    }
  }
}

module.exports = { ReliableWindow, WINDOW }
