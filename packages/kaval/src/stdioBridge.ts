/**
 * `kaval --stdio` — front kaval's durable daemon over a stdio byte bridge.
 *
 * The *mechanism* is the shared `frontDaemonOverStdio` primitive — the durable
 * counterpart to `serveOverStdio`, homed in `@kolu/surface-daemon` (P2.5). This
 * module is the **kaval-specific composition** of it, supplying the two things
 * the generic relay is parameterized over:
 *
 *   - **the socket path** — kaval's own rendezvous (`socketPath.ts`: the per-user
 *     default, or the `--socket` override / per-port kolu-server namespace);
 *   - **the daemon-spawn** — re-exec THIS `kaval` binary minus `--stdio`, so the
 *     detached, gate-held daemon comes up to serve that same socket (the
 *     `reExecAsDetachedDaemon` invariant: the single-process `node --import` form
 *     so SIGTERM reaches the daemon, not a swallowing `tsx` fork).
 *
 * R-2's `kaval-tui --host` runs `ssh <host> kaval --stdio` and speaks
 * `ptyHostSurface` over the relay; the daemon it fronts outlives the link, so a
 * remote PTY survives detach → reattach.
 */

import {
  type DaemonHomePaths,
  frontDaemonOverStdio,
  reExecAsDetachedDaemon,
  resolveDaemonHome,
} from "@kolu/surface-daemon";
import { writeStdioReadiness } from "@kolu/surface/links/readiness";
import { Effect } from "effect";
import { convergeKavalStdioFront } from "./convergeFront.ts";
import {
  KAVAL_NS_PREFIX,
  kavalLogPath,
  PTY_HOST_SOCK_FILE,
} from "./socketPath.ts";

/** Raised when the pre-step refused: the front has already written its `refused`
 *  banner and must exit non-zero WITHOUT relaying. */
export class KavalStdioFrontRefused extends Error {
  readonly isKavalStdioFrontRefused = true as const;
  constructor(detail: string) {
    super(`refusing to relay — ${detail}`);
    this.name = "KavalStdioFrontRefused";
  }
}

export interface RunStdioBridgeOptions {
  /** The value of `--socket`, threaded straight from `bin.ts`'s argv parse, so
   *  the front and the re-exec'd daemon resolve the SAME path from the SAME
   *  token. Default (`undefined`): kaval's own namespace.
   *
   *  This is the kaval `--stdio` CLI shim, not a general-purpose entry: the
   *  spawn re-execs `process.argv` (minus `--stdio`), so the daemon serves the
   *  override ONLY because `--socket PATH` is still in argv. Pass `socketOverride`
   *  *without* a matching `--socket` in argv and the daemon would bind the
   *  default while the front waits on the override — so don't call this off the
   *  CLI path; for a programmatic front, use `frontDaemonOverStdio` directly and
   *  supply a `spawnDaemon` that injects the path. */
  socketOverride?: string;
}

/** Run the `--stdio` bridge: front kaval's durable daemon over this process's
 *  stdio for the lifetime of the link. Resolves when the link ends; the daemon
 *  it fronts keeps running. CLI-only — see `socketOverride`. */
export async function runStdioBridge(
  opts: RunStdioBridgeOptions = {},
): Promise<void> {
  // Resolve the HOME (gate + socket co-located), not a loose socket string: the
  // convergence kit reads the gate beside the socket, and hand-joining the pair
  // at two sites is how the two drift apart. An explicit `--socket` rides through
  // as the override so both halves still come from one resolve.
  const home: DaemonHomePaths = resolveDaemonHome({
    app: KAVAL_NS_PREFIX,
    placement: "runtime",
    socketFile: PTY_HOST_SOCK_FILE,
    socketOverride:
      opts.socketOverride !== undefined && opts.socketOverride !== ""
        ? opts.socketOverride
        : undefined,
  });
  const socketPath = home.socketPath;

  // ── Converge BEFORE relaying (juspay/kolu#2101) ───────────────────────────
  //
  // The same pre-step padi's front runs, for the same reason: the front is always
  // of the CURRENT epoch, so greeting `ready` without converging would certify a
  // daemon nobody checked. THE PROCESS EDGE (governance:
  // `packages/tests/governance/runEdges.ts`) — the kit is Effect-native all the
  // way down and this is a CLI entry whose caller is `bin.ts`'s Promise `.catch`;
  // the relay below is Promise-shaped by `frontDaemonOverStdio`'s own contract, so
  // there is nothing left to compose into.
  const verdict = await Effect.runPromise(
    convergeKavalStdioFront({ home, stderrLog: kavalLogPath(socketPath) }),
  );
  // The banner is the FIRST thing on stdout, written while the front still owns
  // it — before `relay()` takes it over.
  writeStdioReadiness(process.stdout, verdict);
  if (verdict.verdict === "refused") {
    throw new KavalStdioFrontRefused(verdict.detail);
  }

  return frontDaemonOverStdio({
    socketPath,
    // Start kaval's own durable daemon: re-exec this binary minus `--stdio`.
    // `--socket PATH` (if any) rides through in `process.argv`, so the daemon
    // resolves the SAME path the front just did — load-bearing, and why this
    // shim is CLI-only (see `socketOverride`).
    // `stderrLog` gives the DETACHED daemon a real log sink beside its socket (P0) — else
    // a detached kaval's whole log stream went to /dev/null.
    spawnDaemon: () =>
      reExecAsDetachedDaemon({
        stripArgs: ["--stdio"],
        stderrLog: kavalLogPath(socketPath),
      }),
    log: (msg) => process.stderr.write(`kaval --stdio: ${msg}\n`),
  });
}
