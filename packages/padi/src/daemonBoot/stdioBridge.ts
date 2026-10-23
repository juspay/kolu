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
 *
 * ## The forwarded ssh-agent link (juspay/kolu#2313)
 *
 * sshd execs THIS process with `SSH_AUTH_SOCK` naming a per-link socket under
 * `/tmp/ssh-XXXX/`, deleted when the session closes. The daemon and every PTY it
 * spawns outlive the session, so that path is worthless to them — the first link's
 * value used to be frozen onto every terminal, and `git push` over a remote host
 * failed `Permission denied (publickey)` from the second link onwards.
 *
 * The bridge is the only process that knows a link's LIVE socket, so it is the
 * producer: before converging, {@link repointSshAuthSockLink} atomically points
 * the stable `ssh-auth.sock` link in the daemon's runtime home
 * ({@link padiSshAuthSockPath}) at this link's socket. Every terminal then carries
 * the LINK (the spawn path, `ptyHost/index.ts`), which follows whichever session
 * currently holds the agent — so reconnecting heals already-open shells too. The
 * link is never removed on exit: another concurrent link may own it, and a
 * dangling link is the honest "no agent right now".
 */

import { mkdirSync, renameSync, rmSync, statSync, symlinkSync } from "node:fs";
import { dirname } from "node:path";
import type { Writable } from "node:stream";
import {
  padiRuntimeHome,
  resolvePadiStateRoot,
} from "@kolu/padi-client/rendezvous";
import {
  type StdioReadinessVerdict,
  writeStdioReadiness,
} from "@kolu/surface/links/readiness";
import { frontDaemonOverStdio } from "@kolu/surface-daemon";
import { Effect } from "effect";
import { padiSshAuthSockPath } from "../stateRoot.ts";
import { convergeStdioFront } from "./convergeFront.ts";
import { spawnDetachedPadi } from "./detachedDaemon.ts";

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

/** Point padi's stable ssh-agent link at the socket `env.SSH_AUTH_SOCK` names —
 *  the producer half of the link (this module's header, #2313).
 *
 *  Atomic via the `current`-link idiom (`agentToolsBake.ts`): symlink to
 *  `<link>.kolu-tmp`, then `renameSync` over the link, so a spawn concurrent with
 *  a reconnect never sees a half-written link.
 *
 *  Two sanctioned no-ops, and neither unlinks anything: the env names no socket
 *  (this link forwarded no agent), or the named target is absent (`stat` follows
 *  symlinks, so a socket sshd already removed reads as gone). Another concurrent
 *  link may own the existing link, so `env: {}` is not evidence it should go. */
export function repointSshAuthSockLink(opts: {
  readonly linkPath: string;
  readonly env: Record<string, string | undefined>;
}): void {
  const target = opts.env.SSH_AUTH_SOCK;
  if (target === undefined || target === "") return;
  if (statSync(target, { throwIfNoEntry: false }) === undefined) return;
  // The link lives in padi's runtime home, which the converge may not have
  // materialized yet on a host's first-ever link. 0700 is the same owner-only
  // boundary `daemonHome` verifies and `writeAgentToolsBakeRecord` writes.
  mkdirSync(dirname(opts.linkPath), { recursive: true, mode: 0o700 });
  const tmp = `${opts.linkPath}.kolu-tmp`;
  rmSync(tmp, { force: true });
  symlinkSync(target, tmp);
  renameSync(tmp, opts.linkPath);
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
  // ONE home for this front: the socket it fronts anchors the ssh-agent link
  // beside it, resolved from the same state-root/override pair.
  const home = padiRuntimeHome(stateRoot, opts.socketOverride);
  return runPadiStdioBridgeWith(opts, {
    converge: convergeStdioFront({
      stateRoot,
      socketOverride: opts.socketOverride,
    }),
    stdout: process.stdout,
    pointSshAuthSock: () =>
      repointSshAuthSockLink({
        linkPath: padiSshAuthSockPath(home.socketPath),
        env: process.env,
      }),
    relay: () =>
      frontDaemonOverStdio({
        socketPath: home.socketPath,
        // Start padi's own durable daemon: re-exec this binary minus `--stdio`. Any
        // `--state-root`/`--socket` ride through in `process.argv`, so the daemon
        // resolves the SAME path the front just did — load-bearing, and why this shim
        // is CLI-only (see the docstring). The env scrub (`SSH_AUTH_SOCK` OUT) and the
        // mandatory crash-catcher stderr log both live in `spawnDetachedPadi`, the one
        // path BOTH re-exec sites take — see `detachedDaemon.ts`.
        spawnDaemon: () => spawnDetachedPadi(stateRoot),
        log: (msg) => process.stderr.write(`padi --stdio: ${msg}\n`),
      }),
  });
}

/** The steps the bridge's ORDERING is defined over, injected so the ordering can
 *  be pinned without forking a daemon or re-execing the test runner. NOT a
 *  production API — `runPadiStdioBridge` always supplies the real converge, the
 *  real stdout, the real ssh-auth link repoint, and the real relay. */
export interface PadiStdioBridgeDeps {
  /** Repoint the stable ssh-agent link at this link's live socket
   *  ({@link repointSshAuthSockLink} in production). Runs BEFORE the converge,
   *  which may spawn the daemon whose terminals will read the link. */
  readonly pointSshAuthSock: () => void;
  /** The converge-before-relay pre-step, as the verdict it answers with. */
  readonly converge: Effect.Effect<StdioReadinessVerdict, Error>;
  /** Where the banner goes — the wire. */
  readonly stdout: Writable;
  /** Engage the byte relay. Called ONLY after a `ready` banner. */
  readonly relay: () => Promise<void>;
}

/**
 * The bridge's ORDER, stated once (juspay/kolu#2101): **register the link's agent,
 * then converge, then greet, then relay — and on a refusal, greet and stop.**
 *
 * That order is the entire fix, so it lives in its own function rather than
 * inline in the CLI shim: every step is load-bearing and each has a way of being
 * silently wrong. Registering the ssh-agent link (juspay/kolu#2313) comes FIRST,
 * before the converge can spawn the daemon: a daemon spawned by this converge may
 * spawn a terminal the instant it serves, and that terminal must already read the
 * link this bridge just pointed at its socket. Converging after the relay engages
 * would be useless (the client has already attached). Greeting before converging
 * would certify a daemon nobody checked. Relaying after a refusal would hand the
 * client the stale daemon the refusal exists to keep it away from — a fail-fast
 * that does not actually stop.
 */
export async function runPadiStdioBridgeWith(
  _opts: RunPadiStdioBridgeOptions,
  deps: PadiStdioBridgeDeps,
): Promise<void> {
  // ── This link's ssh-agent socket, before anything can spawn a terminal ─────
  deps.pointSshAuthSock();
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
