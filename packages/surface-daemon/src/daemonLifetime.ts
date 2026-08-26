/**
 * **The daemon LIFETIME leaf** — how long a daemon stays up, and the
 * serializable projection of that fact.
 *
 * Pure types and one exhaustive fold; no `node:`, no `effect`, no surface. It
 * sits apart from `daemonMain.ts` (which owns the gate → serve → teardown
 * skeleton it parameterizes) for one reason: `DaemonLifetimeInfo` is what a
 * daemon PUBLISHES about itself, so it is read by browser-safe vocabularies
 * downstream — `@kolu/padi-client/vocab` `satisfies`-pins its wire schema to
 * this type. Reaching it through this package's BARREL made that browser-safe
 * module compile `daemonMain`, `daemonProcessMain` and the whole process-signal
 * tier, which an out-of-repo consumer of padi's contract then had to install
 * and declare shims for (juspay/kolu#2216). `@kolu/padi-client`'s hydrate guard
 * recorded that barrel as a KNOWN cost with the fix named: leaf entries. This is
 * one of them.
 *
 * `daemonMain.ts` imports these and re-exports them, so the barrel's surface is
 * unchanged and every in-repo caller keeps its import.
 */

/** How long the daemon stays up once serving. `forever` waits for a signal or
 *  an external abort only; `idleTimeout` additionally shuts down after `ms` of
 *  continuous idleness (the daemon defines "idle" via `isIdle`); `boundToPid`
 *  additionally shuts down cleanly once the watched `pid` is gone — the daemon's
 *  reason to exist is the RUN that spawned it, so it dies with that run rather
 *  than outliving it (the test/smoke leak fix — a daemon detached+unref'd for
 *  survival must still die when its harness is gone). These are three honest
 *  constructors, not `forever` plus flags: a caller picks exactly one. The pid is
 *  watched by a portable `kill(pid, 0)` poll; a pid-reuse in the poll window is a
 *  documented residual, not engineered around (a fresh process inheriting the
 *  same pid would keep the daemon alive one extra run — vanishingly rare, and the
 *  cost is a single leaked run, not a class). */
export type DaemonLifetime =
  | { kind: "forever" }
  | { kind: "idleTimeout"; ms: number; isIdle: () => boolean }
  | { kind: "boundToPid"; pid: number; pollMs?: number };

/** The serializable projection of a {@link DaemonLifetime} — the same three
 *  kinds with the non-wire members dropped (`idleTimeout`'s `isIdle` closure,
 *  `boundToPid`'s test-only `pollMs`). This is what a daemon publishes about
 *  itself so a UI can show which lifetime it is running under (`forever` in
 *  production; `boundToPid` under a test/smoke run). Kept here, beside the union
 *  it projects, so the two can't drift; the wire schema is declared downstream
 *  in each surface's browser-safe vocab, `satisfies`-pinned to this. */
export type DaemonLifetimeInfo =
  | { kind: "forever" }
  | { kind: "idleTimeout"; ms: number }
  | { kind: "boundToPid"; pid: number };

/** Project a live {@link DaemonLifetime} to its serializable {@link
 *  DaemonLifetimeInfo} — drops the `isIdle` closure and the test-only `pollMs`,
 *  keeping only what a consumer can read off the wire. Exhaustive over the union
 *  (a new arm is a compile error here), so the projection can't silently omit a
 *  future lifetime. */
export function lifetimeInfo(lifetime: DaemonLifetime): DaemonLifetimeInfo {
  switch (lifetime.kind) {
    case "forever":
      return { kind: "forever" };
    case "idleTimeout":
      return { kind: "idleTimeout", ms: lifetime.ms };
    case "boundToPid":
      return { kind: "boundToPid", pid: lifetime.pid };
  }
  // Exhaustiveness fence, the file's own idiom (mirrors `daemonExitCode` and
  // `waitForShutdown`): a new `DaemonLifetime` kind compile-fails here (`lifetime
  // satisfies never`) until it joins a case above — so the projection can't
  // silently omit a future lifetime, without pulling a dispatch library into this
  // deliberately minimal-dependency spine.
  lifetime satisfies never;
}
