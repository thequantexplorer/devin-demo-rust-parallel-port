#!/usr/bin/env node
// Runs the HTTP contract tests in contract/ against a real server.
//
//   node scripts/contract.mjs --server node            # the Express app in src/
//   node scripts/contract.mjs --server rust            # the Rust crate in rust/
//   node scripts/contract.mjs --server rust tasks tags # only some suites
//
// Each suite gets a fresh server on a free port, so every suite starts from data/seed.json.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORDER = ['common', 'users', 'projects', 'tasks', 'comments', 'tags', 'reports', 'cross-domain'];

const args = process.argv.slice(2);
let server = 'node';
const wanted = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--server') server = args[++i];
  else if (args[i].startsWith('--server=')) server = args[i].slice('--server='.length);
  else wanted.push(args[i].replace(/\.test\.mjs$/, ''));
}

const available = readdirSync(path.join(root, 'contract'))
  .filter((f) => f.endsWith('.test.mjs'))
  .map((f) => f.replace(/\.test\.mjs$/, ''))
  .sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));
const unknown = wanted.filter((w) => !available.includes(w));
if (unknown.length) fail(`Unknown suite(s): ${unknown.join(', ')}. Available: ${available.join(', ')}`);
const suites = wanted.length ? available.filter((s) => wanted.includes(s)) : available;

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

function serverCommand() {
  if (server === 'node') return { cmd: process.execPath, args: [path.join(root, 'src', 'server.js')] };
  if (server === 'rust') {
    const manifest = path.join(root, 'rust', 'Cargo.toml');
    if (!existsSync(manifest)) {
      fail('rust/Cargo.toml not found: the Rust port has not been started yet.\n' +
        'Expected a Cargo package named "tracker-api" in rust/ that serves this API on $PORT.');
    }
    console.log('Building the Rust server: cargo build --release --manifest-path rust/Cargo.toml');
    const build = spawnSync('cargo', ['build', '--release', '--manifest-path', manifest], { cwd: root, stdio: 'inherit' });
    if (build.error) fail(`Could not run cargo: ${build.error.message}`);
    if (build.status !== 0) fail('cargo build failed.');
    const binary = path.join(root, 'rust', 'target', 'release', process.platform === 'win32' ? 'tracker-api.exe' : 'tracker-api');
    if (!existsSync(binary)) fail(`Built, but ${path.relative(root, binary)} is missing. The Cargo package must be named "tracker-api".`);
    return { cmd: binary, args: [] };
  }
  return fail(`Unknown --server "${server}". Use node or rust.`);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitForHealth(baseUrl, child, log) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited with code ${child.exitCode}\n${log()}`);
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server did not answer GET /health within 20s\n${log()}`);
}

function runSuite(file, baseUrl) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--test', '--test-reporter=spec', file], {
      cwd: root,
      env: { ...process.env, BASE_URL: baseUrl },
    });
    let out = '';
    for (const stream of [child.stdout, child.stderr]) {
      stream.on('data', (chunk) => {
        out += chunk;
        process.stdout.write(chunk);
      });
    }
    child.on('close', (code) => {
      const count = (label) => Number(out.match(new RegExp(`^\\S*\\s*${label} (\\d+)$`, 'm'))?.[1] ?? 0);
      resolve({ ok: code === 0, pass: count('pass'), fail: count('fail') });
    });
  });
}

const { cmd, args: cmdArgs } = serverCommand();
const results = [];
for (const suite of suites) {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`\n=== ${suite} (${server} server on port ${port})`);
  const child = spawn(cmd, cmdArgs, { cwd: root, env: { ...process.env, PORT: String(port) } });
  let serverLog = '';
  child.stdout.on('data', (c) => (serverLog += c));
  child.stderr.on('data', (c) => (serverLog += c));
  try {
    await waitForHealth(baseUrl, child, () => serverLog.trim());
    results.push({ suite, ...(await runSuite(path.join('contract', `${suite}.test.mjs`), baseUrl)) });
  } catch (err) {
    console.error(`Could not start the ${server} server: ${err.message}`);
    results.push({ suite, ok: false, pass: 0, fail: 0, note: 'server did not start' });
  } finally {
    child.kill();
  }
}

console.log(`\nContract results (${server} server):`);
for (const r of results) {
  const status = r.ok ? 'PASS' : 'FAIL';
  console.log(`  ${status}  ${r.suite.padEnd(13)} ${r.note ?? `${r.pass} passed, ${r.fail} failed`}`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed} of ${results.length} suite(s) failed.` : `\nAll ${results.length} suite(s) passed.`);
process.exit(failed ? 1 : 0);
