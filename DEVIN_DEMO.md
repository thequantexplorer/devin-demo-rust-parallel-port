# Devin demo: Port a Node service to Rust with parallel sessions

**What it shows:** Devin plans a port of a 30-route Express API to Rust (axum + tokio + serde). It builds the shared crate skeleton first, then starts one managed Devin (child session) per domain. Each child writes one Rust file. Devin merges their work into one integration PR where the same HTTP contract tests pass against the Rust binary, and CI runs them.

**Needs:** GitHub only

**Level:** Advanced. Plan on 30 to 40 minutes. The parent session and its six child sessions all use your Devin quota.

## Set it up

1. Click **Use this template → Create a new repository**, choose your GitHub account or org as the owner, and keep the name `devin-demo-rust-parallel-port`. The prompt below assumes that name. Use the template rather than a fork: pull requests on a fork go to the original repo by default.
2. In Devin, open [**Settings → Connections → GitHub**](https://app.devin.ai/settings/connections/github) and make sure Devin can access the new repository.

Devin starts child sessions without asking by default. If you turned off **Auto-approve child sessions** in [Settings → Preferences](https://app.devin.ai/settings/preferences#auto-approve-child-sessions), approve each child when the parent session asks.

## The starting state

The Node server passes all 8 contract suites (`npm run contract`, 67 tests). There is no Rust code yet, so the same tests cannot run against Rust:

```text
$ npm run contract:rust

rust/Cargo.toml not found: the Rust port has not been started yet.
Expected a Cargo package named "tracker-api" in rust/ that serves this API on $PORT.
```

The tests only speak HTTP, so they work for any language. The rules for the port (crate layout, who may change which file, Rust pitfalls) are in the repo skill `.agents/skills/rust-port/SKILL.md`.

## Prompt

Start a new Devin session at [app.devin.ai](https://app.devin.ai) and paste this. Replace `<you>` with your GitHub user or org.

```text
Port https://github.com/<you>/devin-demo-rust-parallel-port from Node (Express) to Rust (axum + tokio + serde). Split the work across parallel child Devin sessions, one per domain. Follow the repo skill in .agents/skills/rust-port/SKILL.md.

1. Plan. Run `npm ci`, `npm run contract` and `npm run contract:rust`, and show me the output. Run `npm run routes`. Post a table with each of the six domains, its routes and its Rust file in rust/src/routes/. Then continue without waiting for me.
2. Skeleton first. Create a branch `rust-port` from main. On it, add the Cargo package in rust/ that the skill describes: Cargo.toml with every crate the domains need, main.rs, app.rs (the router), state.rs, error.rs, models.rs, util.rs, and one module file per domain that returns an empty router. Check that `npm run contract:rust -- common` passes, then push the branch.
3. Fan out. Start one child Devin session per domain, 6 in total. Tell each child its domain, its one file (rust/src/routes/<domain>.rs), to start from `rust-port`, and to follow the skill. Each child changes only that file, passes `npm run contract:rust -- <domain>`, and opens a PR into `rust-port` (not main).
4. Integrate. When the children finish, merge their PRs into `rust-port`. Add the Rust job from the skill to .github/workflows/ci.yml so CI runs the contract tests against the Rust binary. Run `npm run contract:rust` until every suite passes, then open one PR from `rust-port` into main. In its description, add a table with each domain, its child session and its PR, and paste the final `Contract results (rust server)` summary.
```

## What to watch

- The skeleton lands on `rust-port` before any child starts, so every child starts from a crate that already builds.
- Open a child session. It changes only its own file in `rust/src/routes/` and opens a PR into `rust-port`.
- The `cross-domain` suite only passes after the merge, because it needs every domain at once.

## Done when

- One PR from `rust-port` into main, with **Contract tests (Node)** and **Contract tests (Rust)** green.
- The PR description links all six child sessions and their PRs, and shows `All 8 suite(s) passed.` for the Rust server.
