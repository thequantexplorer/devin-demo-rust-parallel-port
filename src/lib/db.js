const fs = require('node:fs');
const path = require('node:path');

// The whole data set lives in memory. Every server start loads a fresh copy of
// data/seed.json, so the API is deterministic between runs.
const seedPath = path.join(__dirname, '..', '..', 'data', 'seed.json');
const db = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

const lastIds = {};
for (const [name, rows] of Object.entries(db)) {
  lastIds[name] = rows.reduce((max, row) => Math.max(max, row.id), 0);
}

function nextId(collection) {
  lastIds[collection] += 1;
  return lastIds[collection];
}

function now() {
  return new Date().toISOString();
}

module.exports = { db, nextId, now };
