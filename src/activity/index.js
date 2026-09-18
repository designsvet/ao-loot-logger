const Items = require('../items')
const { createActivity } = require('./activity')
const { ActivityLog } = require('./activity-log')

/**
 * The live wiring: the tracker writes into the log. Both are created once, and the data handler
 * calls in through `onEvent` / `onResponse` inside its own try/catch — an activity bug may lose an
 * activity line, never a loot line.
 */
const log = new ActivityLog()
const activity = createActivity({ sink: (record) => log.write(record), items: Items })

process.on('exit', () => log.close())

module.exports = { log, onEvent: activity.onEvent, onResponse: activity.onResponse, state: activity.state }
