#!/usr/bin/env node
// Prints every route the Express app serves, grouped by domain folder.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { domains } = require('../src/app.js');

let total = 1;
console.log('common     GET    /health');
for (const domain of domains) {
  const router = require(`../src/${domain}/router.js`);
  for (const layer of router.stack) {
    if (!layer.route) continue;
    for (const method of Object.keys(layer.route.methods)) {
      console.log(`${domain.padEnd(10)} ${method.toUpperCase().padEnd(6)} ${layer.route.path}`);
      total += 1;
    }
  }
}
console.log(`\n${total} routes`);
