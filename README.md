# tracker-api

A small task-tracker JSON API in Node (Express). Six domains, 30 routes, in-memory data loaded from `data/seed.json` each time the server starts.

| Domain | Folder | Routes |
| - | - | - |
| users | `src/users/` | 5 |
| projects | `src/projects/` | 6 |
| tasks | `src/tasks/` | 6 |
| comments | `src/comments/` | 4 |
| tags | `src/tags/` | 5 |
| reports | `src/reports/` | 3 |

Plus `GET /health`. Run `npm run routes` for the full list.

The plan is to port this service to Rust (axum + tokio + serde) in `rust/`. The rules for the port are in [`.agents/skills/rust-port/SKILL.md`](.agents/skills/rust-port/SKILL.md). To try it with Devin, see [DEVIN_DEMO.md](DEVIN_DEMO.md).

## Contract tests

`contract/` holds one HTTP test file per domain, plus `common` and `cross-domain`. The tests only use `fetch` against `BASE_URL`, so they do not care what language the server is written in. `scripts/contract.mjs` starts a fresh server on a free port for each file, so every file sees the same seed data.

```sh
npm ci
npm run contract                  # all suites against the Node server
npm run contract -- users tags    # only some suites
npm run contract:rust             # all suites against the Rust binary in rust/
```

To run one file against a server that is already up: `BASE_URL=http://127.0.0.1:3000 node --test contract/users.test.mjs`.

## Where things stand

The Node server passes every suite:

```text
$ npm run contract

Contract results (node server):
  PASS  common        2 passed, 0 failed
  PASS  users         11 passed, 0 failed
  PASS  projects      9 passed, 0 failed
  PASS  tasks         12 passed, 0 failed
  PASS  comments      6 passed, 0 failed
  PASS  tags          7 passed, 0 failed
  PASS  reports       10 passed, 0 failed
  PASS  cross-domain  10 passed, 0 failed

All 8 suite(s) passed.
```

The Rust port has not started, so the same tests cannot run against Rust:

```text
$ npm run contract:rust

rust/Cargo.toml not found: the Rust port has not been started yet.
Expected a Cargo package named "tracker-api" in rust/ that serves this API on $PORT.
```

CI (`.github/workflows/ci.yml`) runs the Node contract tests on every push to main and every pull request.

## API rules in short

- JSON in, JSON out. Errors are `{"error":{"code","message"}}` with codes `validation_failed` (400), `invalid_json` (400), `not_found` (404) and `conflict` (409).
- Lists return `{ items, total, limit, offset }`. `limit` is 1 to 100 (default 20).
- Reports never read the clock. Pass the day to report on as `?asOf=YYYY-MM-DD`.
