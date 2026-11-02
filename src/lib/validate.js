const { validation } = require('./errors');

function body(req) {
  const b = req.body;
  if (b === undefined) return {};
  if (b === null || typeof b !== 'object' || Array.isArray(b)) {
    throw validation('Request body must be a JSON object');
  }
  return b;
}

// Returns the trimmed string, or undefined when the field is absent and not required.
function text(b, field, { required = false, min = 1, max }) {
  const value = b[field];
  if (value === undefined) {
    if (required) throw validation(`${field} is required`);
    return undefined;
  }
  if (typeof value !== 'string') throw validation(`${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length < min) throw validation(`${field} must not be empty`);
  if (max !== undefined && trimmed.length > max) throw validation(`${field} must be at most ${max} characters`);
  return trimmed;
}

function id(b, field, { required = false, nullable = false } = {}) {
  const value = b[field];
  if (value === undefined) {
    if (required) throw validation(`${field} is required`);
    return undefined;
  }
  if (value === null && nullable) return null;
  if (!Number.isInteger(value) || value < 1) throw validation(`${field} must be a positive whole number`);
  return value;
}

module.exports = { body, text, id };
