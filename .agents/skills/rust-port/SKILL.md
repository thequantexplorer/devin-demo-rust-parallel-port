---
name: rust-port
description: Port this repo's Node (Express) API to Rust (axum + tokio + serde) in rust/, one domain at a time, and check it with the HTTP contract tests. Use it for any Rust port work in this repo, as the coordinator or as a session that owns one domain.
---

## What "done" means

The contract tests in `contract/` are the spec. They only speak HTTP, so the same tests run against the Node server and the Rust binary. The Node code in `src/<domain>/router.js` shows the exact rules (validation, status codes, sorting) when a test is not clear.

Never edit `contract/`, `src/`, `data/` or `scripts/`. If a test looks wrong, say so instead of changing it.

## Crate layout

The Rust server is a Cargo package named `tracker-api` in `rust/`. `npm run contract:rust` builds it with `cargo build --release` and starts `rust/target/release/tracker-api` with a `PORT` environment variable.

```text
rust/Cargo.toml
rust/src/main.rs           # reads PORT, binds 127.0.0.1:$PORT, serves app::router()
rust/src/app.rs            # GET /health, merges every domain router, JSON 404 fallback
rust/src/state.rs          # AppState: Arc<Mutex<Db>> loaded from data/seed.json, next-id counters
rust/src/error.rs          # AppError -> {"error":{"code","message"}} with the right status
rust/src/models.rs         # User, Project, Task, Comment, Tag with serde camelCase
rust/src/util.rs           # shared helpers: JSON body, path ids, paging, dates, timestamps
rust/src/routes/mod.rs
rust/src/routes/users.rs   # one file per domain, each exposes pub fn router() -> Router<AppState>
rust/src/routes/projects.rs
rust/src/routes/tasks.rs
rust/src/routes/comments.rs
rust/src/routes/tags.rs
rust/src/routes/reports.rs
```

## Who changes what

- **The skeleton** (everything above except the bodies of the domain files) is built once, on the integration branch, before any domain work starts. It must compile, include every crate the domains will need, and pass `npm run contract:rust -- common` (health check and JSON 404s). Each domain file starts as an empty `Router::new()`.
- **A domain session** changes only `rust/src/routes/<domain>.rs`. Do not touch `Cargo.toml`, `Cargo.lock`, `main.rs`, `app.rs`, `state.rs`, `error.rs`, `models.rs`, `util.rs` or another domain's file. That is what keeps the parallel PRs free of merge conflicts. If you truly need a shared change, stop and tell the session that started you what you need and why.
- Domain routes that start with another domain's path still belong to the domain that owns them in Node: `GET /projects/{id}/tasks` is in tasks, `/tasks/{id}/comments` is in comments, `/tasks/{taskId}/tags/{tagId}` is in tags. Run `npm run routes` for the full list.
- Every domain may read and write any collection in `Db` (for example, deleting a project also deletes its tasks and their comments).

## Rules that are easy to get wrong in Rust

- axum 0.8 path parameters are written `/{id}`, not `/:id`.
- An id that is not a positive whole number (`/users/abc`, `/users/0`) is a **404 `not_found`**, not a 400. Take the path segment as a `String` and parse it yourself. `Path<u32>` would answer 400 in plain text.
- Every error, including ones from extractors, must be JSON: `{"error":{"code":"...","message":"..."}}`. Codes: `validation_failed` (400), `invalid_json` (400, body is not valid JSON), `not_found` (404), `conflict` (409). Unknown routes are a JSON 404 too.
- A field with the wrong type (`"name": 42`, `"ownerId": "1"`) is `validation_failed`, not `invalid_json`. Read bodies as `serde_json::Value` and validate fields by hand, or use the shared helper for this. Unknown fields are ignored.
- PATCH: a missing field is left alone. For `assigneeId` and `dueDate`, an explicit `null` clears the value. A plain `Option<T>` cannot tell these apart.
- Query strings: parse `limit`, `offset` and filters yourself so bad values give `validation_failed` in JSON. `limit` defaults to 20 (1 to 100), `offset` to 0. Lists return `{ "items", "total", "limit", "offset" }`.
- Strings are trimmed before they are checked and stored. Length limits count characters (`.chars().count()`), not bytes. Emails are stored lowercase.
- Timestamps look like `2026-03-01T09:00:00.000Z`: UTC, milliseconds, ending in `Z` (with chrono: `Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)`).
- Dates are `YYYY-MM-DD` and must be real calendar dates (`2026-02-30` and `2026-02-29` are invalid). Reports never read the clock: they use `?asOf=`.
- Task `tagIds` are always returned sorted. JSON field names are camelCase.
- `DELETE` routes that succeed return 204 with an empty body.
- Load the seed at compile time with `include_str!("../../data/seed.json")` so the binary works from any directory.

## Check your work

From the repo root:

```sh
npm ci
npm run contract -- <domain>        # the Node server passes this suite (reference)
npm run contract:rust -- <domain>   # your Rust code must pass the same suite
```

`<domain>` is one of `common`, `users`, `projects`, `tasks`, `comments`, `tags`, `reports`, `cross-domain`. With no suite, every suite runs. Each domain suite passes with only the skeleton and that one domain file. `cross-domain` (cascades, reports over new data, malformed JSON) only passes once all six domains are merged. Also run `cargo fmt` and `cargo clippy` in `rust/` before you push.

## Open the PR

- Title: `rust(<domain>): port the <domain> routes`.
- Base branch: the integration branch you were given, not `main`.
- Description: the routes you ported and the `Contract results` lines from `npm run contract:rust -- <domain>`.

## CI (coordinator, after the merge)

Add a second job to `.github/workflows/ci.yml` next to the Node job. Keep the Node job.

```yaml
  rust:
    name: Contract tests (Rust)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: rust
      - run: npm ci
      - run: npm run contract:rust
```
