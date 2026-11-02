import { test } from 'node:test';
import assert from 'node:assert/strict';
import { get, post, patch, del, expectError, expectOk, withoutTimestamps, ids } from './helpers.mjs';

const ADA = { id: 1, name: 'Ada Lovelace', email: 'ada@acme.test', role: 'admin', createdAt: '2026-01-05T09:00:00.000Z' };
const ALAN = { id: 3, name: 'Alan Turing', email: 'alan@acme.test', role: 'member', createdAt: '2026-01-06T10:00:00.000Z' };

test('GET /users lists users by id with the page envelope', async () => {
  const page = expectOk(await get('/users'));
  assert.deepEqual(Object.keys(page).sort(), ['items', 'limit', 'offset', 'total']);
  assert.deepEqual(ids(page), [1, 2, 3, 4, 5, 6]);
  assert.equal(page.total, 6);
  assert.equal(page.limit, 20);
  assert.equal(page.offset, 0);
  assert.deepEqual(page.items[0], ADA);
});

test('GET /users supports limit and offset', async () => {
  const page = expectOk(await get('/users?limit=2&offset=2'));
  assert.deepEqual(ids(page), [3, 4]);
  assert.deepEqual({ total: page.total, limit: page.limit, offset: page.offset }, { total: 6, limit: 2, offset: 2 });
  const past = expectOk(await get('/users?offset=10'));
  assert.deepEqual(past.items, []);
  assert.equal(past.total, 6);
});

test('GET /users rejects bad paging values', async () => {
  for (const q of ['limit=0', 'limit=101', 'limit=abc', 'limit=2.5', 'offset=-1', 'offset=x']) {
    expectError(await get(`/users?${q}`), 400, 'validation_failed', q);
  }
  assert.equal(expectOk(await get('/users?limit=100')).limit, 100);
});

test('GET /users filters by role', async () => {
  assert.deepEqual(ids(expectOk(await get('/users?role=admin'))), [1, 6]);
  assert.equal(expectOk(await get('/users?role=member')).total, 4);
  expectError(await get('/users?role=owner'), 400, 'validation_failed');
});

test('GET /users/:id returns one user, or 404', async () => {
  assert.deepEqual(expectOk(await get('/users/3')), ALAN);
  expectError(await get('/users/999'), 404, 'not_found');
  expectError(await get('/users/abc'), 404, 'not_found', 'non-numeric id');
  expectError(await get('/users/0'), 404, 'not_found', 'zero id');
});

test('POST /users trims the name, lowercases the email and defaults the role', async () => {
  const created = expectOk(await post('/users', { name: '  Barbara Liskov ', email: 'Barbara@Acme.TEST' }), 201);
  assert.deepEqual(withoutTimestamps(created, 'createdAt'), { id: 7, name: 'Barbara Liskov', email: 'barbara@acme.test', role: 'member' });
  assert.deepEqual(expectOk(await get('/users/7')), created);
  const admin = expectOk(await post('/users', { name: 'Edsger Dijkstra', email: 'edsger@acme.test', role: 'admin', extra: 'ignored' }), 201);
  assert.equal(admin.id, 8);
  assert.equal(admin.role, 'admin');
  assert.equal('extra' in admin, false);
});

test('POST /users validates its input', async () => {
  const cases = [
    [{ email: 'x@acme.test' }, 'missing name'],
    [{ name: '   ', email: 'x@acme.test' }, 'blank name'],
    [{ name: 42, email: 'x@acme.test' }, 'name is a number'],
    [{ name: 'x'.repeat(81), email: 'x@acme.test' }, 'name too long'],
    [{ name: 'X' }, 'missing email'],
    [{ name: 'X', email: 'not-an-email' }, 'bad email'],
    [{ name: 'X', email: 'x@acme.test', role: 'owner' }, 'bad role'],
  ];
  for (const [body, label] of cases) expectError(await post('/users', body), 400, 'validation_failed', label);
});

test('POST /users rejects a duplicate email, ignoring case', async () => {
  expectError(await post('/users', { name: 'Imposter', email: 'ADA@acme.test' }), 409, 'conflict');
});

test('PATCH /users/:id updates only the given fields', async () => {
  const updated = expectOk(await patch('/users/2', { role: 'admin' }));
  assert.deepEqual(updated, { id: 2, name: 'Grace Hopper', email: 'grace@acme.test', role: 'admin', createdAt: '2026-01-05T09:05:00.000Z' });
  const renamed = expectOk(await patch('/users/2', { name: ' Rear Admiral Hopper ', email: 'GRACE@acme.test' }));
  assert.equal(renamed.name, 'Rear Admiral Hopper');
  assert.equal(renamed.email, 'grace@acme.test');
  assert.deepEqual(expectOk(await get('/users/2')), renamed);
});

test('PATCH /users/:id validates, checks email conflicts and 404s', async () => {
  expectError(await patch('/users/2', { email: 'alan@acme.test' }), 409, 'conflict');
  expectError(await patch('/users/2', { name: '' }), 400, 'validation_failed');
  expectError(await patch('/users/2', { role: 'root' }), 400, 'validation_failed');
  expectError(await patch('/users/999', { name: 'Nobody' }), 404, 'not_found');
});

test('DELETE /users/:id refuses owners and people with open tasks', async () => {
  expectError(await del('/users/1'), 409, 'conflict', 'owns projects');
  expectError(await del('/users/4'), 409, 'conflict', 'has open tasks');
  assert.equal((await del('/users/5')).status, 204);
  expectError(await get('/users/5'), 404, 'not_found');
  expectError(await del('/users/5'), 404, 'not_found');
});
