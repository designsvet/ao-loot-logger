const fs = require('fs')
const path = require('path')

/**
 * Local patch (Guild Butler, 2026-10-05) — where the trade records go.
 *
 * One JSON object per line, in `trade-events-<stamp>.jsonl` BESIDE the loot log and named after it —
 * the activity log's rule (src/activity/activity-log.js), so the capture app finds all three files
 * of a run together and a rotation of the loot log rotates this too.
 *
 * Off unless TRADE_EVENTS=1: until the capture app reads the file, writing it would only leave
 * partner names in a file nobody reads in every member's capture folder. The file is the member's
 * own trade journal, silver-only trades included; what (if anything) leaves the machine is the
 * app's decision, made there (the owner's default: silver-only trades are not uploaded).
 */

/** `loot-events-2026-10-05-17-43-51.txt` → `trade-events-2026-10-05-17-43-51.jsonl`, same folder. */
const tradeFileFor = (lootFile) =>
  path.join(path.dirname(lootFile), path.basename(lootFile).replace(/^loot-events-/, 'trade-events-').replace(/\.txt$/, '.jsonl'))

class TradeLog {
  constructor({ enabled = process.env.TRADE_EVENTS === '1', lootFile = () => require('../loot-logger').logFileName } = {}) {
    this.enabled = enabled
    this.lootFile = lootFile
    this.stream = null
    this.fileName = null
    this.linesWritten = 0
  }

  write(record) {
    if (!this.enabled) {
      return false
    }

    const target = tradeFileFor(this.lootFile())

    if (target !== this.fileName) {
      this.close()
      this.fileName = target
      this.stream = fs.createWriteStream(target, { flags: 'a' })
    }

    this.stream.write(`${JSON.stringify(record)}\n`)
    this.linesWritten += 1

    return true
  }

  /** `done` is called once the buffered lines are on disk (tests read the file straight after). */
  close(done) {
    const stream = this.stream

    this.stream = null

    if (stream == null) {
      if (done) {
        done()
      }

      return
    }

    stream.end(done)
  }
}

module.exports = { TradeLog, tradeFileFor }
