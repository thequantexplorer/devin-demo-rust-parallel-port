const express = require('express');
const { db, nextId } = require('../lib/db');
const { notFound, validation, conflict } = require('../lib/errors');
const { findOr404 } = require('../lib/http');
const v = require('../lib/validate');
const { renderTask } = require('../tasks/serialize');

const NAME = /^[a-z0-9-]{1,30}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;

const router = express.Router();
const tagNotFound = () => notFound('Tag not found');

function renderTag(tag) {
  return { ...tag, taskCount: db.tasks.filter((t) => t.tagIds.includes(tag.id)).length };
}

// Tags are a short list, so it is not paginated. Sorted by name.
router.get('/tags', (req, res) => {
  const rows = [...db.tags].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  res.json(rows.map(renderTag));
});

router.post('/tags', (req, res) => {
  const b = v.body(req);
  const name = v.text(b, 'name', { required: true });
  if (!NAME.test(name)) throw validation('name must be 1-30 lowercase letters, digits or dashes');
  const color = v.text(b, 'color', { required: true });
  if (!COLOR.test(color)) throw validation('color must look like #1a2b3c');
  if (db.tags.some((t) => t.name === name)) throw conflict('A tag with this name already exists');
  const tag = { id: nextId('tags'), name, color: color.toLowerCase() };
  db.tags.push(tag);
  res.status(201).json(renderTag(tag));
});

router.delete('/tags/:id', (req, res) => {
  const tag = findOr404(db.tags, req.params.id, tagNotFound());
  for (const task of db.tasks) task.tagIds = task.tagIds.filter((id) => id !== tag.id);
  db.tags = db.tags.filter((t) => t.id !== tag.id);
  res.status(204).end();
});

// Adding a tag the task already has, or removing one it does not have, is not an error.
router.put('/tasks/:taskId/tags/:tagId', (req, res) => {
  const task = findOr404(db.tasks, req.params.taskId, notFound('Task not found'));
  const tag = findOr404(db.tags, req.params.tagId, tagNotFound());
  if (!task.tagIds.includes(tag.id)) task.tagIds.push(tag.id);
  res.json(renderTask(task));
});

router.delete('/tasks/:taskId/tags/:tagId', (req, res) => {
  const task = findOr404(db.tasks, req.params.taskId, notFound('Task not found'));
  const tag = findOr404(db.tags, req.params.tagId, tagNotFound());
  task.tagIds = task.tagIds.filter((id) => id !== tag.id);
  res.json(renderTask(task));
});

module.exports = router;
