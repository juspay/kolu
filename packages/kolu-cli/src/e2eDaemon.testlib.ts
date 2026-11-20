import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertDaemonSpawnAllowed } from "@kolu/daemon-test-gate";
import { padiKavalSocketPath } from "@kolu/padi/stateRoot";
import { padiClientOver } from "@kolu/padi-client/dial";
import {
  padiSocketPath,
  resolvePadiStateRoot,
} from "@kolu/padi-client/rendezvous";
import { padiDaemonGroup } from "@kolu/padi-client/surface";
import { unixSocketLink } from "@kolu/surface/links/unix-socket";
import { Effect } from "effect";

const SRC = dirname(fileURLToPath(import.meta.url));

export const PADI_BIN = resolve(SRC, "../../padi/src/daemonBoot/bin.ts");
export const KOLU_MAIN = resolve(SRC, "main.ts");
export const TSX_LOADER = pathToFileURL(
  createRequire(import.meta.url).resolve("tsx"),
).href;

export const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

export type LineRead =
  | { readonly kind: "line"; readonly line: string }
  | { readonly kind: "partial"; readonly bytes: string }
  | { readonly kind: "timeout" };

export function readTerminatedLine(
  stream: NodeJS.ReadableStream,
  ms: number,
): Promise<LineRead> {
  const { promise, resolve } = Promise.withResolvers<LineRead>();
  let buf = "";
  const onData = (chunk: string | Buffer): void => {
    buf += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    const nl = buf.indexOf("\n");
    if (nl === -1) return;
    cleanup();
    resolve({ kind: "line", line: buf.slice(0, nl + 1) });
  };
  const t = setTimeout(() => {
    cleanup();
    resolve(
      buf.length === 0 ? { kind: "timeout" } : { kind: "partial", bytes: buf },
    );
  }, ms);
  const cleanup = (): void => {
    clearTimeout(t);
    stream.off("data", onData);
  };
  stream.setEncoding("utf8");
  stream.on("data", onData);
  return promise;
}

export interface Padi {
  readonly child: ChildProcess;
  readonly exited: Promise<number | null>;
  readonly stateRoot: string;
  readonly socketPath: string;
}

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
      // DELETE restores an absent var — assigning the captured `undefined`
      // stamps the literal string "undefined" into every process spawned from
      // this worker afterwards.
      if (prior === undefined) delete process.env.XDG_RUNTIME_DIR;
      else process.env.XDG_RUNTIME_DIR = prior;
    },
  };
}

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

function gatePid(gatePath: string): number | undefined {
  try {
    const pid = Number.parseInt(readFileSync(gatePath, "utf8").trim(), 10);
    return Number.isFinite(pid) ? pid : undefined;
  } catch {
    return undefined;
  }
}

export async function reapPadi(p: Padi): Promise<void> {
  p.child.kill("SIGTERM");
  await p.exited;
  const kavalSocket = padiKavalSocketPath(resolvePadiStateRoot(p.stateRoot));
  const kavalPid = gatePid(join(dirname(kavalSocket), "kaval.pid"));
  if (kavalPid !== undefined) {
    try {
      process.kill(kavalPid, "SIGKILL");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ESRCH") throw err;
    }
  }
}
