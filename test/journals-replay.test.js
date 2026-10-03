const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createActivity } = require('../src/activity/activity')

const fixture = (name) => path.join(__dirname, 'fixtures', name)
const rows = fs.readFileSync(fixture('journals-2026-09-16.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)
const items = JSON.parse(fs.readFileSync(fixture('journals-items.json'), 'utf8')).items

test('the recorded completion fields produce six books from three genuine packets', () => {
  const lines = []
  let at = 0
  const activity = createActivity({
    sink: (record) => lines.push(record),
    items: { get: (index) => items[index] != null ? { itemId: items[index] } : undefined, source: 'live' },
    now: () => at
  })

  for (const row of rows.slice(0, 4)) {
    at = Date.parse(row.at)
    if (row.kind === 'response') {
      activity.onResponse({ parameters: row.payload })
    } else {
      activity.onEvent({ parameters: row.payload })
    }
  }

  const books = lines.filter((line) => line.t === 'journal')

  assert.deepEqual(books.map((line) => line.qty), [1, 4, 1])
  assert.equal(books.reduce((sum, line) => sum + line.qty, 0), 6)
  assert.ok(books.every((line) => line.item === 'T8_JOURNAL_WARRIOR_FULL' && line.index === 12055 && line.char === 'Me'))
  assert.equal(books[0].at, Date.parse(rows[1].at))
  assert.deepEqual(Object.keys(rows[1].payload), ['0', '1', '2', '252'])
})

test('the historical dump retains the repeated block because it contains no sequence numbers', () => {
  // The later block's resend status is inferred from timing and the surrounding craft packets.
  // Do not invent original sequences or use these payloads as a deduplication key. Parser-level
  // reliable-window tests separately prove the live sequence filter with a real packet fixture.
  const lines = []
  const activity = createActivity({
    sink: (record) => lines.push(record),
    items: { get: (index) => ({ itemId: items[index] }), source: 'live' }
  })

  for (const row of rows) {
    if (row.kind === 'response') {
      activity.onResponse({ parameters: row.payload })
    } else {
      activity.onEvent({ parameters: row.payload })
    }
  }

  assert.equal(lines.filter((line) => line.t === 'journal').reduce((sum, line) => sum + line.qty, 0), 12)
  assert.ok(rows.every((row) => row.sequence === undefined))
  assert.equal(Date.parse(rows[4].at) - Date.parse(rows[1].at), 239)
})
