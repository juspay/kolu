# localci

AI-friendly local Nix CI: a reusable just library that runs builds across
multiple nix systems from your laptop, posts forge signoffs, and emits a
structured event stream that agents can tail.

No GitHub Actions, no Hydra. Just `just`, `perl`, `python3` (with a
`nix run nixpkgs#python3` fallback — works on any machine with nix), `nix`,
`ssh`, and `gh` (optional, for the GitHub forge backend).

## Design

The consumer writes **regular justfile recipes** — one job each, no library
syntax in the body. Each recipe is tagged with `[metadata("localci:system:<name>")]`
attributes declaring which target systems it runs on, and (optionally)
`[metadata("localci:depends:<step>")]` attributes declaring intra-lane
ordering. localci's scheduler reads those attributes via
`just --dump --dump-format json`, builds a per-system DAG, fans systems
out in parallel, and wraps each step with the CI lifecycle (events,
forge signoff, transport dispatch, log capture).

```
ci/
  mod.just             # your leaves + metadata; imports localci/lib.just
  localci/             # this library (vendored or consumed via nix flake)
    lib.just           # default/scheduler/step/summary/contexts/guards/events
    scheduler.py       # reads `just --dump`, emits execution plan
    forges/
      github.just      # commit statuses via gh
      none.just        # no-op (no signoff)
    apm.yml            # APM package metadata
    .apm/instructions/ # agent workflow docs
```

## What the library gives you

- **`default`** — acquires the single-instance lock (`perl Fcntl::flock` on
  `.localci/current`), then execs `_scheduler`. Kernel releases the lock on
  any exit; file contents persist as the current-or-last run sha.
- **`_scheduler`** — runs `_guard`, resolves SSH hosts, generates the plan
  via `_plan`, forks one subshell per system lane, waits, renders summary.
- **`_plan`** — pipes `just --dump --dump-format json` through
  `scheduler.py`. Python falls back to `nix run nixpkgs#python3 --` if
  `python3` isn't on `PATH`.
- **`_step name`** — runs `just <module>::<name>` (locally or via ssh) with
  colored log prefix, event emission, forge signoff, and a failure trap
  that always exits 0 so sibling steps keep going.
- **`_contexts`** — lists all CI contexts (`<step>` or `<step>@<system>`)
  derived from the plan. Consumed by `_summary`, forge `protect`.
- **`_summary`** — two-column table: local event state vs forge signoff state.
- **`_emit-event`**, **`_guard`**, **`_host`** — internal helpers.

## Single-instance lock

`just ci` acquires an exclusive lock on `.localci/current` via perl's
`Fcntl::flock`. Only one run per worktree at a time. The kernel releases
the lock on any process exit (clean, crash, SIGKILL). The file persists
with the last run's sha so agents can always answer "what was the latest
run?" by reading one file.

## Event stream

`.localci/logs/<short-sha>/events.ndjson` is an append-only NDJSON stream.
Agents tail it to observe a run in real time:

```sh
tail -f .localci/logs/$(cut -c1-7 .localci/current)/events.ndjson
```

Parallel steps append safely under advisory `flock`. See
`.apm/instructions/ci-workflow.instructions.md` for the full event schema.

## Usage in your project

### 1. Vendor `vendor/localci/` into your project

Copy this directory to `vendor/localci/` in your repo.

### 2. Wire it into your top-level `justfile`

```just
# Library recipes under the `localci::` namespace.
mod localci 'vendor/localci/lib.just'
# Forge backend imported flat so library can dispatch `_signoff` etc.
import 'vendor/localci/forges/github.just'    # or forges/none.just

# Entry point — runs every tagged recipe under the single-instance lock.
ci: localci::run

# Your CI steps are just regular top-level recipes with a `[metadata]` attribute
# that says which lane they run in. No prefix, no indirection, no wrappers.

[metadata("localci:system:local")]
check:
    pnpm typecheck

[metadata("localci:system:local")]
fmt:
    prettier --check .

[metadata("localci:system:x86_64-linux")]
[metadata("localci:system:aarch64-darwin")]
build:
    nix build github:srid/devour-flake -L --no-link --print-out-paths --override-input flake .

[metadata("localci:system:x86_64-linux")]
[metadata("localci:system:aarch64-darwin")]
[metadata("localci:depends:build")]
test:
    cargo test   # or whatever
```

