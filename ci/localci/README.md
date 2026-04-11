# localci

AI-friendly local Nix CI: a reusable just library that runs builds across
multiple nix systems from your laptop, posts forge signoffs, and emits a
structured event stream that agents can tail.

No GitHub Actions, no Hydra. Just `just`, `perl`, `nix`, `ssh`, and `gh`
(optional, for the GitHub forge backend).

## How it works

```
<your-project>/
  justfile                     # mod ci 'ci/mod.just'
  ci/mod.just                  # project-specific config (imports from localci/)
  ci/localci/                  # this library
    lib.just                   # forge-agnostic core
    forges/
      github.just              # commit statuses via gh
      none.just                # no-op (no signoff)
    apm.yml                    # APM package
    .apm/instructions/         # agent workflow docs
```

The library's contract is small — importers declare a handful of variables
and pick a forge backend, and they get:

- **`_run name +cmd`** — run a CI step with colored prefix, local-or-remote
  transport (ssh + git bundle for non-native systems), log capture, forge
  signoff lifecycle, and structured events.
- **`_devour-flake name +args`** — `_run` wrapper for `nix build` via
  [devour-flake](https://github.com/srid/devour-flake).
- **`_preflight`** — clean-worktree guard, commit-pushed guard, SSH-host
  resolution for remote systems.
- **`_contexts`** — auto-derives all `step@system` pairs from your
  justfile structure.
- **`_summary`** — two-column table: local event state vs forge signoff state.
- **`protect`** (GitHub only) — set branch protection requiring all contexts.

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

module_name  := "ci"
sha          := `git rev-parse HEAD`
system       := env("CI_SYSTEM", `nix eval --raw --impure --expr builtins.currentSystem`)
local_system := `nix eval --raw --impure --expr builtins.currentSystem`
root         := `git rev-parse --show-toplevel`
systems      := "x86_64-linux aarch64-darwin"

# Top-level: acquire lock, run inner workflow, release on exit.
default:
    #!/usr/bin/env bash
    set -euo pipefail
    mkdir -p .localci
    exec perl -MFcntl=:flock -e '
        BEGIN { $^F = 10 }
        open(my $f, "+>>", ".localci/current") or die "open: $!\n";
        flock($f, LOCK_EX | LOCK_NB) or do {
            seek $f, 0, 0;
            my $prev = <$f> // "?";
            chomp $prev;
            die "localci already running (sha=$prev)\n";
        };
        truncate($f, 0); seek $f, 0, 0;
        print $f "{{ sha }}\n";
        $f->flush;
        exec @ARGV or die "exec: $!\n";
    ' just ci::_inner

_inner: _preflight _run-all _summary

[parallel]
_run-all: _linux _darwin

_linux:
    CI_SYSTEM=x86_64-linux just ci::build ci::test || true

_darwin:
    CI_SYSTEM=aarch64-darwin just ci::build || true

build:
    just ci::_devour-flake build --override-input flake .

test:
    just ci::_run test just test
```

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
just ci::_summary    # render the two-column summary table
```

## Contract

The importer must define these variables before importing `lib.just`:

| Variable       | Description                                            |
| -------------- | ------------------------------------------------------ |
| `module_name`  | Just module name (e.g. `"ci"` for `mod ci 'mod.just'`) |
| `sha`          | Git commit sha to test                                 |
| `system`       | Current nix system (overridable via `CI_SYSTEM`)       |
| `local_system` | The machine's native nix system                        |
| `root`         | Git repo root path                                     |
| `systems`      | Space-separated list of all target systems             |

And import exactly one forge backend, which provides `repo`, `_signoff`,
`_list-statuses`, and (optionally) `protect`.

## Not yet implemented

- Bitbucket forge backend (`forges/bitbucket.just`)
- Nix cache push after successful builds
- Remote builder load balancing (pick least-loaded builder)
