import type { Writable } from "node:stream";
import {
  type StdioReadinessVerdict,
  writeStdioReadiness,
} from "@kolu/surface/links/readiness";
import {
  type DaemonHomePaths,
  frontDaemonOverStdio,
  reExecAsDetachedDaemon,
  resolveDaemonHome,
} from "@kolu/surface-daemon";
import { Effect } from "effect";
import { convergeKavalStdioFront } from "./convergeFront.ts";
import {
  KAVAL_NS_PREFIX,
  kavalLogPath,
  PTY_HOST_SOCK_FILE,
} from "./socketPath.ts";

export class KavalStdioFrontRefused extends Error {
  readonly isKavalStdioFrontRefused = true as const;
  constructor(detail: string) {
    super(`refusing to relay — ${detail}`);
    this.name = "KavalStdioFrontRefused";
  }
}

export interface RunStdioBridgeOptions {
  socketOverride?: string;
}

export async function runStdioBridge(
  opts: RunStdioBridgeOptions = {},
): Promise<void> {
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
  return runStdioBridgeWith(opts, {
    converge: convergeKavalStdioFront({
      home,
      stderrLog: kavalLogPath(socketPath),
    }),
    stdout: process.stdout,
    relay: () =>
      frontDaemonOverStdio({
        socketPath,
        spawnDaemon: () =>
          reExecAsDetachedDaemon({
            stripArgs: ["--stdio"],
            stderrLog: kavalLogPath(socketPath),
          }),
        log: (msg) => process.stderr.write(`kaval --stdio: ${msg}\n`),
      }),
  });
}

export interface KavalStdioBridgeDeps {
  readonly converge: Effect.Effect<StdioReadinessVerdict, Error>;
  readonly stdout: Writable;
  readonly relay: () => Promise<void>;
}

export async function runStdioBridgeWith(
  _opts: RunStdioBridgeOptions,
  deps: KavalStdioBridgeDeps,
): Promise<void> {
  const verdict = await Effect.runPromise(deps.converge);
  writeStdioReadiness(deps.stdout, verdict);
  if (verdict.verdict === "refused") {
    throw new KavalStdioFrontRefused(verdict.detail);
  }
  return deps.relay();
}
