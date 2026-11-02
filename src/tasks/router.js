const express = require('express');
const { db, nextId, now } = require('../lib/db');
const { notFound, validation, conflict } = require('../lib/errors');
const { findOr404, paginate, oneOf, optionalIdFilter } = require('../lib/http');
const { isDate } = require('../lib/dates');
const v = require('../lib/validate');
const { renderTask } = require('./serialize');

const STATUSES = ['todo', 'in_progress', 'done'];

const router = express.Router();
const taskNotFound = () => notFound('Task not found');

function readAssignee(b) {
  const assigneeId = v.id(b, 'assigneeId', { nullable: true });
  if (assigneeId && !db.users.some((u) => u.id === assigneeId)) {
    throw validation('assigneeId does not match a user');
  }
  return assigneeId;
}

function readDueDate(b) {
  const dueDate = b.dueDate;
  if (dueDate === undefined || dueDate === null) return dueDate;
  if (!isDate(dueDate)) throw validation('dueDate must be a real calendar date in YYYY-MM-DD format');
  return dueDate;
}

function projectOf(task) {
  return db.projects.find((p) => p.id === task.projectId);
}

function listTasks(req, res, projectId) {
  const status = oneOf(req.query.status, 'status', STATUSES);
  const assigneeId = optionalIdFilter(req.query.assigneeId, 'assigneeId');
  const tagName = req.query.tag;
  const tag = tagName === undefined ? undefined : db.tags.find((t) => t.name === tagName);
  const rows = db.tasks.filter(
    (t) =>
      (projectId === undefined || t.projectId === projectId) &&
      (status === undefined || t.status === status) &&
      (assigneeId === undefined || t.assigneeId === assigneeId) &&
      (tagName === undefined || (tag !== undefined && t.tagIds.includes(tag.id))),
  );
  const page = paginate(rows, req.query);
  res.json({ ...page, items: page.items.map(renderTask) });
}

router.get('/tasks', (req, res) => {
  listTasks(req, res, optionalIdFilter(req.query.projectId, 'projectId'));
});

router.get('/projects/:id/tasks', (req, res) => {
  const project = findOr404(db.projects, req.params.id, notFound('Project not found'));
  listTasks(req, res, project.id);
});

router.get('/tasks/:id', (req, res) => {
  res.json(renderTask(findOr404(db.tasks, req.params.id, taskNotFound())));
});

router.post('/tasks', (req, res) => {
  const b = v.body(req);
  const projectId = v.id(b, 'projectId', { required: true });
  const project = db.projects.find((p) => p.id === projectId);
  if (!project) throw validation('projectId does not match a project');
  const title = v.text(b, 'title', { required: true, max: 120 });
  const status = oneOf(b.status, 'status', STATUSES) ?? 'todo';
  const assigneeId = readAssignee(b) ?? null;
  const dueDate = readDueDate(b) ?? null;
  if (project.status === 'archived') throw conflict('Project is archived');
  const createdAt = now();
  const task = {
    id: nextId('tasks'),
    projectId,
    title,
    status,
    assigneeId,
    dueDate,
    tagIds: [],
    createdAt,
    updatedAt: createdAt,
  };
  db.tasks.push(task);
  res.status(201).json(renderTask(task));
});

// PATCH semantics: a missing field is left alone; assigneeId or dueDate set to null clears it.
router.patch('/tasks/:id', (req, res) => {
  const task = findOr404(db.tasks, req.params.id, taskNotFound());
  const b = v.body(req);
  const title = v.text(b, 'title', { max: 120 });
  const status = oneOf(b.status, 'status', STATUSES);
  const assigneeId = readAssignee(b);
  const dueDate = readDueDate(b);
  if (projectOf(task).status === 'archived') throw conflict('Project is archived');
  if (title !== undefined) task.title = title;
  if (status !== undefined) task.status = status;
  if (assigneeId !== undefined) task.assigneeId = assigneeId;
  if (dueDate !== undefined) task.dueDate = dueDate;
  task.updatedAt = now();
  res.json(renderTask(task));
});

router.delete('/tasks/:id', (req, res) => {
  const task = findOr404(db.tasks, req.params.id, taskNotFound());
  db.comments = db.comments.filter((c) => c.taskId !== task.id);
  db.tasks = db.tasks.filter((t) => t.id !== task.id);
  res.status(204).end();
});

module.exports = router;
