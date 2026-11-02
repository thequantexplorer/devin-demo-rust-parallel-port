// Behaviour the shared crate skeleton owns: health check and unknown routes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { get, expectError, expectOk } from './helpers.mjs';

test('GET /health returns ok', async () => {
  assert.deepEqual(expectOk(await get('/health')), { status: 'ok' });
});

test('an unknown route is a JSON 404 with code not_found', async () => {
  expectError(await get('/does-not-exist'), 404, 'not_found');
  expectError(await get('/health/extra/segments'), 404, 'not_found');
});
