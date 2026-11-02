const express = require('express');
const { db, nextId, now } = require('../lib/db');
const { notFound, validation } = require('../lib/errors');
const { findOr404, paginate } = require('../lib/http');
const v = require('../lib/validate');

const router = express.Router();
const commentNotFound = () => notFound('Comment not found');

router.get('/tasks/:id/comments', (req, res) => {
  const task = findOr404(db.tasks, req.params.id, notFound('Task not found'));
  res.json(paginate(db.comments.filter((c) => c.taskId === task.id), req.query));
});

router.post('/tasks/:id/comments', (req, res) => {
  const task = findOr404(db.tasks, req.params.id, notFound('Task not found'));
  const b = v.body(req);
  const authorId = v.id(b, 'authorId', { required: true });
  if (!db.users.some((u) => u.id === authorId)) throw validation('authorId does not match a user');
  const text = v.text(b, 'body', { required: true, max: 2000 });
  const comment = { id: nextId('comments'), taskId: task.id, authorId, body: text, createdAt: now(), editedAt: null };
  db.comments.push(comment);
  res.status(201).json(comment);
});

router.patch('/comments/:id', (req, res) => {
  const comment = findOr404(db.comments, req.params.id, commentNotFound());
  const text = v.text(v.body(req), 'body', { required: true, max: 2000 });
  comment.body = text;
  comment.editedAt = now();
  res.json(comment);
});

router.delete('/comments/:id', (req, res) => {
  const comment = findOr404(db.comments, req.params.id, commentNotFound());
  db.comments = db.comments.filter((c) => c.id !== comment.id);
  res.status(204).end();
});

module.exports = router;