That's it. localci reads the `[metadata]` attributes via `just --dump` and
builds the execution plan — no `default`, no orchestrator lanes, no
`(_run ...)` wrappers, no `|| true`.

### Why `[metadata("localci:depends:...")]` instead of just's native `dep:` syntax

Notice the example above uses `[metadata("localci:depends:build")]` rather
than `test: build`. This is deliberate.

The scheduler dispatches each step via its own `just <step>` subprocess.
If `test` had a native `test: build` dep, every dispatch of `just test`
would re-run `build` as just's native dep resolution kicks in — once as
its own step, again as `test`'s dep, again as `other-step`'s dep, etc.
On a Nix project with devour-flake, that's ~5–10s of redundant overhead
per extra run.

The `[metadata("localci:depends:<step>")]` tag tells the scheduler "`build`
must run before me in this lane," and the scheduler enforces that via
topological ordering. Each step then runs **exactly once per lane**, with
no re-evaluation of deps per dispatch.

**Tradeoff**: dev users running `just test` directly don't get the
auto-ordering — they need to run `just build` first manually, or invoke
`just ci` for the full lane. If your recipe has a **real** (non-CI-plan)
dependency on a setup recipe like `install`, keep that as a native just
dep — the scheduler only touches `localci:depends:*` tags.

### 4. Gitignore runtime state

```
.localci/
```

### 5. Add to your APM config (optional)

If your project uses APM, import the localci APM package so agents pick up
the workflow instructions automatically:

```yaml
# apm.yml
dependencies:
  apm:
    - ./ci/localci
```

### 6. Run

```sh
just ci              # run all steps, respecting the lock
just ci::protect     # (GitHub) require CI on default branch
just ci::_contexts   # list all step@system pairs
just ci::_plan       # show the execution plan (system:step1 step2...)
just ci::_summary    # render the two-column summary table
```

## Contract

The importer must define one variable:

| Variable      | Description                                            |
| ------------- | ------------------------------------------------------ |
| `module_name` | Just module name (e.g. `"ci"` for `mod ci 'mod.just'`) |

`lib.just` provides defaults for `sha`, `system`, `local_system`, and
`root` — these are boilerplate for any nix project.

And import exactly one forge backend, which provides `repo`, `_signoff`,
`_list-statuses`, and (optionally) `protect`.

Leaves opt into the scheduler via `[metadata("localci:system:<name>")]` attributes.
System names are either `local` (runs once on whoever invokes `just ci`,
no `@system` suffix) or a nix system string like `x86_64-linux` /
`aarch64-darwin` (runs on that system; native → local exec, non-native →
ssh + git bundle to a remote builder). Multiple `[metadata]` attributes per
recipe for multi-system steps. Ordering within a lane is expressed via
`[metadata("localci:depends:<other-step>")]` — **not** just's native
`dep:` syntax. See the section below for why.

## Known stinks / tradeoffs

Things the current design gets wrong, or that aren't as clean as they should
be. These are live issues — fixing any of them is a follow-up.

### No within-lane parallelism

The scheduler forks one subshell per system lane (`&` + `wait`), but
**inside a lane, steps run sequentially** via a flat `for step in $steps`
loop. If two steps in the same lane have no `localci:depends:*` between
them, they should be able to run concurrently — but they don't. Example:
in kolu's `x86_64-linux` lane, `home-manager` and `e2e` both depend on
`nix` and are otherwise independent, so after `nix` finishes they could
fan out in parallel — but the scheduler runs them serially, adding
~30–60s of unnecessary wall-time.

