// Behaviour that spans domains: cascades and reports over data created through
// other routes. This file can only pass once every domain is in place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, get, post, patch, put, del, expectError, expectOk, ids } from './helpers.mjs';

test('a user with open tasks cannot be deleted', async () => {
  expectError(await del('/users/4'), 409, 'conflict');
});

test('a new project with 2 of 3 tasks done reports 67% complete', async () => {
  const project = expectOk(await post('/projects', { name: 'Rounding check', ownerId: 6 }), 201);
  const made = [];
  for (const title of ['One', 'Two', 'Three']) {
    made.push(expectOk(await post('/tasks', { projectId: project.id, title }), 201));
  }
  await patch(`/tasks/${made[0].id}`, { status: 'done' });
  await patch(`/tasks/${made[1].id}`, { status: 'done' });
  const summary = expectOk(await get(`/reports/projects/${project.id}/summary?asOf=2026-03-15`));
  assert.equal(summary.completionPercent, 67);
  assert.deepEqual(summary.byStatus, { todo: 1, in_progress: 0, done: 2 });
});

test('tagging a task shows up in task filters and tag counts', async () => {
  expectOk(await put('/tasks/13/tags/4'));
  assert.deepEqual(ids(expectOk(await get('/tasks?tag=docs'))), [5, 13]);
  assert.equal(expectOk(await get('/tags')).find((t) => t.name === 'docs').taskCount, 2);
});

test('deleting a tag removes it from tasks', async () => {
  assert.equal((await del('/tags/1')).status, 204);
  assert.deepEqual(expectOk(await get('/tasks/12')).tagIds, []);
  assert.deepEqual(expectOk(await get('/tasks/3')).tagIds, [3]);
});

test('deleting a task deletes its comments', async () => {
  assert.equal((await del('/tasks/8')).status, 204);
  expectError(await patch('/comments/3', { body: 'X' }), 404, 'not_found');
  expectError(await get('/tasks/8/comments'), 404, 'not_found');
});

test('deleting a project deletes its tasks and their comments', async () => {
  assert.equal((await del('/projects/1')).status, 204);
  assert.equal(expectOk(await get('/tasks?projectId=1')).total, 0);
  expectError(await get('/tasks/3'), 404, 'not_found');
  expectError(await patch('/comments/1', { body: 'X' }), 404, 'not_found');
  expectError(await get('/projects/1/tasks'), 404, 'not_found');
});

test('a user can be deleted once their open tasks are gone', async () => {
  // Task 5 went with project 1 and task 8 was deleted above. Task 13 is done.
  assert.equal((await del('/users/4')).status, 204);
  expectError(await get('/users/4'), 404, 'not_found');
});

test('archiving a project blocks new tasks and drops it from reports', async () => {
  expectOk(await post('/projects/2/archive'));
  expectError(await post('/tasks', { projectId: 2, title: 'Late idea' }), 409, 'conflict');
  const overdue = expectOk(await get('/reports/overdue?asOf=2026-03-25'));
  assert.equal(overdue.items.some((i) => i.projectId === 2), false);
  const alan = expectOk(await get('/reports/users/3/workload?asOf=2026-03-15'));
  assert.deepEqual(alan.byProject, [{ projectId: 3, projectName: 'Billing v2', open: 1 }]);
});

test('a new user has an empty workload', async () => {
  const user = expectOk(await post('/users', { name: 'New Hire', email: 'new@acme.test' }), 201);
  const report = expectOk(await get(`/reports/users/${user.id}/workload?asOf=2026-03-15`));
  assert.deepEqual(report, { userId: user.id, asOf: '2026-03-15', open: 0, overdue: 0, dueNext7Days: 0, byProject: [] });
});

test('a malformed JSON body is a 400 with code invalid_json', async () => {
  expectError(await api('POST', '/users', undefined, { raw: '{"name": "Ada",' }), 400, 'invalid_json', 'POST /users');
  expectError(await api('POST', '/projects', undefined, { raw: 'not json' }), 400, 'invalid_json', 'POST /projects');
  expectError(await api('PATCH', '/tasks/1', undefined, { raw: '{' }), 400, 'invalid_json', 'PATCH /tasks/1');
});
