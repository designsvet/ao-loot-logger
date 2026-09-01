const fs = require('fs');
const path = require('path');

const { cyan, green, orange } = require('./colors');

/**
 * Local patch (Guild Butler, 2026-09-01) — the writer behind src/storage/dump-window.js.
 *
 * One JSON-lines file per run, opened lazily on the first record, so arming the
 * window and seeing no file is itself an answer ("nothing arrived").
 *
 * Two things this does that a bare JSON.stringify cannot:
 *
 *  - It SURVIVES the payload. Photon's protocol18 decoder yields BigInt for 64-bit
 *    integers and Buffers for byte arrays, and `JSON.stringify` THROWS on the first
 *    BigInt it meets — which would kill the dump on the one packet worth having.
 *  - It POINTS AT THE ANSWER. Give it the numbers you can see on the guild screen
 *    (HIGHLIGHT=1291,5,11) and every record containing one is flagged in the console
 *    as it arrives, so finding the field is reading one line rather than grepping a
 *    file of five thousand.
 */

const MAX_ARRAY = 2000; // generous: the whole point is to catch a ~4-week log in one array
const MAX_DEPTH = 6;
const MAX_STRING = 4000;

const highlights = new Set(
  (process.env.HIGHLIGHT ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
);

let stream = null;
let fileName = null;

const openFile = () => {
  if (stream != null) {
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  fileName = path.resolve(process.cwd(), `guild-dump-${stamp}.jsonl`);
  stream = fs.createWriteStream(fileName, { flags: 'a' });

  console.info(`\n\t${green('DUMPING')} to ${cyan(fileName)}\n`);
};

/** Anything Photon can hand us, rendered as something JSON can hold. */
const plain = (value, depth = 0) => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'bigint') {
    return `bigint:${value.toString()}`; // JSON.stringify throws on these
  }

  if (typeof value === 'string') {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…(+${value.length - MAX_STRING})` : value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Buffer.isBuffer(value)) {
    return { _buffer: value.length, hex: value.subarray(0, 64).toString('hex') };
  }

  if (depth >= MAX_DEPTH) {
    return `…(depth ${depth})`;
  }

  if (ArrayBuffer.isView(value)) {
    return plain(Array.from(value), depth);
  }

  if (Array.isArray(value)) {
    const head = value.slice(0, MAX_ARRAY).map((item) => plain(item, depth + 1));

    return value.length > MAX_ARRAY ? { _array: value.length, truncatedTo: MAX_ARRAY, items: head } : head;
  }

  if (value instanceof Map) {
    return plain(Object.fromEntries(value), depth);
  }

  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item, depth + 1)]));
  }

  return String(value);
};

/** Does this payload contain one of the numbers the operator can see on screen? */
const matchesHighlight = (payload, wanted = highlights) => {
  if (wanted.size === 0) {
    return null;
  }

  const seen = [];
  const walk = (value, depth = 0) => {
    if (depth > MAX_DEPTH || seen.length > 0) {
      return;
    }

    if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'string') {
      if (wanted.has(String(value))) {
        seen.push(String(value));
      }

      return;
    }

    if (value != null && typeof value === 'object') {
      for (const item of Array.isArray(value) ? value : Object.values(value)) {
        walk(item, depth + 1);
      }
    }
  };

  walk(payload);

  return seen.length > 0 ? seen[0] : null;
};

/** A one-line console summary, so the terminal shows the shape as it arrives. */
const summarise = (parameters) => {
  const parts = [];

  for (const [key, value] of Object.entries(parameters)) {
    if (Array.isArray(value)) {
      parts.push(`${key}:array(${value.length})`);
    } else if (typeof value === 'string') {
      parts.push(`${key}:"${value.slice(0, 24)}"`);
    } else if (typeof value === 'number' || typeof value === 'bigint') {
      parts.push(`${key}:${value}`);
    } else if (value != null && typeof value === 'object') {
      parts.push(`${key}:obj`);
    }
  }

  return parts.slice(0, 12).join(' ');
};

/**
 * Write one packet. `kind` is event | request | response; `id` is the event code
 * (parameters[252]) or operation code (parameters[253]), whichever applies.
 */
const write = (kind, id, parameters) => {
  try {
    openFile();

    const payload = plain(parameters);
    const match = matchesHighlight(parameters);

    stream.write(`${JSON.stringify({ at: new Date().toISOString(), kind, id, match, payload })}\n`);

    // Everything is in the file; only the flagged ones are worth a line on screen,
    // otherwise the console is 3000 lines of noise and the signal is in none of them.
    if (match !== null) {
      console.info(`\t${orange('MATCH')} ${kind} id=${id} (${match}) ${summarise(parameters)}`);
    }
  } catch (error) {
    console.error('packet dump failed', error);
  }
};

const close = () => {
  if (stream != null) {
    stream.end();
    stream = null;
  }
};

const currentFileName = () => fileName;

module.exports = { write, close, currentFileName, highlights };

// The serializer and the matcher are the only parts with a wrong answer available,
// so they are reachable from a test without opening a file or a socket.
module.exports.__test = { plain, matchesHighlight };