The fix is a real DAG executor instead of a topologically-sorted
pipeline: fork each ready step's subshell, wait for its deps, mark done,
repeat. ~30 lines of bash or a cleaner rewrite in Python (see next
section). Current implementation is "good enough for small graphs where
the slowest lane dominates anyway."

### Bash `&` + `wait` for scheduling

Cross-lane parallelism is implemented with POSIX `&` + `wait` in a bash
`while` loop inside `_scheduler`. This is standard shell concurrency —
not a hack per se — but the choice forces within-lane serialization
(above) because writing a real DAG executor in bash is gnarly.

The "right" answer long-term is to hoist the entire scheduler into
`scheduler.py` — the existing Python file that currently only emits the
plan could also execute it, using `concurrent.futures.ProcessPoolExecutor`
or `asyncio` for both cross-lane and within-lane concurrency. `lib.just`
would shrink to a thin wrapper that invokes `python3 scheduler.py run`.
Keeps the consumer interface (just recipes + `[metadata]` tags)
unchanged. **Not done yet.**

### Two dep syntaxes, user has to remember which

- `install` (a setup prerequisite not in the CI plan) uses just's native
  `dep:` syntax: `typecheck: install`.
- `nix` (a CI-plan step) uses `[metadata("localci:depends:nix")]` — the
  scheduler respects this for intra-lane ordering, and the native dep
  is *omitted* to avoid each dispatch re-running `nix` as a dep.

There's no single mechanism that works for both. The rule is "if the
dep is tagged with `localci:system:*`, use `[metadata]`; otherwise use
a native just dep," and it's enforced by convention, not the language.
Fragile if a new contributor doesn't read the README.

### Per-step subprocess overhead

Each dispatched step is a fresh `just <step>` subprocess. Just re-parses
the justfile, re-runs all top-level backtick expressions (sha, repo,
context_prefix, local_system, etc.), and evaluates dep chains from
scratch. That's ~50–100ms × 9 steps per run, plus the cost of every
`just localci::_emit-event` / `just localci::_signoff` call from inside
`_step` (multiple per step). Probably a second of total overhead; small
enough to ignore, large enough to mention.

### `_contexts` re-runs the scheduler per step dispatch

`_step` calls `just localci::_contexts` to compute the max label width
for colored prefix padding. `_contexts` internally calls `_plan`, which
shells out to `python3 scheduler.py` via `nix run` fallback. That's
~130ms of work per step dispatch, for a cosmetic feature (label
alignment). Cache-worthy; not cached.

### Variable duplication between library and forge

`sha := \`git rev-parse HEAD\`` is defined in **both** `lib.just`
(inside the `localci::` module) and `forges/github.just` (top-level)
because just's module variable scopes don't leak to top-level. Two
identical backtick invocations per parse, and the risk that one gets
updated without the other. Same story for `root`, `system`, etc. if
any of them ever get referenced by a forge file.

### `_step` always exits 0

By design — the failure trap writes `step_end{state:failure}` to
events.ndjson and posts a forge signoff, then the script exits 0 so the
scheduler's `for` loop keeps running subsequent steps in the lane. But
this means the scheduler has no way to **stop a lane on failure** if
you ever want that (e.g., "don't bother running e2e if build failed").
The only signal is "read the event stream." Acceptable for kolu's DAG;
possibly wrong for other shapes.

### `_guard` runs once up front, not per-step

A user who dirties the worktree mid-run won't trip `_guard` until the
next fresh invocation. Phase 1 re-checked per-step; phase 1.5 removed
that to allow steps to tolerate tree mutations (e.g., nix builds writing
to `.claude/`). Trade-off — document which mutations are expected and
which should abort.

## Not yet implemented

- Bitbucket forge backend (`forges/bitbucket.just`)
- Nix cache push after successful builds
- Remote builder load balancing (pick least-loaded builder)
- Real DAG executor (within-lane parallelism)
- Python-hosted scheduler + dispatch
- Scheduler plan caching (avoid `just --dump` re-runs in `_contexts`)
