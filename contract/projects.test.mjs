import { test } from 'node:test';
import assert from 'node:assert/strict';
import { get, post, patch, del, expectError, expectOk, withoutTimestamps, ids } from './helpers.mjs';

const MOBILE = {
  id: 2,
  name: 'Mobile app',
  description: 'iOS and Android app, first public release.',
  ownerId: 2,
  status: 'active',
  createdAt: '2026-01-12T09:00:00.000Z',
};

test('GET /projects lists and filters projects', async () => {
  const page = expectOk(await get('/projects'));
  assert.deepEqual(ids(page), [1, 2, 3, 4]);
  assert.deepEqual({ total: page.total, limit: page.limit, offset: page.offset }, { total: 4, limit: 20, offset: 0 });
  assert.deepEqual(page.items[1], MOBILE);
  assert.deepEqual(ids(expectOk(await get('/projects?status=active'))), [1, 2, 3]);
  assert.deepEqual(ids(expectOk(await get('/projects?status=archived'))), [4]);
  assert.deepEqual(ids(expectOk(await get('/projects?ownerId=1'))), [1, 4]);
  assert.deepEqual(ids(expectOk(await get('/projects?ownerId=1&status=active'))), [1]);
  assert.deepEqual(ids(expectOk(await get('/projects?limit=1&offset=3'))), [4]);
});

test('GET /projects rejects bad filters', async () => {
  expectError(await get('/projects?status=deleted'), 400, 'validation_failed');
  expectError(await get('/projects?ownerId=abc'), 400, 'validation_failed');
  expectError(await get('/projects?limit=500'), 400, 'validation_failed');
});

test('GET /projects/:id returns one project, or 404', async () => {
  assert.deepEqual(expectOk(await get('/projects/2')), MOBILE);
  expectError(await get('/projects/99'), 404, 'not_found');
  expectError(await get('/projects/x'), 404, 'not_found');
});

test('POST /projects creates an active project', async () => {
  const created = expectOk(await post('/projects', { name: ' Docs site ', ownerId: 3 }), 201);
  assert.deepEqual(withoutTimestamps(created, 'createdAt'), { id: 5, name: 'Docs site', description: '', ownerId: 3, status: 'active' });
  assert.deepEqual(expectOk(await get('/projects/5')), created);
  const withDescription = expectOk(await post('/projects', { name: 'Status page', description: 'Public uptime page.', ownerId: 1 }), 201);
  assert.equal(withDescription.id, 6);
  assert.equal(withDescription.description, 'Public uptime page.');
});

test('POST /projects validates its input', async () => {
  const cases = [
    [{ ownerId: 1 }, 'missing name'],
    [{ name: '', ownerId: 1 }, 'empty name'],
    [{ name: 'x'.repeat(81), ownerId: 1 }, 'name too long'],
    [{ name: 'X' }, 'missing ownerId'],
    [{ name: 'X', ownerId: '1' }, 'ownerId is a string'],
    [{ name: 'X', ownerId: 99 }, 'ownerId does not exist'],
    [{ name: 'X', ownerId: 1, description: 7 }, 'description is a number'],
  ];
  for (const [body, label] of cases) expectError(await post('/projects', body), 400, 'validation_failed', label);
});

test('PATCH /projects/:id updates name and description', async () => {
  const updated = expectOk(await patch('/projects/1', { description: 'Ship by April.' }));
  assert.equal(updated.description, 'Ship by April.');
  assert.equal(updated.name, 'Website relaunch');
  const cleared = expectOk(await patch('/projects/1', { name: 'Website v2', description: '' }));
  assert.equal(cleared.name, 'Website v2');
  assert.equal(cleared.description, '');
  assert.deepEqual(expectOk(await get('/projects/1')), cleared);
});

test('PATCH /projects/:id refuses archived projects and bad input', async () => {
  expectError(await patch('/projects/4', { name: 'Revive' }), 409, 'conflict');
  expectError(await patch('/projects/1', { name: '  ' }), 400, 'validation_failed');
  expectError(await patch('/projects/99', { name: 'X' }), 404, 'not_found');
});

test('POST /projects/:id/archive archives once', async () => {
  const archived = expectOk(await post('/projects/2/archive'));
  assert.deepEqual(archived, { ...MOBILE, status: 'archived' });
  expectError(await post('/projects/2/archive'), 409, 'conflict');
  expectError(await post('/projects/99/archive'), 404, 'not_found');
  assert.deepEqual(ids(expectOk(await get('/projects?status=archived'))), [2, 4]);
});

test('DELETE /projects/:id removes the project', async () => {
  assert.equal((await del('/projects/3')).status, 204);
  expectError(await get('/projects/3'), 404, 'not_found');
  expectError(await del('/projects/3'), 404, 'not_found');
  assert.equal(expectOk(await get('/projects')).total, 5);
});
