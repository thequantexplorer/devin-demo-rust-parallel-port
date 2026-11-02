const express = require('express');
const { notFoundHandler, errorHandler } = require('./lib/errors');

const domains = ['users', 'projects', 'tasks', 'comments', 'tags', 'reports'];

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());
  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  for (const domain of domains) app.use(require(`./${domain}/router`));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp, domains };
