/**
 * A REAL padi (which spawns its own kaval and PTYs), for the e2e pins in this
 * package — spawned, dialed, and REAPED by exact pid.
 *
 * The reaping discipline is why this is one module and not a copy per test
 * file. Three rules have to hold on every leg, and each has a real incident
 * behind it:
 *
 *   - **Never inherit the padi-selecting env.** These tests run inside a kolu
 *     terminal whose `$PADI_SOCKET` names the USER'S daemon; an inherited value
 *     points a leg at production.
 *   - **Bind the spawned daemons to the test process** (`KOLU_DAEMON_BIND_PID`),
 *     so a signal-killed run cannot leak them.
 *   - **Kill by EXACT pid** — the padi child handle, and the pid kaval's own gate
 *     file records — never by pattern. A marker match once killed every kaval on
 *     the box, production included.
 *
 * A second copy of that is a copy that drifts, and the drift leaks either the
 * user's daemon or a kaval per run. `.testlib.ts` because it FORKS REAL
 * PROCESSES: the gate's meta-lint reads the suffix, and every spawn goes through
 * `assertDaemonSpawnAllowed` so no indirection can smuggle one past
 * `KOLU_DAEMON_TESTS=1`.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  padiClientOver,
  padiSocketPath,
  resolvePadiStateRoot,
} from "@kolu/padi/dial";
import { padiKavalSocketPath } from "@kolu/padi/stateRoot";
import { padiDaemonGroup } from "@kolu/padi/surface";
import { assertDaemonSpawnAllowed } from "@kolu/daemon-test-gate";
import { unixSocketLink } from "@kolu/surface/links/unix-socket";
import { Effect } from "effect";

const SRC = dirname(fileURLToPath(import.meta.url));

/** padi's own entry, run under the tsx loader — the daemon a leg spawns. */
export const PADI_BIN = resolve(SRC, "../../padi/src/daemonBoot/bin.ts");
/** The `kolu` launcher, so a leg drives the SHIPPED binary rather than a
 *  re-composition of its parts. */
export const KOLU_MAIN = resolve(SRC, "main.ts");
export const TSX_LOADER = pathToFileURL(
  createRequire(import.meta.url).resolve("tsx"),
).href;

export const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/** Read ONE newline-terminated line off a pipe, or fail NAMING the unterminated
 *  bytes that did arrive.
 *
 *  Every live-feed pin in this package asks the same question — did the line
 *  reach the kernel without a later write behind it? — and the diagnosis is the
 *  reason this is not an inline promise: a bare timeout says "nothing in 8s",
 *  while the bytes say whether the payload was written and left unterminated
 *  (the one-event lag) or never written at all. The listener comes off on BOTH
 *  paths: a copy of this that only cleaned up on the timeout kept a `data`
 *  handler on a stream the test had finished with. */
export function readTerminatedLine(
  stream: NodeJS.ReadableStream,
  ms: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = "";
    const onData = (chunk: string | Buffer): void => {
      buf += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      const nl = buf.indexOf("\n");
      if (nl === -1) return;
      cleanup();
      resolve(buf.slice(0, nl + 1));
    };
    const t = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `no terminated line in ${ms}ms; unterminated bytes: ${JSON.stringify(buf)}`,
        ),
      );
    }, ms);
    const cleanup = (): void => {
      clearTimeout(t);
      stream.off("data", onData);
    };
    stream.setEncoding("utf8");
    stream.on("data", onData);
  });
}

export interface Padi {
  readonly child: ChildProcess;
  readonly exited: Promise<number | null>;
  readonly stateRoot: string;
  readonly socketPath: string;
}

/** One temp runtime root per test FILE — the state-root digest is what separates
 *  daemons, so legs in one file share a root and legs in another cannot collide.
 *  Returns the root plus the `beforeAll`/`afterAll` pair that points
 *  `XDG_RUNTIME_DIR` at it. */
export function e2eRuntimeRoot(tag: string): {
  root: string;
  enter(): void;
  leave(): void;
} {
  const root = mkdtempSync(join(tmpdir(), `kolu-${tag}-rt-`));
  let prior: string | undefined;
  return {
    root,
    enter() {
      prior = process.env.XDG_RUNTIME_DIR;
      process.env.XDG_RUNTIME_DIR = root;
    },
    leave() {
      process.env.XDG_RUNTIME_DIR = prior;
    },
  };
}

/** The env a spawned daemon or face gets: EXPLICIT for every padi-selecting var
 *  (see the header's first rule), plus whatever the leg adds. */
export function daemonEnv(
  runtimeRoot: string,
  extra: Record<string, string> = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    XDG_RUNTIME_DIR: runtimeRoot,
    KOLU_KAVAL_SPAWN: "detached",
    KOLU_DAEMON_BIND_PID: String(process.pid),
    ...extra,
  };
  delete env.INVOCATION_ID;
  delete env.KOLU_KAVAL_BIN;
  delete env.KOLU_KAVAL_SOCKET;
  delete env.KOLU_STATE_DIR;
  if (extra.PADI_SOCKET === undefined) delete env.PADI_SOCKET;
  return env;
}

export function spawnPadi(opts: {
  runtimeRoot: string;
  stateRoot: string;
  env?: Record<string, string>;
}): Padi {
  assertDaemonSpawnAllowed("a real padi daemon (node --import loader bin.ts)");
  const child = spawn(
    process.execPath,
    [
      "--import",
      TSX_LOADER,
      PADI_BIN,
      "--state-root",
      opts.stateRoot,
      // Inside the nix devshell padi refuses to spawn PTYs without the
      // whitelist (else the devshell env leaks into shells).
      "--allow-nix-shell-with-env-whitelist",
      "default",
    ],
    {
      stdio: ["ignore", "ignore", "ignore"],
      env: daemonEnv(opts.runtimeRoot, opts.env),
    },
  );
  return {
    child,
    exited: new Promise<number | null>((res) =>
      child.on("exit", (code) => res(code)),
    ),
    stateRoot: opts.stateRoot,
    socketPath: padiSocketPath(resolvePadiStateRoot(opts.stateRoot)),
  };
}

/** Poll-connect until padi answers a control-core `hello`, or fail loudly. */
export async function waitForPadi(
  socketPath: string,
  ms = 20000,
): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    let link: Awaited<ReturnType<typeof unixSocketLink>> | undefined;
    try {
      link = await unixSocketLink({ group: padiDaemonGroup, socketPath });
      await Effect.runPromise(
        padiClientOver(link.dispatch).control.surface.core.hello(),
      );
      return;
    } catch {
      await sleep(150);
    } finally {
      await link?.dispose();
    }
  }
  throw new Error(`padi socket never came up: ${socketPath}`);
}

/** The pid a gate file records, or undefined. */
function gatePid(gatePath: string): number | undefined {
  try {
    const pid = Number.parseInt(readFileSync(gatePath, "utf8").trim(), 10);
    return Number.isFinite(pid) ? pid : undefined;
  } catch {
    return undefined;
  }
}

/** Reap a padi AND the detached kaval it spawned — EXACT pids only (the padi
 *  child handle; the pid kaval's own gate file records), never a pattern. */
export async function reapPadi(p: Padi): Promise<void> {
  p.child.kill("SIGTERM");
  await p.exited;
  const kavalSocket = padiKavalSocketPath(resolvePadiStateRoot(p.stateRoot));
  const kavalPid = gatePid(join(dirname(kavalSocket), "kaval.pid"));
  if (kavalPid !== undefined) {
    try {
      process.kill(kavalPid, "SIGKILL");
    } catch {
      // Already gone — nothing to reap.
    }
  }
}
