const fallback = require('./items-fallback')

class Items {
  constructor() {
    this.items = {}
    // Local patch (2026-09-18): which table the names came from. The bundled fallback is POSITIONAL
    // and was frozen on 2026-07-21; measured on 2026-09-18 it names 12,049 of 12,071 indexes wrongly,
    // because one insertion near the top of the game's list shifts every index after it. Readers
    // that can re-resolve an index themselves need to know when not to trust a name.
    this.source = 'fallback'
  }

  async init() {
    let data = ''

    try {
      const response = await fetch(
        'https://raw.githubusercontent.com/ao-data/ao-bin-dumps/master/formatted/items.txt',
        { signal: AbortSignal.timeout(8000) }
      )

      if (!response.ok) {
        data = fallback
      } else {
        data = await response.text()
        this.source = 'live'
      }
    } catch (error) {
      console.info('Could not fetch the latest item names; using the bundled list.')
      data = fallback
    }

    for (const line of data.trim().split('\n')) {
      const raw = line.split(':')

      const itemNumId = parseInt(raw[0].trim(), 10)
      const itemId = raw[1].trim()
      const itemName = raw[2] != null ? raw[2].trim() : itemId

      this.items[itemNumId] = {
        itemNumId,
        itemId,
        itemName
      }
    }
  }

  get(itemNumId) {
    return this.items[itemNumId]
  }
}

module.exports = new Items()
