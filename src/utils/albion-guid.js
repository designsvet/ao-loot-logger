/**
 * Local patch (Guild Butler, 2026-09-01): wire GUID bytes → the id Albion's public
 * API uses, which is also the id the bot stores as `guilds.albion_guild_id`.
 *
 * The wire carries a .NET `Guid`: 16 bytes whose first three groups are
 * LITTLE-endian (4, 2, 2) and whose last 8 bytes are in order. Base64-ing the bytes
 * as they arrive produces a plausible-looking id that matches nothing.
 *
 * Verified 2026-09-01 against the live client and the public API: VITRYLA's guild
 * arrives as [228,231,114,118,37,191,228,70,188,251,239,178,51,123,202,45] and the
 * API calls it `dnLn5L8lRuS8---yM3vKLQ`, which is what this returns. The naive
 * encoding of the same bytes is `5OdydiW_5Ea8---yM3vKLQ` — close enough to look
 * right in a log and wrong everywhere it is used.
 */

const GUID_BYTES = 16;

const isGuidBytes = (value) =>
  Array.isArray(value) &&
  value.length === GUID_BYTES &&
  value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255);

/** 16 wire bytes → the API's URL-safe base64 id, or null if that is not what this is. */
const guidToAlbionId = (bytes) => {
  if (!isGuidBytes(bytes)) {
    return null;
  }

  const reordered = Buffer.from([
    bytes[3],
    bytes[2],
    bytes[1],
    bytes[0],
    bytes[5],
    bytes[4],
    bytes[7],
    bytes[6],
    ...bytes.slice(8)
  ]);

  return reordered.toString('base64url').replace(/=+$/, '');
};

module.exports = { guidToAlbionId, isGuidBytes, GUID_BYTES };
