/**
 * The REAL-padi e2e harness, shared by every kolu-cli suite that needs a live
 * daemon: spawn `padi` as an actual process under tsx's loader (the shipped
 * launcher shape), dial its digest-keyed socket, optionally serve the product's
 * OWN MCP composition over it, and reap padi AND the detached kaval it spawned.
 *
 * It exists because there were two byte-similar copies of this and a third was
 * about to appear. The parts are not incidental — the env scrub in
 * {@link daemonEnv} is what keeps a leg off the developer's PRODUCTION padi, and
 * the pid-exact {@link reap} is what keeps a signal-killed run from leaking
 * daemons — so a copy that drifts is a copy that quietly does one of those
 * wrong, in a suite whose failure mode is "it passed, on the wrong daemon".
 *
 * Hooks are registered by an explicit {@link setupPadiHarness} call rather than
 * by importing this module, so a suite's `beforeAll`/`afterEach` ordering stays
 * visible in the suite that owns it.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { padiSocketPath, resolvePadiStateRoot } from "@kolu/padi/dial";
import { padiKavalSocketPath } from "@kolu/padi/stateRoot";
import { padiDaemonGroup } from "@kolu/padi/surface";
import { padiClientOver } from "@kolu/padi/dial";
import { unixSocketLink } from "@kolu/surface/links/unix-socket";
import { assertDaemonSpawnAllowed } from "@kolu/daemon-test-gate";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Effect } from "effect";
import { serveKoluMcp } from "kolu-mcp";
import { afterAll, afterEach, beforeAll } from "vitest";
import { connectKoluCliLocal } from "./connect.ts";
import { guardedMcpDial, requireReachablePadi } from "./mcp.ts";

const SRC = dirname(fileURLToPath(import.meta.url));

/** padi's entrypoint, kept in step with the `padi` bin `package.json` declares.
 *  Exported because one leg spawns padi itself — over stdio rather than a socket
 *  — and must launch the SAME binary this harness does. */
export const PADI_BIN = resolve(SRC, "../../padi/src/daemonBoot/bin.ts");

/** The tsx loader, resolved the way the shipped launcher resolves it. */
export const TSX_LOADER = pathToFileURL(
  createRequire(import.meta.url).resolve("tsx"),
).href;

export const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

export interface Padi {
  child: ChildProcess;
  exited: Promise<number | null>;
  stateRoot: string;
  socketPath: string;
}

/** One suite's live harness. `startPadi` spawns and waits; everything it hands
 *  out is torn down by the hooks {@link setupPadiHarness} registered. */
export interface PadiHarness {
  /** A fresh private state-root under this suite's temp prefix. */
  makeStateRoot(): string;
  /** Spawn a padi (at `stateRoot`, or a fresh one) and wait for it to answer. */
  startPadi(stateRoot?: string): Promise<Padi>;
  /** The env a spawned daemon or face gets — the SCRUB, not a convenience. See
   *  the implementation's note: an inherited `$PADI_SOCKET` points a leg at the
   *  developer's production daemon. `extra` is layered on last. */
  daemonEnv(extra?: Record<string, string>): NodeJS.ProcessEnv;
  /** Register a padi this suite spawned ITSELF (the stdio leg) so it is reaped
   *  by the same pid-exact teardown as the rest. */
  adopt(padi: Padi): void;
  /** The product's own MCP composition over a running padi's socket. */
  serveMcpOverPadi(socketPath: string, clientName: string): Promise<Client>;
  /** Register a teardown to run before the daemons are reaped. */
  onCleanup(fn: () => Promise<void>): void;
}

/** Install the harness's hooks and hand back its verbs. Call ONCE at a suite's
 *  top level.
 *
 *  `prefix` names this suite's temp directories, so a leaked one is traceable to
 *  the suite that leaked it rather than to "some e2e". */
