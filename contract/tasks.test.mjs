import { test } from 'node:test';
import assert from 'node:assert/strict';
import { get, post, patch, del, expectError, expectOk, withoutTimestamps, ids } from './helpers.mjs';

const FOOTER = {
  id: 3,
  projectId: 1,
  title: 'Fix broken footer links',
  status: 'todo',
  assigneeId: 3,
  dueDate: '2026-03-01',
  tagIds: [1, 3],
  createdAt: '2026-01-11T09:20:00.000Z',
  updatedAt: '2026-01-11T09:20:00.000Z',
};

test('GET /tasks lists tasks with tag ids sorted', async () => {
  const page = expectOk(await get('/tasks'));
  assert.deepEqual(ids(page), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  assert.deepEqual({ total: page.total, limit: page.limit, offset: page.offset }, { total: 16, limit: 20, offset: 0 });
  assert.deepEqual(page.items[2], FOOTER);
  assert.deepEqual(ids(expectOk(await get('/tasks?limit=5&offset=10'))), [11, 12, 13, 14, 15]);
});

test('GET /tasks filters by status, project, assignee and tag name', async () => {
  assert.deepEqual(ids(expectOk(await get('/tasks?status=in_progress'))), [2, 7, 10, 15]);
  assert.deepEqual(ids(expectOk(await get('/tasks?projectId=2'))), [6, 7, 8, 9, 16]);
  assert.deepEqual(ids(expectOk(await get('/tasks?assigneeId=3'))), [2, 3, 11, 14, 16]);
  assert.deepEqual(ids(expectOk(await get('/tasks?tag=design'))), [1, 9, 11, 16]);
  assert.deepEqual(ids(expectOk(await get('/tasks?projectId=2&tag=feature'))), [6, 7, 16]);
  assert.deepEqual(ids(expectOk(await get('/tasks?status=todo&assigneeId=3'))), [3, 11, 14, 16]);
  const none = expectOk(await get('/tasks?tag=no-such-tag'));
  assert.deepEqual(none.items, []);
  assert.equal(none.total, 0);
});

test('GET /tasks rejects bad filters', async () => {
  expectError(await get('/tasks?status=blocked'), 400, 'validation_failed');
  expectError(await get('/tasks?projectId=abc'), 400, 'validation_failed');
  expectError(await get('/tasks?assigneeId=0'), 400, 'validation_failed');
  expectError(await get('/tasks?limit=-5'), 400, 'validation_failed');
});

test('GET /projects/:id/tasks lists one project\'s tasks', async () => {
  assert.deepEqual(ids(expectOk(await get('/projects/2/tasks'))), [6, 7, 8, 9, 16]);
  assert.deepEqual(ids(expectOk(await get('/projects/2/tasks?status=todo'))), [8, 9, 16]);
  assert.deepEqual(ids(expectOk(await get('/projects/4/tasks'))), [14, 15]);
  expectError(await get('/projects/99/tasks'), 404, 'not_found');
  expectError(await get('/projects/abc/tasks'), 404, 'not_found');
});

test('GET /tasks/:id returns one task, or 404', async () => {
  assert.deepEqual(expectOk(await get('/tasks/3')), FOOTER);
  expectError(await get('/tasks/99'), 404, 'not_found');
  expectError(await get('/tasks/1e3'), 404, 'not_found');
});

test('POST /tasks creates a task', async () => {
  const created = expectOk(await post('/tasks', { projectId: 3, title: ' Refund flow ', assigneeId: 4, dueDate: '2026-04-01' }), 201);
  assert.equal(created.createdAt, created.updatedAt, 'a new task has updatedAt equal to createdAt');
  assert.deepEqual(withoutTimestamps(created, 'createdAt', 'updatedAt'), {
    id: 17,
    projectId: 3,
    title: 'Refund flow',
    status: 'todo',
    assigneeId: 4,
    dueDate: '2026-04-01',
    tagIds: [],
  });
  assert.deepEqual(expectOk(await get('/tasks/17')), created);
  const minimal = expectOk(await post('/tasks', { projectId: 1, title: 'Minimal', status: 'in_progress' }), 201);
  assert.deepEqual(
    { id: minimal.id, status: minimal.status, assigneeId: minimal.assigneeId, dueDate: minimal.dueDate },
    { id: 18, status: 'in_progress', assigneeId: null, dueDate: null },
  );
  const leapDay = expectOk(await post('/tasks', { projectId: 1, title: 'Leap day', dueDate: '2028-02-29', assigneeId: null }), 201);
  assert.equal(leapDay.dueDate, '2028-02-29');
});

test('POST /tasks validates its input', async () => {
  const cases = [
    [{ title: 'X' }, 'missing projectId'],
    [{ projectId: 99, title: 'X' }, 'projectId does not exist'],
    [{ projectId: 1 }, 'missing title'],
    [{ projectId: 1, title: 'x'.repeat(121) }, 'title too long'],
    [{ projectId: 1, title: 'X', status: 'blocked' }, 'bad status'],
    [{ projectId: 1, title: 'X', assigneeId: 99 }, 'assignee does not exist'],
    [{ projectId: 1, title: 'X', dueDate: '2026-02-30' }, 'not a real date'],
    [{ projectId: 1, title: 'X', dueDate: '2026-02-29' }, '2026 is not a leap year'],
    [{ projectId: 1, title: 'X', dueDate: '03/01/2026' }, 'wrong date format'],
    [{ projectId: 1, title: 'X', dueDate: 20260301 }, 'date is a number'],
  ];
  for (const [body, label] of cases) expectError(await post('/tasks', body), 400, 'validation_failed', label);
});

test('POST /tasks refuses archived projects', async () => {
  expectError(await post('/tasks', { projectId: 4, title: 'Too late' }), 409, 'conflict');
});

test('PATCH /tasks/:id updates fields and bumps updatedAt', async () => {
  const before = expectOk(await get('/tasks/4'));
  const updated = expectOk(await patch('/tasks/4', { status: 'in_progress', assigneeId: 2 }));
  assert.match(updated.updatedAt, /Z$/);
  assert.notEqual(updated.updatedAt, before.updatedAt);
  assert.deepEqual(
    { ...updated, updatedAt: undefined },
    { ...before, status: 'in_progress', assigneeId: 2, updatedAt: undefined },
  );
});

test('PATCH /tasks/:id leaves missing fields alone and clears fields set to null', async () => {
  const renamed = expectOk(await patch('/tasks/5', { title: 'Write the launch post' }));
  assert.equal(renamed.title, 'Write the launch post');
  assert.equal(renamed.assigneeId, 4);
  assert.equal(renamed.dueDate, null);
  const cleared = expectOk(await patch('/tasks/2', { assigneeId: null, dueDate: null }));
  assert.equal(cleared.assigneeId, null);
  assert.equal(cleared.dueDate, null);
  assert.equal(cleared.status, 'in_progress');
  assert.deepEqual(expectOk(await get('/tasks/2')), cleared);
});

test('PATCH /tasks/:id refuses archived projects, bad input and unknown ids', async () => {
  expectError(await patch('/tasks/14', { status: 'done' }), 409, 'conflict');
  expectError(await patch('/tasks/1', { status: 'blocked' }), 400, 'validation_failed');
  expectError(await patch('/tasks/1', { title: '' }), 400, 'validation_failed');
  expectError(await patch('/tasks/1', { assigneeId: 'grace' }), 400, 'validation_failed');
  expectError(await patch('/tasks/1', { dueDate: '2026-13-01' }), 400, 'validation_failed');
  expectError(await patch('/tasks/99', { title: 'X' }), 404, 'not_found');
});

test('DELETE /tasks/:id removes the task', async () => {
  assert.equal((await del('/tasks/9')).status, 204);
  expectError(await get('/tasks/9'), 404, 'not_found');
  expectError(await del('/tasks/9'), 404, 'not_found');
  assert.deepEqual(ids(expectOk(await get('/projects/2/tasks'))), [6, 7, 8, 16]);
});
