/**
 * `padi --stdio` — front padi's durable daemon over a stdio byte bridge.
 *
 * The twin of `kaval/src/stdioBridge.ts`. The *mechanism* is the shared
 * `frontDaemonOverStdio` primitive — the durable counterpart to `serveOverStdio`,
 * homed in `@kolu/surface-daemon`. This module is the **padi-specific
 * composition** of it, supplying the two things the generic relay is parameterized
 * over:
 *
 *   - **the socket path** — padi's own digest-keyed rendezvous, resolved the SAME
 *     way `runPadiDaemon` does (`padiSocketPath(resolvePadiStateRoot(stateRoot),
 *     socketOverride)`), so the front and the daemon it fronts agree on the path;
 *   - **the daemon-spawn** — re-exec THIS `padi` binary minus `--stdio`, so the
 *     detached, gate-held daemon comes up to serve that same socket (the
 *     `reExecAsDetachedDaemon` invariant: the single-process `node --import` form
 *     so SIGTERM reaches the daemon, not a swallowing `tsx` fork). The re-exec'd
 *     daemon runs `runPadiDaemon`, which spawns/adopts its OWN kaval and serves
 *     `padiSurface` + the frozen control core — kaval rides inside padi's closure,
 *     so nothing else needs provisioning.
 *
 * W3.1's remote binding runs `ssh <host> padi --stdio` (via
 * `getHostSession({ host, binary: "padi", extraArgs: ["--stdio"] })`) and speaks
 * the combined `padiDaemonContract` (padiSurface + control core) over the relay;
 * the durable padi it fronts — and its kaval, and the PTYs — outlives the ssh
 * link, so a remote canvas survives detach → reattach exactly as `kaval-tui
 * --host` does for a bare PTY.
 */

import {
  frontDaemonOverStdio,
  reExecAsDetachedDaemon,
} from "@kolu/surface-daemon";
import type { Writable } from "node:stream";
import {
  type StdioReadinessVerdict,
  writeStdioReadiness,
} from "@kolu/surface/links/readiness";
import { Effect } from "effect";
import {
  padiSocketPath,
  padiStderrLogPath,
  resolvePadiStateRoot,
} from "../stateRoot.ts";
import { convergeStdioFront } from "./convergeFront.ts";

/** Raised when the pre-step refused: the front has already written its `refused`
 *  banner and must exit non-zero WITHOUT relaying. Distinct from a converge that
 *  threw, which reaches `bin.ts`'s one error channel as itself. */
export class PadiStdioFrontRefused extends Error {
  readonly isPadiStdioFrontRefused = true as const;
  constructor(detail: string) {
    super(`refusing to relay — ${detail}`);
    this.name = "PadiStdioFrontRefused";
  }
}

export interface RunPadiStdioBridgeOptions {
  /** The value of `--state-root`, threaded straight from `bin.ts`'s argv parse,
   *  so the front and the re-exec'd daemon resolve the SAME digest-keyed socket
   *  from the SAME token. When unset, `KOLU_PADI_STATE_DIR` is required (the
   *  nix-built padi wrapper supplies the production path on the remote host —
   *  juspay/kolu#1334; no silent code default). */
  stateRoot?: string;
  /** The value of `--socket` (rare override); the daemon's gate sits beside it. */
  socketOverride?: string;
}

/** Run the `--stdio` bridge: front padi's durable daemon over this process's
 *  stdio for the lifetime of the link. Resolves when the link ends; the daemon
 *  it fronts (and its kaval + PTYs) keeps running.
 *
 *  `async` so a missing-path throw from {@link resolvePadiStateRoot} rejects the
 *  promise and reaches `bin.ts`'s one error channel (sync throw would escape the
 *  `.catch` on a bare `runPadiStdioBridge(...).catch(...)` call).
 *
 *  CLI-only: `reExecAsDetachedDaemon` re-execs `process.argv` (minus `--stdio`),
 *  so the daemon serves the same `--state-root` / `--socket` ONLY because those
 *  tokens are still in argv (or the wrapper-set `KOLU_PADI_STATE_DIR` is inherited
 *  by the re-exec). Pass `stateRoot`/`socketOverride` here *without* a matching
 *  flag in argv and the daemon could bind a different root than the front —
 *  so don't call this off the CLI path; for a programmatic front, use
 *  `frontDaemonOverStdio` directly with a path-injecting `spawnDaemon`. */
