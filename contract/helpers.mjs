// Shared helpers for the HTTP contract tests. The tests only talk HTTP, so they
// run unchanged against any server that listens on BASE_URL.
import assert from 'node:assert/strict';

export const BASE_URL = (process.env.BASE_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');

export const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;

/**
 * Sends a request and returns { status, body }.
 * `body` is parsed JSON, or null for an empty response.
 * Pass `raw` to send a string body as-is (for malformed JSON tests).
 */
export async function api(method, path, body, { raw } = {}) {
  const init = { method, headers: {} };
  if (raw !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = raw;
  } else if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE_URL}${path}`, init);
  const text = await res.text();
  if (res.status === 204) {
    assert.equal(text, '', `${method} ${path}: a 204 response must have an empty body`);
    return { status: 204, body: null };
  }
  const type = res.headers.get('content-type') ?? '';
  assert.ok(type.startsWith('application/json'), `${method} ${path}: expected a JSON response, got content-type "${type}" and body: ${text.slice(0, 200)}`);
  return { status: res.status, body: JSON.parse(text) };
}

export const get = (path) => api('GET', path);
export const post = (path, body) => api('POST', path, body);
export const patch = (path, body) => api('PATCH', path, body);
export const put = (path, body) => api('PUT', path, body);
export const del = (path) => api('DELETE', path);

/** Asserts the standard error shape: { "error": { "code": "...", "message": "..." } }. */
export function expectError(res, status, code, label = '') {
  assert.equal(res.status, status, `${label} expected HTTP ${status}, got ${res.status}: ${JSON.stringify(res.body)}`);
  assert.deepEqual(Object.keys(res.body), ['error'], `${label} error body must only have an "error" key`);
  assert.deepEqual(Object.keys(res.body.error).sort(), ['code', 'message'], `${label} error must have exactly "code" and "message"`);
  assert.equal(res.body.error.code, code, `${label} error code`);
  assert.equal(typeof res.body.error.message, 'string');
}

export function expectOk(res, status = 200) {
  assert.equal(res.status, status, `expected HTTP ${status}, got ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body;
}

/** Asserts a field is an ISO-8601 UTC timestamp like 2026-03-01T09:00:00.000Z and returns the object without it. */
export function withoutTimestamps(obj, ...fields) {
  const rest = { ...obj };
  for (const field of fields) {
    assert.match(String(obj[field]), ISO_TIMESTAMP, `${field} must be an ISO-8601 UTC timestamp ending in Z`);
    delete rest[field];
  }
  return rest;
}

export const ids = (page) => page.items.map((item) => item.id);
