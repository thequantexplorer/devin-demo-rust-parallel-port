import { test } from 'node:test';
import assert from 'node:assert/strict';
import { get, post, patch, del, expectError, expectOk, withoutTimestamps, ids } from './helpers.mjs';

const CRASH_COMMENTS = [
  { id: 3, taskId: 8, authorId: 4, body: 'Repro on a Pixel 8. Stack trace attached.', createdAt: '2026-03-13T16:00:00.000Z', editedAt: null },
  { id: 4, taskId: 8, authorId: 2, body: 'Looks like the new image cache.', createdAt: '2026-03-14T08:15:00.000Z', editedAt: '2026-03-14T08:20:00.000Z' },
];

test('GET /tasks/:id/comments lists a task\'s comments', async () => {
  const page = expectOk(await get('/tasks/8/comments'));
  assert.deepEqual(page, { items: CRASH_COMMENTS, total: 2, limit: 20, offset: 0 });
  assert.deepEqual(expectOk(await get('/tasks/8/comments?limit=1&offset=1')), { items: [CRASH_COMMENTS[1]], total: 2, limit: 1, offset: 1 });
  assert.deepEqual(expectOk(await get('/tasks/4/comments')), { items: [], total: 0, limit: 20, offset: 0 });
});

test('GET /tasks/:id/comments 404s for unknown tasks and rejects bad paging', async () => {
  expectError(await get('/tasks/99/comments'), 404, 'not_found');
  expectError(await get('/tasks/abc/comments'), 404, 'not_found');
  expectError(await get('/tasks/8/comments?limit=0'), 400, 'validation_failed');
});

test('POST /tasks/:id/comments adds a comment', async () => {
  const created = expectOk(await post('/tasks/4/comments', { authorId: 5, body: '  Starting today. ' }), 201);
  assert.deepEqual(withoutTimestamps(created, 'createdAt'), { id: 9, taskId: 4, authorId: 5, body: 'Starting today.', editedAt: null });
  assert.deepEqual(expectOk(await get('/tasks/4/comments')).items, [created]);
});

test('POST /tasks/:id/comments validates its input', async () => {
  const cases = [
    [{ body: 'Hi' }, 'missing authorId'],
    [{ authorId: 99, body: 'Hi' }, 'author does not exist'],
    [{ authorId: '1', body: 'Hi' }, 'authorId is a string'],
    [{ authorId: 1 }, 'missing body'],
    [{ authorId: 1, body: '   ' }, 'blank body'],
    [{ authorId: 1, body: 'x'.repeat(2001) }, 'body too long'],
  ];
  for (const [body, label] of cases) expectError(await post('/tasks/4/comments', body), 400, 'validation_failed', label);
  expectError(await post('/tasks/99/comments', { authorId: 1, body: 'Hi' }), 404, 'not_found');
  expectOk(await post('/tasks/4/comments', { authorId: 1, body: 'x'.repeat(2000) }), 201);
});

test('PATCH /comments/:id edits the body and sets editedAt', async () => {
  const edited = expectOk(await patch('/comments/1', { body: 'Fixed in staging.' }));
  assert.deepEqual(withoutTimestamps(edited, 'editedAt'), {
    id: 1,
    taskId: 3,
    authorId: 1,
    body: 'Fixed in staging.',
    createdAt: '2026-03-02T09:00:00.000Z',
  });
  expectError(await patch('/comments/1', {}), 400, 'validation_failed');
  expectError(await patch('/comments/1', { body: '' }), 400, 'validation_failed');
  expectError(await patch('/comments/99', { body: 'X' }), 404, 'not_found');
});

test('DELETE /comments/:id removes the comment', async () => {
  assert.equal((await del('/comments/2')).status, 204);
  expectError(await del('/comments/2'), 404, 'not_found');
  expectError(await patch('/comments/2', { body: 'X' }), 404, 'not_found');
  assert.deepEqual(ids(expectOk(await get('/tasks/3/comments'))), [1]);
});
