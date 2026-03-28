# ci/ — local CI via just + gh + ssh

A reusable CI library that builds across multiple Nix systems, posts GitHub commit statuses, and prints a summary table. No external CI tool needed — just `just`, `gh`, and `ssh`.

## How it works

`ci/lib.just` is the reusable library. `ci/mod.just` is the project-specific configuration that imports it.

```
justfile          →  mod ci 'ci/mod.just'
ci/mod.just       →  import 'lib.just'    (variables + project steps)
ci/lib.just       →  reusable infra       (signoff, guard, ssh, prefix, summary)
```

### What the library provides

- **`_preflight`** — asserts clean worktree, commit pushed to remote, resolves SSH hosts
- **`_guard`** — re-checks worktree/HEAD per step (catches mid-run dirtying)
- **`_run name +cmd`** — runs a command locally or via SSH, with colored prefixed output, GitHub status lifecycle (pending → success/failure), and timing
- **`_host`** — prompts for SSH hostname on first use, caches in `~/.config/ci-hosts.json`
- **`_devour-flake name +args`** — wraps `_run` for `nix build` via [devour-flake](https://github.com/srid/devour-flake)
- **`_contexts`** — auto-derives all `step@system` pairs from the justfile structure
- **`_summary`** — prints a pass/fail table by querying GitHub statuses for the known contexts
- **`protect`** — sets GitHub branch protection requiring all CI contexts (auto-derived, no prior CI run needed)

### Local vs remote execution

If `CI_SYSTEM` matches the local system, commands run directly (prefixed with `~`). Otherwise, the repo is `git bundle`-d over SSH to the remote host and commands run there (prefixed with `>`). The full `.git` is sent so nix can read git revision info.

### Parallel execution

Systems run in parallel via just's `[parallel]` attribute. Within each system, steps run sequentially respecting recipe dependencies.

## Usage in your project

### 1. Create `ci/lib.just`

Copy `lib.just` from this project.

### 2. Create `ci/mod.just`

```just
import 'lib.just'

sha := `git rev-parse HEAD`
repo := `git remote get-url origin | sed 's|.*github.com[:/]||;s|\.git$||'`
system := env("CI_SYSTEM", `nix eval --raw --impure --expr builtins.currentSystem`)
local_system := `nix eval --raw --impure --expr builtins.currentSystem`
root := `git rev-parse --show-toplevel`
systems := "x86_64-linux aarch64-darwin"

[parallel]
default: _linux _darwin

_linux: _preflight
    CI_SYSTEM=x86_64-linux just ci::build ci::test || true

_darwin: _preflight
    CI_SYSTEM=aarch64-darwin just ci::build || true

build:
    just ci::_run build nix build .

test: build
    just ci::_run test just test
```

### 3. Add to your justfile

```just
mod ci 'ci/mod.just'
```

### 4. Run

```sh
just ci              # run all steps on all systems
just ci::protect     # set branch protection requiring CI
just ci::_contexts   # list all step@system pairs
just ci::_summary    # show current status table
```

### Contract

The library expects these variables from the importer:

| Variable       | Description                                      |
| -------------- | ------------------------------------------------ |
| `sha`          | Git commit SHA to test                           |
| `repo`         | GitHub `owner/repo`                              |
| `system`       | Current nix system (overridable via `CI_SYSTEM`) |
| `local_system` | The machine's native nix system                  |
| `root`         | Git repo root path                               |
| `systems`      | Space-separated list of all target systems       |

### Log capture

Each `_run` step captures raw output to `.logs/<short-sha>/<step>@<system>.log`. The log path is included in the GitHub status description. Logs are gitignored and persist locally across runs (one directory per commit).

## Not yet implemented

- **Nix cache push** — push built paths to a binary cache after successful builds
