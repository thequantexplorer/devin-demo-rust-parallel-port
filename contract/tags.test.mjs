import { test } from 'node:test';
import assert from 'node:assert/strict';
import { get, post, put, del, expectError, expectOk } from './helpers.mjs';

test('GET /tags lists every tag sorted by name, with task counts', async () => {
  assert.deepEqual(expectOk(await get('/tags')), [
    { id: 1, name: 'bug', color: '#d73a4a', taskCount: 3 },
    { id: 5, name: 'design', color: '#c5def5', taskCount: 4 },
    { id: 4, name: 'docs', color: '#0075ca', taskCount: 1 },
    { id: 2, name: 'feature', color: '#0e8a16', taskCount: 5 },
    { id: 3, name: 'urgent', color: '#b60205', taskCount: 2 },
  ]);
});

test('POST /tags creates a tag and lowercases the color', async () => {
  const created = expectOk(await post('/tags', { name: 'backend', color: '#1A2B3C' }), 201);
  assert.deepEqual(created, { id: 6, name: 'backend', color: '#1a2b3c', taskCount: 0 });
  const names = expectOk(await get('/tags')).map((t) => t.name);
  assert.deepEqual(names, ['backend', 'bug', 'design', 'docs', 'feature', 'urgent']);
});

test('POST /tags validates its input and rejects duplicates', async () => {
  const cases = [
    [{ color: '#000000' }, 'missing name'],
    [{ name: 'Bad Name', color: '#000000' }, 'spaces and capitals'],
    [{ name: 'x'.repeat(31), color: '#000000' }, 'name too long'],
    [{ name: 'ok' }, 'missing color'],
    [{ name: 'ok', color: 'red' }, 'color is a word'],
    [{ name: 'ok', color: '#12345' }, 'color too short'],
    [{ name: 'ok', color: '#12345g' }, 'color not hex'],
  ];
  for (const [body, label] of cases) expectError(await post('/tags', body), 400, 'validation_failed', label);
  expectError(await post('/tags', { name: 'bug', color: '#000000' }), 409, 'conflict');
});

test('PUT /tasks/:taskId/tags/:tagId adds a tag once and returns the task', async () => {
  const tagged = expectOk(await put('/tasks/4/tags/1'));
  assert.equal(tagged.id, 4);
  assert.deepEqual(tagged.tagIds, [1]);
  assert.deepEqual(expectOk(await put('/tasks/4/tags/1')).tagIds, [1], 'adding the same tag twice changes nothing');
  assert.deepEqual(expectOk(await put('/tasks/5/tags/1')).tagIds, [1, 4], 'tag ids come back sorted');
  assert.equal(expectOk(await get('/tags')).find((t) => t.name === 'bug').taskCount, 5);
});

test('PUT /tasks/:taskId/tags/:tagId 404s for unknown tasks or tags', async () => {
  expectError(await put('/tasks/99/tags/1'), 404, 'not_found');
  expectError(await put('/tasks/4/tags/99'), 404, 'not_found');
  expectError(await put('/tasks/x/tags/1'), 404, 'not_found');
});

test('DELETE /tasks/:taskId/tags/:tagId removes a tag and is safe to repeat', async () => {
  assert.deepEqual(expectOk(await del('/tasks/3/tags/3')).tagIds, [1]);
  assert.deepEqual(expectOk(await del('/tasks/3/tags/3')).tagIds, [1]);
  expectError(await del('/tasks/3/tags/99'), 404, 'not_found');
  expectError(await del('/tasks/99/tags/1'), 404, 'not_found');
});

test('DELETE /tags/:id deletes the tag and removes it from every task', async () => {
  assert.equal((await del('/tags/5')).status, 204);
  assert.equal(expectOk(await get('/tags')).some((t) => t.id === 5), false);
  expectError(await del('/tags/5'), 404, 'not_found');
  expectError(await put('/tasks/1/tags/5'), 404, 'not_found');
  assert.deepEqual(expectOk(await put('/tasks/16/tags/2')).tagIds, [2], 'task 16 no longer has tag 5');
});