export async function runPadiStdioBridge(
  opts: RunPadiStdioBridgeOptions = {},
): Promise<void> {
  const stateRoot = resolvePadiStateRoot(opts.stateRoot);
  const socketPath = padiSocketPath(stateRoot, opts.socketOverride);
  return runPadiStdioBridgeWith(opts, {
    converge: convergeStdioFront({
      stateRoot,
      socketOverride: opts.socketOverride,
    }),
    stdout: process.stdout,
    relay: () =>
      frontDaemonOverStdio({
        socketPath,
        // Start padi's own durable daemon: re-exec this binary minus `--stdio`. Any
        // `--state-root`/`--socket` ride through in `process.argv`, so the daemon
        // resolves the SAME path the front just did — load-bearing, and why this shim
        // is CLI-only (see the docstring). P0: this call site is DETACHING (nobody will hold the
        // child's stderr), so a crash-catcher file is mandatory here — `stderrLog` gives its raw
        // stderr a home (`padi.stderr.log`). The daemon's own entrypoint routes its pino stream to
        // `padi.log`; no flag to set. Without these a remote padi's whole log stream — incl. the
        // WAL-watcher lines — went to /dev/null, undiagnosable.
        spawnDaemon: () =>
          reExecAsDetachedDaemon({
            stripArgs: ["--stdio"],
            stderrLog: padiStderrLogPath(stateRoot),
          }),
        log: (msg) => process.stderr.write(`padi --stdio: ${msg}\n`),
      }),
  });
}

/** The three things the bridge's ORDERING is defined over, injected so the
 *  ordering can be pinned without forking a daemon or re-execing the test
 *  runner. NOT a production API — `runPadiStdioBridge` always supplies the real
 *  converge, the real stdout, and the real relay. */
export interface PadiStdioBridgeDeps {
  /** The converge-before-relay pre-step, as the verdict it answers with. */
  readonly converge: Effect.Effect<StdioReadinessVerdict, Error>;
  /** Where the banner goes — the wire. */
  readonly stdout: Writable;
  /** Engage the byte relay. Called ONLY after a `ready` banner. */
  readonly relay: () => Promise<void>;
}

/**
 * The bridge's ORDER, stated once (juspay/kolu#2101): **converge, then greet,
 * then relay — and on a refusal, greet and stop.**
 *
 * That order is the entire fix, so it lives in its own function rather than
 * inline in the CLI shim: every step is load-bearing and each has a way of being
 * silently wrong. Converging after the relay engages would be useless (the client
 * has already attached). Greeting before converging would certify a daemon nobody
 * checked. Relaying after a refusal would hand the client the stale daemon the
 * refusal exists to keep it away from — a fail-fast that does not actually stop.
 */
export async function runPadiStdioBridgeWith(
  _opts: RunPadiStdioBridgeOptions,
  deps: PadiStdioBridgeDeps,
): Promise<void> {
  // ── Converge BEFORE relaying ──────────────────────────────────────────────
  //
  // The full supervisor kit, run HERE on the box where the gate file, the pid
  // table and the signals live — the parity the remote arm shipped without. Only
  // once a padi of this epoch demonstrably holds the rendezvous does the front
  // greet and splice; a front that cannot converge says so on the wire and exits.
  //
  // THE PROCESS EDGE (governance: `packages/tests/governance/runEdges.ts`): the
  // convergence kit is Effect-native all the way down and this is a CLI entry
  // whose caller is `bin.ts`'s Promise `.catch`. There is nothing left to compose
  // into — the relay is Promise-shaped by `frontDaemonOverStdio`'s own contract —
  // so the crossing happens once, named, at the boundary.
  const verdict = await Effect.runPromise(deps.converge);
  // The banner is the FIRST thing on stdout either way. Written before the relay
  // takes stdout over, which is what makes it compatible with the byte-splice
  // guarantee: the front owns its stdout until `relay()` begins.
  writeStdioReadiness(deps.stdout, verdict);
  if (verdict.verdict === "refused") {
    // Rejecting (rather than writing stderr and exiting here) keeps `bin.ts`'s
    // ONE error channel the only place a `--stdio` front dies: it prints the
    // `padi --stdio:` line and exits non-zero. The structured evidence already
    // went to stderr from the converge itself.
    throw new PadiStdioFrontRefused(verdict.detail);
  }
  return deps.relay();
}
