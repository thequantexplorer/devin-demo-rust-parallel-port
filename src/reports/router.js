const express = require('express');
const { db } = require('../lib/db');
const { notFound, validation } = require('../lib/errors');
const { findOr404 } = require('../lib/http');
const { isDate, daysBetween } = require('../lib/dates');

const router = express.Router();

// Reports never read the clock. The caller passes the day to report on as ?asOf=YYYY-MM-DD.
function readAsOf(query) {
  if (query.asOf === undefined) throw validation('asOf is required');
  if (!isDate(query.asOf)) throw validation('asOf must be a real calendar date in YYYY-MM-DD format');
  return query.asOf;
}

const isOpen = (task) => task.status !== 'done';
const isOverdue = (task, asOf) => isOpen(task) && task.dueDate !== null && task.dueDate < asOf;
const activeProjectIds = () => new Set(db.projects.filter((p) => p.status === 'active').map((p) => p.id));

router.get('/reports/projects/:id/summary', (req, res) => {
  const project = findOr404(db.projects, req.params.id, notFound('Project not found'));
  const asOf = readAsOf(req.query);
  const tasks = db.tasks.filter((t) => t.projectId === project.id);
  const byStatus = { todo: 0, in_progress: 0, done: 0 };
  for (const t of tasks) byStatus[t.status] += 1;
  res.json({
    projectId: project.id,
    asOf,
    total: tasks.length,
    byStatus,
    overdue: tasks.filter((t) => isOverdue(t, asOf)).length,
    unassigned: tasks.filter((t) => isOpen(t) && t.assigneeId === null).length,
    completionPercent: tasks.length === 0 ? 0 : Math.round((byStatus.done / tasks.length) * 100),
  });
});

// Archived projects are left out of workload and overdue reports.
router.get('/reports/users/:id/workload', (req, res) => {
  const user = findOr404(db.users, req.params.id, notFound('User not found'));
  const asOf = readAsOf(req.query);
  const active = activeProjectIds();
  const open = db.tasks.filter((t) => t.assigneeId === user.id && isOpen(t) && active.has(t.projectId));
  const perProject = new Map();
  for (const t of open) perProject.set(t.projectId, (perProject.get(t.projectId) ?? 0) + 1);
  const byProject = [...perProject.entries()]
    .sort(([a], [b]) => a - b)
    .map(([projectId, count]) => ({
      projectId,
      projectName: db.projects.find((p) => p.id === projectId).name,
      open: count,
    }));
  res.json({
    userId: user.id,
    asOf,
    open: open.length,
    overdue: open.filter((t) => isOverdue(t, asOf)).length,
    dueNext7Days: open.filter((t) => {
      if (t.dueDate === null) return false;
      const days = daysBetween(asOf, t.dueDate);
      return days >= 1 && days <= 7;
    }).length,
    byProject,
  });
});

router.get('/reports/overdue', (req, res) => {
  const asOf = readAsOf(req.query);
  const active = activeProjectIds();
  const items = db.tasks
    .filter((t) => active.has(t.projectId) && isOverdue(t, asOf))
    .map((t) => ({
      taskId: t.id,
      title: t.title,
      projectId: t.projectId,
      assigneeId: t.assigneeId,
      dueDate: t.dueDate,
      daysOverdue: daysBetween(t.dueDate, asOf),
    }))
    .sort((a, b) => b.daysOverdue - a.daysOverdue || a.taskId - b.taskId);
  res.json({ asOf, total: items.length, items });
});

module.exports = router;
