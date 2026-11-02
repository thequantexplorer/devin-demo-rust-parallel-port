import { test } from 'node:test';
import assert from 'node:assert/strict';
import { get, expectError, expectOk } from './helpers.mjs';

test('GET /reports/projects/:id/summary counts tasks for a day', async () => {
  assert.deepEqual(expectOk(await get('/reports/projects/1/summary?asOf=2026-03-15')), {
    projectId: 1,
    asOf: '2026-03-15',
    total: 5,
    byStatus: { todo: 3, in_progress: 1, done: 1 },
    overdue: 2,
    unassigned: 1,
    completionPercent: 20,
  });
  assert.deepEqual(expectOk(await get('/reports/projects/3/summary?asOf=2026-03-15')), {
    projectId: 3,
    asOf: '2026-03-15',
    total: 4,
    byStatus: { todo: 2, in_progress: 1, done: 1 },
    overdue: 1,
    unassigned: 0,
    completionPercent: 25,
  });
});

test('a task due on the asOf day is not overdue yet', async () => {
  assert.equal(expectOk(await get('/reports/projects/3/summary?asOf=2026-03-15')).overdue, 1);
  assert.equal(expectOk(await get('/reports/projects/3/summary?asOf=2026-03-16')).overdue, 2);
});

test('the summary works for archived projects too', async () => {
  assert.deepEqual(expectOk(await get('/reports/projects/4/summary?asOf=2026-03-15')), {
    projectId: 4,
    asOf: '2026-03-15',
    total: 2,
    byStatus: { todo: 1, in_progress: 1, done: 0 },
    overdue: 2,
    unassigned: 0,
    completionPercent: 0,
  });
});

test('the summary needs a real asOf date and a real project', async () => {
  expectError(await get('/reports/projects/1/summary'), 400, 'validation_failed', 'missing asOf');
  expectError(await get('/reports/projects/1/summary?asOf=2026-02-30'), 400, 'validation_failed', 'Feb 30');
  expectError(await get('/reports/projects/1/summary?asOf=2026-02-29'), 400, 'validation_failed', 'not a leap year');
  expectError(await get('/reports/projects/1/summary?asOf=15-03-2026'), 400, 'validation_failed', 'wrong format');
  expectError(await get('/reports/projects/99/summary?asOf=2026-03-15'), 404, 'not_found');
});

test('GET /reports/users/:id/workload sums open work on active projects', async () => {
  assert.deepEqual(expectOk(await get('/reports/users/3/workload?asOf=2026-03-15')), {
    userId: 3,
    asOf: '2026-03-15',
    open: 4,
    overdue: 2,
    dueNext7Days: 1,
    byProject: [
      { projectId: 1, projectName: 'Website relaunch', open: 2 },
      { projectId: 2, projectName: 'Mobile app', open: 1 },
      { projectId: 3, projectName: 'Billing v2', open: 1 },
    ],
  });
  assert.deepEqual(expectOk(await get('/reports/users/2/workload?asOf=2026-03-15')), {
    userId: 2,
    asOf: '2026-03-15',
    open: 1,
    overdue: 0,
    dueNext7Days: 1,
    byProject: [{ projectId: 2, projectName: 'Mobile app', open: 1 }],
  });
  assert.deepEqual(expectOk(await get('/reports/users/5/workload?asOf=2026-03-15')), {
    userId: 5,
    asOf: '2026-03-15',
    open: 0,
    overdue: 0,
    dueNext7Days: 0,
    byProject: [],
  });
});

test('dueNext7Days counts tasks due 1 to 7 days after asOf', async () => {
  // Task 16 (Alan) is due 2026-03-21.
  assert.equal(expectOk(await get('/reports/users/3/workload?asOf=2026-03-14')).dueNext7Days, 1, '7 days before');
  assert.equal(expectOk(await get('/reports/users/3/workload?asOf=2026-03-13')).dueNext7Days, 0, '8 days before');
  assert.equal(expectOk(await get('/reports/users/3/workload?asOf=2026-03-21')).dueNext7Days, 0, 'due today');
  // Across a month end: task 11 (Alan) is due 2026-03-30.
  assert.equal(expectOk(await get('/reports/users/3/workload?asOf=2026-03-25')).dueNext7Days, 1);
});

test('the workload needs a real asOf date and a real user', async () => {
  expectError(await get('/reports/users/3/workload'), 400, 'validation_failed');
  expectError(await get('/reports/users/3/workload?asOf=yesterday'), 400, 'validation_failed');
  expectError(await get('/reports/users/99/workload?asOf=2026-03-15'), 404, 'not_found');
});

test('GET /reports/overdue lists late open tasks, latest first', async () => {
  assert.deepEqual(expectOk(await get('/reports/overdue?asOf=2026-03-15')), {
    asOf: '2026-03-15',
    total: 4,
    items: [
      { taskId: 3, title: 'Fix broken footer links', projectId: 1, assigneeId: 3, dueDate: '2026-03-01', daysOverdue: 14 },
      { taskId: 2, title: 'Rewrite the pricing page', projectId: 1, assigneeId: 3, dueDate: '2026-03-10', daysOverdue: 5 },
      { taskId: 12, title: 'Tax rounding bug', projectId: 3, assigneeId: 6, dueDate: '2026-03-12', daysOverdue: 3 },
      { taskId: 8, title: 'Crash on Android 14', projectId: 2, assigneeId: 4, dueDate: '2026-03-14', daysOverdue: 1 },
    ],
  });
  assert.deepEqual(expectOk(await get('/reports/overdue?asOf=2026-03-01')), { asOf: '2026-03-01', total: 0, items: [] });
});

test('daysOverdue is exact across months and sets the order', async () => {
  const report = expectOk(await get('/reports/overdue?asOf=2026-12-31'));
  assert.equal(report.total, 10);
  assert.deepEqual(report.items.slice(0, 2).map((i) => [i.taskId, i.daysOverdue]), [[3, 305], [2, 296]]);
  const late = expectOk(await get('/reports/overdue?asOf=2026-03-23'));
  assert.deepEqual(late.items.map((i) => [i.taskId, i.daysOverdue]), [
    [3, 22], [2, 13], [12, 11], [8, 9], [10, 8], [7, 5], [4, 3], [16, 2], [9, 1],
  ]);
});

test('the overdue report needs a real asOf date', async () => {
  expectError(await get('/reports/overdue'), 400, 'validation_failed');
  expectError(await get('/reports/overdue?asOf=2026-3-15'), 400, 'validation_failed');
});
