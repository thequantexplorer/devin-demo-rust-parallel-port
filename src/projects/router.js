const express = require('express');
const { db, nextId, now } = require('../lib/db');
const { notFound, validation, conflict } = require('../lib/errors');
const { findOr404, paginate, oneOf, optionalIdFilter } = require('../lib/http');
const v = require('../lib/validate');

const STATUSES = ['active', 'archived'];

const router = express.Router();
const projectNotFound = () => notFound('Project not found');

function assertActive(project) {
  if (project.status === 'archived') throw conflict('Project is archived');
}

router.get('/projects', (req, res) => {
  const status = oneOf(req.query.status, 'status', STATUSES);
  const ownerId = optionalIdFilter(req.query.ownerId, 'ownerId');
  const rows = db.projects.filter(
    (p) => (status === undefined || p.status === status) && (ownerId === undefined || p.ownerId === ownerId),
  );
  res.json(paginate(rows, req.query));
});

router.get('/projects/:id', (req, res) => {
  res.json(findOr404(db.projects, req.params.id, projectNotFound()));
});

router.post('/projects', (req, res) => {
  const b = v.body(req);
  const name = v.text(b, 'name', { required: true, max: 80 });
  const description = v.text(b, 'description', { min: 0, max: 500 }) ?? '';
  const ownerId = v.id(b, 'ownerId', { required: true });
  if (!db.users.some((u) => u.id === ownerId)) throw validation('ownerId does not match a user');
  const project = { id: nextId('projects'), name, description, ownerId, status: 'active', createdAt: now() };
  db.projects.push(project);
  res.status(201).json(project);
});

router.patch('/projects/:id', (req, res) => {
  const project = findOr404(db.projects, req.params.id, projectNotFound());
  assertActive(project);
  const b = v.body(req);
  const name = v.text(b, 'name', { max: 80 });
  const description = v.text(b, 'description', { min: 0, max: 500 });
  if (name !== undefined) project.name = name;
  if (description !== undefined) project.description = description;
  res.json(project);
});

router.post('/projects/:id/archive', (req, res) => {
  const project = findOr404(db.projects, req.params.id, projectNotFound());
  assertActive(project);
  project.status = 'archived';
  res.json(project);
});

// Deleting a project also deletes its tasks and their comments.
router.delete('/projects/:id', (req, res) => {
  const project = findOr404(db.projects, req.params.id, projectNotFound());
  const taskIds = new Set(db.tasks.filter((t) => t.projectId === project.id).map((t) => t.id));
  db.comments = db.comments.filter((c) => !taskIds.has(c.taskId));
  db.tasks = db.tasks.filter((t) => !taskIds.has(t.id));
  db.projects = db.projects.filter((p) => p.id !== project.id);
  res.status(204).end();
});

module.exports = router;
