# localci

AI-friendly local Nix CI: a reusable just library that runs builds across
multiple nix systems from your laptop, posts forge signoffs, and emits a
structured event stream that agents can tail.

No GitHub Actions, no Hydra. Just `just`, `perl`, `python3` (with a
`nix run nixpkgs#python3` fallback — works on any machine with nix), `nix`,
`ssh`, and `gh` (optional, for the GitHub forge backend).

## Design

The consumer writes **regular justfile recipes** — one job each, no library
syntax in the body. Each recipe is tagged with `[group("system:<name>")]`
attributes declaring which target systems it runs on. localci's scheduler
reads those attributes (and just's native `dep:` syntax for intra-lane
ordering) via `just --dump --dump-format json`, builds a per-system DAG,
fans systems out in parallel, and wraps each step with the CI lifecycle
(events, forge signoff, transport dispatch, log capture).

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

### 1. Vendor `ci/localci/` into your project

Copy this directory to `ci/localci/` in your repo.

### 2. Create `ci/mod.just`

```just
import 'localci/lib.just'
import 'localci/forges/github.just'    # or forges/none.just

module_name := "ci"

[group("system:local")]
fmt:
    just fmt-check

[group("system:local")]
typecheck:
    just check

[group("system:x86_64-linux")]
[group("system:aarch64-darwin")]
build:
    nix build github:srid/devour-flake -L --no-link --print-out-paths --override-input flake .

[group("system:x86_64-linux")]
[group("system:aarch64-darwin")]
test: build
    just test
```

That's it — no `default`, no orchestrator lanes, no `(_run ...)` wrappers,
no `|| true`, no shell-out dispatch. localci reads the `[group]` attributes
and the `test: build` dep via `just --dump` and builds the execution plan.

### 3. Add to your top-level justfile

```just
mod ci 'ci/mod.just'
```

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

Leaves opt into the scheduler via `[group("system:<name>")]` attributes.
System names are either `local` (runs once on whoever invokes `just ci`,
no `@system` suffix) or a nix system string like `x86_64-linux` /
`aarch64-darwin` (runs on that system; native → local exec, non-native →
ssh + git bundle to a remote builder). Multiple `[group]` attributes per
recipe for multi-system steps. Ordering within a lane is expressed via
just's native dep syntax (`test: build`).

## Not yet implemented

- Bitbucket forge backend (`forges/bitbucket.just`)
- Nix cache push after successful builds
- Remote builder load balancing (pick least-loaded builder)
