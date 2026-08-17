# @kolu/daemon-test-gate

The test-infrastructure leaf that makes it **structurally impossible** for a bare
`vitest` run to fork real daemons and OOM the workstation
([#1375](https://github.com/juspay/kolu/issues/1375)), or for a test to reach the
live production daemons through inherited env
([#1334](https://github.com/juspay/kolu/issues/1334)).

A **zero-production-dependency leaf**, consumed as a **devDependency only** by every
package whose tests fork real OS processes (the spawner set spans ten packages above
and below the daemon stack, so no domain-package home is legal without a workspace
cycle — a devDep arrow creates none). It is test infrastructure — a bounded gate,
never a volatility receptacle.

## Install

```jsonc
// package.json — devDependencies only
"@kolu/daemon-test-gate": "workspace:*"
```

Wire the per-worker env scrub once, in the package's `vitest.config.ts`:

```ts
export default defineConfig({ test: { setupFiles: ["@kolu/daemon-test-gate/setup"] } });
```

## Use

```ts
import { describeDaemon, assertDaemonSpawnAllowed } from "@kolu/daemon-test-gate";

// A describe block that only runs under KOLU_DAEMON_TESTS=1 (default OFF).
describeDaemon("real kaval boot", () => {
  it("adopts a live daemon", async () => { /* forks a real daemon */ });
});

// The runtime leash the spawn helpers call at the moment of a real fork —
// throws in a test context when the gate is OFF, so helper indirection can't
// smuggle a fork past the gate.
assertDaemonSpawnAllowed("a kaval daemon");
```

## Three spawn-gate primitives

- **`describeDaemon(name, fn)`** — a `describe` that runs only under `KOLU_DAEMON_TESTS=1`.
- **`assertDaemonSpawnAllowed(what?)`** — the runtime spawn leash (throws when gated OFF in a test context).
- **`./setup`** — the per-worker env scrub (blinds every worker to the production daemon locators + the `KOLU_ROLE` master key).

Run the gated suites with `just test-daemon` (CI/pu-only); a bare `pnpm test:unit`
stays fork-free by default.

## CI reap (`just _reap-ci-run`)

The same package ships the end-of-run janitor `test-daemon` and `just test`
trap on EXIT. It deletes leftover `padi-dial-rt-*` / `padi-dial-sr-*` /
`kolu-scroll-fifo-*` roots (killing FIFO `cat` readers first) and
SIGTERM→SIGKILLs leftover kaval/padi/node-pty helpers whose command names
one of those prefixes. A live `KOLU_DAEMON_BIND_PID` is left untouched
(a peer run). Production `forever` daemons never match those prefixes
and are not touched. Create sites import `PADI_DIAL_RT_PREFIX` /
`PADI_DIAL_SR_PREFIX` so the leftover class stays one string.
