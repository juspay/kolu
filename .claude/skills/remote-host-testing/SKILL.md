---
name: remote-host-testing
description: >-
  Test kolu's remote-host features (multi-host / padi-remote) in a real
  browser against a real remote box — the ONLY full end-to-end harness for
  this surface (real ssh provision, no mock). Covers the isolated nix-run
  invocation (or just dev, which bakes the same agent source), ssh-
  provisioning a real remote box without touching production or another
  user's box, the chrome-devtools drive sequence for host-switch / split /
  code-browser / per-host-canvas, PID-exact teardown, and the reproduce-
  first rule for any bug the feature surfaces. Triggers on "test remote
  hosts", "test multi-host", "test padi-remote", "verify the host switch",
  "browser-test a remote host change", or before claiming a remote-host fix
  works.
---

# remote-host-testing — real browser, real remote box, isolated from production

Kolu's multi-host / remote-padi surface can **only** be exercised end-to-end
against a real ssh-reachable box: it's a real remote-provisioning path (nix
copies the padi closure over ssh), and no mock stands in for it. This skill is
the harness — nix-run isolation, the remote leg, the browser-drive checklist,
teardown, and the rule that a reported bug must reproduce here before you
diagnose it.

## 0. Ask first — before touching anything remote

**Before provisioning or connecting to any remote box**, use `AskUserQuestion`
to settle three things. Never guess or reuse a box name from a prior session,
a commit message, or this skill's own examples — a box is chosen at runtime,
never hardcoded:

1. **Which remote host(s) to test against** (the ssh destination(s) kolu will
   bind, e.g. `user@host` or an ssh-config alias).
2. **Which one is EXPENDABLE** — its padi/kaval daemons are yours to kill and
   replace freely during this run.
3. **Which boxes are PRODUCTION / UNTOUCHABLE** — never connect, provision,
   or run anything against these, even read-only, unless the user names them
   as the target in (1).

Only proceed to §1 once you have an explicit answer. Treat silence or "any
box" as **not** an answer — a specific host must be named.

## 1. Isolation invocation — prefer nix-run; just dev is also agent-source-complete

Both the packaged wrapper and `just dev` / `just dev-auto` bake
`SURFACE_AGENT_FLAKE_REF` (the latter by sourcing `.#agent-flake-env` before
the dev fork), so either path can resolve and provision a remote padi. Prefer
the **nix-built binary** for this harness: it is production-shaped and pairs
with the isolation env below. Use `just dev-auto` (see the **dev-server**
skill) when you need HMR against a remote host — still apply the same
state-dir / port isolation discipline, and **commit** any padi/kaval change
first: both paths bake the git-tracked tree, so an uncommitted edit reaches
your local server but not the padi the remote provisions.

```sh
nix build .#default
```

Then launch the built binary, isolated from any locally-running production
kolu:

```sh
port=$(nix shell nixpkgs#python3 --command python3 -c \
  'import socket; s=socket.socket(); s.bind(("",0)); print(s.getsockname()[1]); s.close()')
KOLU_STATE_DIR=$(mktemp -d) \
KOLU_PADI_STATE_DIR="$KOLU_STATE_DIR/padi" \
KOLU_PADI_HOST="<remote-from-§0>" \
result/bin/kolu --host 127.0.0.1 --port "$port" &
kolu_pid=$!
```

**Why this isolates from production, mechanically:**

- `packages/server/src/state.ts` **throws** if `KOLU_STATE_DIR` is unset
  ("`KOLU_STATE_DIR` must be set to an absolute directory") — there is no
  silent fallback to `~/.config/kolu` (that was #1414; it's fixed). An
  explicit `mktemp -d` is respected, so your instance's config/session state
  never touches production's.
- `--port "$port"` (random, free) keeps the browser-facing HTTP/WS server off
  production's fixed port.
- `KOLU_PADI_STATE_DIR` retargets padi's **state-root**, and every padi/kaval
  unix-socket rendezvous path is a **digest of that state-root**
  (`padi-<digest>/`, `kaval-<digest>/` — see `packages/padi/src/stateRoot.ts`).
  A temp state-root therefore yields a digest production's default
  (`~/.local/state/padi`) never collides with — the whole padi+kaval pair is
  isolated, not just the listen port.
- **Never set `$HOME` to fake isolation.** `KOLU_STATE_DIR` /
  `KOLU_PADI_STATE_DIR` are the sanctioned levers precisely because padi's
  state-root default is deliberately `$HOME`-anchored and env-insensitive
  everywhere else (see the doc comment on `defaultPadiStateRoot`) —
  overriding `$HOME` corrupts the real user environment for every other tool
  in the shell, not just kolu.

## 2. The remote leg — provisioning the expendable box

Your isolated kolu provisions the box named in §0(1) over ssh: it nix-copies
the padi closure to the remote. This needs the ssh user in the remote nix
daemon's `trusted-users` (or the daemon's `require-sigs` off) to accept an
unsigned closure copied with `--no-check-sigs`. Verify before you start,
don't discover it mid-run:

```sh
ssh <remote-from-§0> nix show-config | grep trusted-users
```

**Fences — read these against §0's answers before every remote action:**

- Never connect to, provision, or run anything against a box the user marked
  PRODUCTION/UNTOUCHABLE, even read-only (an OOM or a stray daemon counts as
  touching it — see §4).
- The "kill/replace freely" license from §0(2) covers **your own instance's**
  padi/kaval on the expendable box only. If the box is shared, don't stomp
  another kolu's padi there unless the user said the whole box — not just
  your slice of it — is expendable.

## 3. Browser drive — instrument, act, then screenshot

Point chrome-devtools at `http://127.0.0.1:$port`. For each leg below,
**instrument before you act** so a permanent defect (state never recovers) is
distinguishable from a transient one (state recovers a beat later): inject a
`MutationObserver` via `evaluate_script` that logs xterm mount/unmount and
per-tile size/collapsed state to a `window` array, reset the baseline array,
perform the action, then read the trace **and** `take_screenshot` before
concluding anything. A screenshot alone can't tell you whether a collapse was
transient-then-recovered or latched shut — the trace can.

The remote-relevant legs to exercise:

1. **Create a terminal on the remote host** — New terminal → In current
   directory.
2. **Type into it** — fill the "Terminal input" textarea, press Enter, confirm
   output round-trips over the real ssh/padi link.
3. **Split** — Toggle split; confirm a sub-pane appears.
4. **Host-switch A→B→A** — click the host chips to leave the remote host, land
   on another, then switch back. Acceptance: the split survives, tile focus
   survives, and MRU (most-recently-used tile ordering) survives the round
   trip; the code browser re-keys to each host's own repo; the canvas shows
   each host's own tiles, not a stale mix. This exact path (a split silently
   collapsing on switch-back, its metadata arriving a beat late) is the
   canonical example of a bug this harness catches and a unit test alone
   didn't — see §5.
5. **Code browser** — `cd` into a git repo on the remote host, confirm the
   file tree populates with git-status decoration, open a file, confirm
   content renders.
6. **Per-host canvas** — confirm each host's tile layout is genuinely
   per-host state, not shared/overwritten across hosts.

## 4. Teardown-reap — kill your exact PID, nothing else

Capture the spawned PID **at launch** (`$!`, already done in §1) and reap by
that exact PID on a trap/finally — never a name/pattern match:

```sh
trap 'kill "$kolu_pid" 2>/dev/null; rm -rf "$KOLU_STATE_DIR"' EXIT
```

**Never `pkill -f <substring>`** — a substring match (`kolu`, a source path,
a socket path) matches production too; this is the exact mistake that has
killed production `kolu.service` and production's kaval daemon before (see
the `dev-server` skill's teardown section for the full incident list). If you
can't resolve your own PID, leave the process for the user/OS rather than
guess.

**Post-run zero-leak assertion** — confirm before declaring done:

- Production kolu's PID **and** uptime are unchanged from before your run
  (`systemctl --user status kolu` locally, if applicable) — an OOM counts as
  touching it even if nothing you ran named it.
- No orphaned padi/kaval process is left running on the remote box:

  ```sh
  ssh <remote> 'pgrep -fa "padi|kaval"'
  ```

  Anything still alive there after your `kill "$kolu_pid"` is a leaked
  daemon — reap it by its own exact PID, not a pattern.

## 5. Reproduce-first — a passing unit test is not proof

A bug the remote-host feature surfaces **must be reproduced in this exact
harness** (isolated nix-run kolu + a real remote box + a real browser) before
you diagnose or fix it. A green unit test around your hypothesis is not
sufficient proof on its own — it can stay green while the real thing is still
broken, because the failure mode lives in real timing (network round-trips,
metadata arriving a beat after a re-render) that a unit-level pin can't
reproduce. The split-survives-host-switch-back bug is the concrete precedent:
the root cause was a UI library (Corvu) persisting a transient collapse
because sub-terminal metadata re-arrived a beat after the tile re-rendered —
a race that only showed up driving the real switch-back in a real browser
against a real second host, never in an isolated component pin. Confirm the
fix against the SAME repro (steps in §3) before calling it done.

## Acceptance (verify before declaring this testing pass done)

- §0 was answered explicitly — no hardcoded box name, no "any box" guess.
- Launched via `nix build .#default` + `result/bin/kolu` (preferred) or
  `just dev-auto` with the same isolation env — both bake the agent source.
- `KOLU_STATE_DIR` was an explicit `mktemp -d` (never unset, never `$HOME`
  overridden).
- Every browser-drive leg in §3 was instrumented (baseline reset → act →
  trace + screenshot), not screenshot-only.
- Teardown killed the exact captured PID; the remote box has zero orphaned
  padi/kaval afterward; production (if present locally) shows the same PID
  and uptime as before.
- Any bug found was reproduced in this harness before it was called fixed.