export function setupPadiHarness(prefix: string): PadiHarness {
  // Isolate every padi in this suite under ONE temp runtime root (the dial.test
  // precedent) — the state-root DIGEST is what separates daemons.
  const runtimeRoot = mkdtempSync(join(tmpdir(), `${prefix}-rt-`));
  const spawned: Padi[] = [];
  const cleanups: Array<() => Promise<void>> = [];
  let priorXdg: string | undefined;

  beforeAll(() => {
    priorXdg = process.env.XDG_RUNTIME_DIR;
    process.env.XDG_RUNTIME_DIR = runtimeRoot;
  });
  afterAll(() => {
    process.env.XDG_RUNTIME_DIR = priorXdg;
  });

  afterEach(async () => {
    for (const c of cleanups.splice(0).reverse()) {
      try {
        await c();
      } catch {
        // best-effort teardown; the reap below is the load-bearing one
      }
    }
    for (const p of spawned.splice(0)) {
      if (p.child.exitCode === null) await reap(p);
    }
  }, 30000);

  /** The env a spawned daemon gets: EXPLICIT, never a bare `...process.env` for
   *  the padi-selecting vars — this test process may itself run inside a kolu
   *  terminal whose `$PADI_SOCKET` names the developer's PRODUCTION padi, and an
   *  inherited value would point a leg at their real daemon. */
  const daemonEnv = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      XDG_RUNTIME_DIR: runtimeRoot,
      KOLU_KAVAL_SPAWN: "detached",
      // Bind the spawned daemons to THIS test process so a signal-killed run
      // can't leak them (they poll the pid and die when it is gone).
      KOLU_DAEMON_BIND_PID: String(process.pid),
      ...extra,
    };
    delete env.INVOCATION_ID;
    delete env.KOLU_KAVAL_BIN;
    delete env.KOLU_KAVAL_SOCKET;
    delete env.KOLU_STATE_DIR;
    // NEVER inherit the production padi's socket into a leg — unless the leg is
    // explicitly ABOUT a socket it named itself.
    if (extra.PADI_SOCKET === undefined) delete env.PADI_SOCKET;
    return env;
  };

  const spawnPadi = (stateRoot: string): Padi => {
    assertDaemonSpawnAllowed(
      "a real padi daemon (node --import loader bin.ts)",
    );
    const child = spawn(
      process.execPath,
      [
        "--import",
        TSX_LOADER,
        PADI_BIN,
        "--state-root",
        stateRoot,
        // Inside the nix devshell padi refuses to spawn PTYs without the
        // whitelist (else the devshell env leaks into the spawned shells).
        "--allow-nix-shell-with-env-whitelist",
        "default",
      ],
      { stdio: ["ignore", "ignore", "ignore"], env: daemonEnv() },
    );
    const exited = new Promise<number | null>((res) =>
      child.on("exit", (code) => res(code)),
    );
    const padi: Padi = {
      child,
      exited,
      stateRoot,
      socketPath: padiSocketPath(resolvePadiStateRoot(stateRoot)),
    };
    spawned.push(padi);
    return padi;
  };

  const makeStateRoot = (): string =>
    mkdtempSync(join(tmpdir(), `${prefix}-sr-`));

  return {
    makeStateRoot,
    daemonEnv,
    adopt: (padi) => spawned.push(padi),
    async startPadi(stateRoot) {
      const p = spawnPadi(stateRoot ?? makeStateRoot());
      await waitForPadi(p.socketPath);
      return p;
    },
    async serveMcpOverPadi(socketPath, clientName) {
      // The REAL local composition `runKoluMcp` wires — the product's own dial,
      // not a re-composition of its parts, so a leg cannot pass against a
      // look-alike that has drifted from what ships.
      const rawDial = connectKoluCliLocal({ kind: "socket", path: socketPath });
      // #2148 open gate — same arm as runKoluMcp; a missing padi never reaches serve.
      await Effect.runPromise(requireReachablePadi(rawDial));
      const dial = guardedMcpDial(rawDial);
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      const { close } = await serveKoluMcp({
        connect: () => Effect.runPromise(dial),
        serverInfo: { name: "kolu-mcp", version: "0.0.0-e2e" },
        transport: serverTransport,
      });
      const mcp = new Client({ name: clientName, version: "0.0.0" });
      await mcp.connect(clientTransport);
      cleanups.push(async () => {
        await mcp.close();
        await close();
      });
      return mcp;
    },
    onCleanup(fn) {
      cleanups.push(fn);
    },
  };
}

/** A dialed link over padi's WHOLE daemon group — one wire, both sibling faces
 *  built over its single tag-keyed dispatch by `padiClientOver`. */
type PadiLink = Awaited<ReturnType<typeof unixSocketLink>>;

/** Poll-connect until padi answers a control-core `hello`, or fail loudly.
 *  Internal: `startPadi` is the door, so a suite cannot wait on a padi this
 *  harness will not also reap. */
async function waitForPadi(socketPath: string, ms = 20000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    let link: PadiLink | undefined;
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

/** The pid a gate file records (decimal text), or undefined if unreadable. */
function gatePid(gatePath: string): number | undefined {
  try {
    const pid = Number.parseInt(readFileSync(gatePath, "utf8").trim(), 10);
    return Number.isFinite(pid) ? pid : undefined;
  } catch {
    return undefined;
  }
}

/** Reap a padi AND the detached kaval it spawned — EXACT pids only (the padi
 *  child handle; the pid kaval's own gate file records), never a pattern.
 *  Internal: teardown is the hooks' job, and a suite that reaped by hand would
 *  be the one that could forget to. */
async function reap(p: Padi): Promise<void> {
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

/** Unwrap a tool result's JSON payload, failing LOUD on `isError`. (The SDK's
 *  result type is a union with a task-result branch this server never emits —
 *  read it structurally.) */
export function toolJson(result: unknown): unknown {
  const r = result as { isError?: boolean; content?: { text: string }[] };
  const text = r.content?.[0]?.text;
  if (r.isError) throw new Error(`tool call failed: ${text}`);
  return JSON.parse(text ?? "null");
}

/** A tool result that MUST have failed — the message and (when the raiser
 *  tagged it) the structured detail an agent branches on. Fails the test if the
 *  call succeeded, so a refusal that stopped refusing cannot pass quietly. */
export function toolRefusal(result: unknown): {
  message: string;
  detail: unknown;
} {
  const r = result as {
    isError?: boolean;
    content?: { text: string }[];
    structuredContent?: unknown;
  };
  if (!r.isError)
    throw new Error(
      `expected a refusal; the tool succeeded: ${r.content?.[0]?.text}`,
    );
  return {
    message: r.content?.[0]?.text ?? "",
    detail: r.structuredContent,
  };
}

/** Read a resource and parse its JSON body. */
export async function readJson(mcp: Client, uri: string): Promise<unknown> {
  const { contents } = await mcp.readResource({ uri });
  return JSON.parse((contents[0] as { text: string }).text);
}
