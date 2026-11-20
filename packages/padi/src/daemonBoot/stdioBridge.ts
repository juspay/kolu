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

export class PadiStdioFrontRefused extends Error {
  readonly isPadiStdioFrontRefused = true as const;
  constructor(detail: string) {
    super(`refusing to relay — ${detail}`);
    this.name = "PadiStdioFrontRefused";
  }
}

export interface RunPadiStdioBridgeOptions {
  stateRoot?: string;
  socketOverride?: string;
}

export function repointSshAuthSockLink(opts: {
  readonly linkPath: string;
  readonly env: Record<string, string | undefined>;
}): void {
  const target = opts.env.SSH_AUTH_SOCK;
  if (target === undefined || target === "") return;
  if (statSync(target, { throwIfNoEntry: false }) === undefined) return;
  mkdirSync(dirname(opts.linkPath), { recursive: true, mode: 0o700 });
  const tmp = `${opts.linkPath}.kolu-tmp`;
  rmSync(tmp, { force: true });
  symlinkSync(target, tmp);
  renameSync(tmp, opts.linkPath);
}

export async function runPadiStdioBridge(
  opts: RunPadiStdioBridgeOptions = {},
): Promise<void> {
  const stateRoot = resolvePadiStateRoot(opts.stateRoot);
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
        spawnDaemon: () => spawnDetachedPadi(stateRoot),
        log: (msg) => process.stderr.write(`padi --stdio: ${msg}\n`),
      }),
  });
}

export interface PadiStdioBridgeDeps {
  readonly pointSshAuthSock: () => void;
  readonly converge: Effect.Effect<StdioReadinessVerdict, Error>;
  readonly stdout: Writable;
  readonly relay: () => Promise<void>;
}

export async function runPadiStdioBridgeWith(
  _opts: RunPadiStdioBridgeOptions,
  deps: PadiStdioBridgeDeps,
): Promise<void> {
  deps.pointSshAuthSock();
  const verdict = await Effect.runPromise(deps.converge);
  writeStdioReadiness(deps.stdout, verdict);
  if (verdict.verdict === "refused") {
    throw new PadiStdioFrontRefused(verdict.detail);
  }
  return deps.relay();
}
