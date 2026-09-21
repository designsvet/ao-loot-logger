const fs = require('fs')
const path = require('path')

/**
 * Local patch (Guild Butler, 2026-09-18) — where the activity lines go.
 *
 * One JSON object per line, in `activity-events-<stamp>.jsonl` BESIDE the loot log and named after
 * it, so the capture app finds the pair wherever the loot log lives (a packaged build writes to the
 * user's data folder, a source run to the clone) and a rotation of the loot log rotates this too.
 * The upload side mirrors the loot contract — a file read by line index, re-sendable at will.
 *
 * Off unless ACTIVITY_EVENTS=1. Until the app uploads the file, writing it would only leave a file
 * nobody reads in every member's capture folder.
 */

/** `loot-events-2026-09-18-17-43-51.txt` → `activity-events-2026-09-18-17-43-51.jsonl`, same folder. */
const activityFileFor = (lootFile) =>
  path.join(path.dirname(lootFile), path.basename(lootFile).replace(/^loot-events-/, 'activity-events-').replace(/\.txt$/, '.jsonl'))

class ActivityLog {
  constructor({ enabled = process.env.ACTIVITY_EVENTS === '1', lootFile = () => require('../loot-logger').logFileName } = {}) {
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

    const target = activityFileFor(this.lootFile())

    if (target !== this.fileName) {
      this.close()
      this.fileName = target
      this.stream = fs.createWriteStream(target, { flags: 'a' })
    }

    this.stream.write(`${JSON.stringify(record)}\n`)
    this.linesWritten += 1

    return true
  }

  close() {
    if (this.stream != null) {
      this.stream.end()
    }

    this.stream = null
  }
}

module.exports = { ActivityLog, activityFileFor }
