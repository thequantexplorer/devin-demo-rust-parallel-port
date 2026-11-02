const { validation } = require('./errors');

// Path ids are positive integers. Anything else ("abc", "1.5", "-2") matches no
// record, so it is a 404, not a 400.
function parseId(raw) {
  return /^[1-9][0-9]*$/.test(raw) ? Number(raw) : null;
}

function findOr404(rows, rawId, notFoundError) {
  const id = parseId(rawId);
  const row = id === null ? undefined : rows.find((r) => r.id === id);
  if (!row) throw notFoundError;
  return row;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function readPage(query) {
  const limit = readInt(query.limit, 'limit', DEFAULT_LIMIT);
  const offset = readInt(query.offset, 'offset', 0);
  if (limit < 1 || limit > MAX_LIMIT) throw validation(`limit must be between 1 and ${MAX_LIMIT}`);
  return { limit, offset };
}

function readInt(raw, name, fallback) {
  if (raw === undefined) return fallback;
  if (typeof raw !== 'string' || !/^[0-9]+$/.test(raw)) {
    throw validation(`${name} must be a whole number`);
  }
  return Number(raw);
}

// Every list endpoint returns the same envelope.
function paginate(rows, query) {
  const { limit, offset } = readPage(query);
  return { items: rows.slice(offset, offset + limit), total: rows.length, limit, offset };
}

function oneOf(raw, name, allowed) {
  if (raw === undefined) return undefined;
  if (!allowed.includes(raw)) throw validation(`${name} must be one of: ${allowed.join(', ')}`);
  return raw;
}

function optionalIdFilter(raw, name) {
  if (raw === undefined) return undefined;
  const id = parseId(raw);
  if (id === null) throw validation(`${name} must be a positive whole number`);
  return id;
}

module.exports = { parseId, findOr404, paginate, oneOf, optionalIdFilter };
