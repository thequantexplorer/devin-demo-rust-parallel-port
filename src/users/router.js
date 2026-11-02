const express = require('express');
const { db, nextId, now } = require('../lib/db');
const { notFound, validation, conflict } = require('../lib/errors');
const { findOr404, paginate, oneOf } = require('../lib/http');
const v = require('../lib/validate');

const ROLES = ['member', 'admin'];
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const router = express.Router();
const userNotFound = () => notFound('User not found');

function readEmail(b, required) {
  const raw = v.text(b, 'email', { required, max: 254 });
  if (raw === undefined) return undefined;
  const email = raw.toLowerCase();
  if (!EMAIL.test(email)) throw validation('email is not a valid address');
  return email;
}

function assertEmailFree(email, exceptId) {
  if (db.users.some((u) => u.email === email && u.id !== exceptId)) {
    throw conflict('A user with this email already exists');
  }
}

router.get('/users', (req, res) => {
  const role = oneOf(req.query.role, 'role', ROLES);
  const rows = db.users.filter((u) => role === undefined || u.role === role);
  res.json(paginate(rows, req.query));
});

router.get('/users/:id', (req, res) => {
  res.json(findOr404(db.users, req.params.id, userNotFound()));
});

router.post('/users', (req, res) => {
  const b = v.body(req);
  const name = v.text(b, 'name', { required: true, max: 80 });
  const email = readEmail(b, true);
  const role = oneOf(b.role, 'role', ROLES) ?? 'member';
  assertEmailFree(email);
  const user = { id: nextId('users'), name, email, role, createdAt: now() };
  db.users.push(user);
  res.status(201).json(user);
});

router.patch('/users/:id', (req, res) => {
  const user = findOr404(db.users, req.params.id, userNotFound());
  const b = v.body(req);
  const name = v.text(b, 'name', { max: 80 });
  const email = readEmail(b, false);
  const role = oneOf(b.role, 'role', ROLES);
  if (email !== undefined) assertEmailFree(email, user.id);
  if (name !== undefined) user.name = name;
  if (email !== undefined) user.email = email;
  if (role !== undefined) user.role = role;
  res.json(user);
});

router.delete('/users/:id', (req, res) => {
  const user = findOr404(db.users, req.params.id, userNotFound());
  if (db.projects.some((p) => p.ownerId === user.id)) {
    throw conflict('User still owns projects');
  }
  if (db.tasks.some((t) => t.assigneeId === user.id && t.status !== 'done')) {
    throw conflict('User still has open tasks');
  }
  db.users.splice(db.users.indexOf(user), 1);
  res.status(204).end();
});

module.exports = router;
