/**
 * Local patch (Guild Butler, 2026-09-01): which Albion guild this session belongs to.
 *
 * The guild's siphoned-energy total rides an event that names the guild but does NOT
 * carry its id (it carries the ALLIANCE id, which is a different thing and was
 * mistaken for the guild's during the investigation). The id arrives separately, on
 * the energy-drain response, which fires when someone opens the guild screen.
 *
 * So the id is remembered here when it is seen, and stamped onto every later energy
 * line. A session that never opens the guild screen still reports the guild NAME, and
 * the reader is expected to cope with an absent id rather than assume one.
 */

let albionGuildId = null;

const setGuildId = (id) => {
  if (typeof id === 'string' && id.length > 0) {
    albionGuildId = id;
  }
};

const getGuildId = () => albionGuildId;

const reset = () => {
  albionGuildId = null;
};

module.exports = { setGuildId, getGuildId, reset };
