# B3.3 kaval-adoption VM tests

End-to-end coverage for **kaval adoption** (#1344): terminals — shells,
scrollback, running agents — survive a kolu-server redeploy when the kaval
daemon outlives it. The daemon keeps running in its own `systemd-run --user`
transient cgroup; on boot kolu *adopts* its live PTYs instead of recycling them.

These tests exist because this is the **one path the Playwright e2e harness
can't reach** — it has no systemd, runs one server per worker, and forces the
non-survivable detached spawn. A NixOS VM has *real* systemd, so the production
`systemd-run --user` survival path (the #1031 cgroup-v2 lesson) actually works.

## What's here

| File | Role |
| --- | --- |
| `lib.nix` | The shared scaffold — `mkAdoptionTest` + the survival VM node, boot polls, `machinectl`+result-file run/assert helpers, the jq/curl bindings, and the runtime-layout literals. **One** domain concept (a VM adoption probe); both tests are it with two outcomes. |
| `adopt.nix` | **Positive** path → check `adoption-adopt`. |
| `skew.nix` | **Negative** path → check `adoption-skew`. |
| `default.nix` | Aggregator — pins the `port` + `kavalTui` once, imports `lib.nix`, returns both checks. |

`../flake.nix` spreads both into `checks.x86_64-linux`, so they ride
`ci::home-manager` with no new CI recipe (see [Running](#running)).

## The two paths

### `adoption-adopt` — the daemon is adopted (positive)

1. boot kolu as a systemd **user service** (with **linger** — the survival
   precondition);
2. open a terminal over the **oRPC HTTP API** (`/rpc/terminal/create`, no browser);
3. run a command in it (`echo <nonce>`) whose unique output we record;
4. **`systemctl --user restart kolu`** — the *server* only; the kaval daemon
   lives in its own transient cgroup and survives;
5. assert the **same daemon** (gate pid), the **same PTY** (id + pid), the
   command's **output still in the scrollback**, *and* kolu's own **reconcile
   log** all survived → adoption, not a fresh respawn.

### `adoption-skew` — a contract-skewed survivor is recycled (negative)

When a redeploy **changes kaval's wire** (a `PTY_HOST_CONTRACT_VERSION` bump),
the surviving daemon is incompatible and must be **recycled, not adopted** — but
the saved session is left untouched so a restore is still offered.

There's no env seam for the contract version (it's a source constant read by
*both* the daemon and the server), so the "newer kolu" is a **second build** via
the test-only **`contractVersionOverride`** arg in the root `default.nix` (a
`postPatch` sed of the constant, guarded by a grep that fails the build if the
constant moves; `null` = no-op, real builds untouched). The test seeds a
terminal + a saved session on the old (3.0) daemon, stops the old server (the
daemon survives), then starts the bumped (9.0) server on the same port and
asserts the survivor was **recycled** (gate pid *changed*), the **skew was
logged**, *and* the session is **preserved**.

## Running

Linux-only (NixOS VM tests). A **KVM-capable** host runs them in ~seconds; a
host without KVM falls back to qemu TCG (~10× slower — the polls carry 180s
headroom for it).

```sh
# from this directory's parent (nix/home/example/), build kolu from the repo root:
nix build .#checks.x86_64-linux.adoption-adopt \
          .#checks.x86_64-linux.adoption-skew \
  --override-input kolu /path/to/kolu/repo -L
```

In CI this is automatic: `ci::home-manager` runs `devour-flake` over this example
flake (`--override-input flake/kolu .`), which realizes every
`checks.x86_64-linux.*` — so both VM tests build and run on the Linux lane.

> `adoption-skew` forces a **second full kolu build** (the contract-bumped
> `koluNew`), so it is the slow check. That cost is inherent — there is no
> cheaper way to produce a genuinely skewed wire.

## Why the scaffold looks the way it does

These are not stylistic choices — each guards a way the test would otherwise
*silently pass when it should fail*. Don't "simplify" them away:

- **Result file asserted as root.** `machinectl shell <script>` returns 0 once
  the session opens, **swallowing the script's own exit code**. So each
  seed/verify script (run as *alice*, for her `XDG_RUNTIME_DIR` / DBUS / journal)
  writes `OK`/`FAIL` to a result file, and the testScript asserts that file **as
  root** — whose exit the test driver *does* see. Without this, every assertion
  is ignored and the test can never fail.
- **Poll until *all* conditions hold at once.** A single-shot check races a slow
  recycle/adopt and passes on a transient state. Each verify loops until the full
  AND-chain holds; the wrong outcome never satisfies it and times out red.
- **`</dev/null` on every `machinectl`.** The driver's stdin pipe never EOFs, so
  without the redirect `machinectl` hangs even after the inner command exits — and
  a hung attempt stalls the whole lane. The in-guest `timeout` is the belt.
- **`linger = true`.** Without it, alice's user manager (and the kaval transient
  unit it owns) dies with `systemctl --user restart kolu`, so the test would
  silently exercise a *fresh spawn*, not adoption.
- **Runtime-layout literals are pinned to source** (`lib.nix`): the
  `kaval-<port>/` namespace, `kaval.pid` gate file, and `config.json` (the conf
  store's default filename — **not** `state.json`). If one drifts from what the
  daemon actually writes, the poll just times out and is mis-diagnosed.

## Verification

Every reviewer's edits were re-checked on the shipping tree on a KVM box:

| check | result |
| --- | --- |
| `adoption-adopt`, correct code | ✅ green (same PTY + scrollback survive) |
| `adoption-skew`, correct code | ✅ green (`gate 1284→1528`, skew logged, session preserved) |
| `adoption-skew`, `isContractVersionCompatible → true` mutation | ❌ red (`gate 1289→1289`, no skew, wrongly adopted) |

Each test is both **green on correct code and red under a deliberate mutation** —
proof the assertions actually bite. See #1349 and PR #1350.
