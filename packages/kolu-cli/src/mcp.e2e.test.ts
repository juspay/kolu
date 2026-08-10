/**
 * The `kolu mcp` pin — the graduation proof's HEADLESS leg (the kolu-cli plan,
 * PR2). A REAL spawned padi (which spawns its own kaval + PTYs), driven by a
 * REAL MCP client, over BOTH transports:
 *
 *   - **unix socket**: the full `kolu mcp` SUBPROCESS (tsx over `main.ts`,
 *     the shipped launcher shape) speaking MCP over its stdio — the exact
 *     process an agent's `claude mcp add` runs;
 *   - **ssh-shaped stdio**: a `padi --stdio` child (the byte path `ssh <host>
 *     padi --stdio` carries — ssh adds no framing) dialed through the SAME
 *     gate composition the `--host` arm uses (stdioLink → both sibling faces
 *     over its one dispatch → control-core hello →
 *     `assertPadiSurfaceCompatible` → scope), served in-process over an
 *     in-memory MCP pair.
 *
 * The flow each leg proves: create → sendInput (text, then Enter as its OWN
 * send) → wait_outputSettled (consuming the terminalAttach stream — watched,
 * never rendered) → screen_text → kill → the tile leaves the roster. This can
 * only pass through the named path — padiSurface consumed through the surface
 * client, terminalAttach included, with no kolu-server process anywhere.
 *
 * Plus the RESTART legs (the "Across padi/kaval restarts" discipline):
 * kaval recycle (ids survive), padi restart mid-subscribe (the in-gap tool
 * call fails TYPED and queues nothing; the id survives the warm rebind; the
 * subscribed resource re-seeds with a fresh snapshot notification) — and a
 * restart across an IDLE gap, where the agent's FIRST request after the restart
 * must simply work (juspay/kolu#2082: it used to be the one the adapter spent
 * discovering the socket had died).
 */

import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertPadiSurfaceCompatible,
  padiClientOver,
  padiSocketPath,
  resolvePadiStateRoot,
  scopePadiSurface,
} from "@kolu/padi/dial";
import { padiKavalSocketPath } from "@kolu/padi/stateRoot";
import { padiDaemonGroup } from "@kolu/padi/surface";
import { awaitStdioReadiness } from "@kolu/surface/links/readiness";
import { stdioLink } from "@kolu/surface/links/stdio";
import { unixSocketLink } from "@kolu/surface/links/unix-socket";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { serveKoluMcp } from "kolu-mcp";
import {
  assertDaemonSpawnAllowed,
  describeDaemon,
} from "@kolu/daemon-test-gate";
import { Effect } from "effect";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { connectKoluCliLocal } from "./connect.ts";
import { guardedMcpDial } from "./mcp.ts";

const SRC = dirname(fileURLToPath(import.meta.url));
const PADI_BIN = resolve(SRC, "../../padi/src/daemonBoot/bin.ts");
const KOLU_MAIN = resolve(SRC, "main.ts");
const TSX_LOADER = pathToFileURL(
  createRequire(import.meta.url).resolve("tsx"),
).href;

// Isolate every padi in this file under ONE temp runtime root (the dial.test
// precedent) — the state-root digest is what separates daemons.
const RUNTIME_ROOT = mkdtempSync(join(tmpdir(), "kolu-mcp-e2e-rt-"));
const priorXdg = process.env.XDG_RUNTIME_DIR;
beforeAll(() => {
  process.env.XDG_RUNTIME_DIR = RUNTIME_ROOT;
});
afterAll(() => {
  process.env.XDG_RUNTIME_DIR = priorXdg;
});

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

interface Padi {
  child: ChildProcess;
  exited: Promise<number | null>;
  stateRoot: string;
  socketPath: string;
}

const spawned: Padi[] = [];

/** The env a spawned daemon/face gets: EXPLICIT, never `...process.env` for
 *  the padi-selecting vars — this test process runs inside a kolu terminal
 *  whose `$PADI_SOCKET` names the PRODUCTION padi, and an inherited value
 *  would point a leg at the user's real daemon. */
function daemonEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    XDG_RUNTIME_DIR: RUNTIME_ROOT,
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
  // NEVER inherit the production padi's socket into a leg.
  if (extra.PADI_SOCKET === undefined) delete env.PADI_SOCKET;
  return env;
}

function spawnPadi(stateRoot: string): Padi {
  assertDaemonSpawnAllowed("a real padi daemon (node --import loader bin.ts)");
  const child = spawn(
    process.execPath,
    [
      "--import",
      TSX_LOADER,
      PADI_BIN,
      "--state-root",
      stateRoot,
      // Inside the nix devshell padi refuses to spawn PTYs without the
      // whitelist (else the devshell env leaks into shells).
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
}

/** A dialed link over padi's WHOLE daemon group — one wire, both sibling faces
 *  built over its single tag-keyed dispatch by `padiClientOver`. */
type PadiLink = Awaited<ReturnType<typeof unixSocketLink>>;

/** Poll-connect until padi answers a control-core `hello`, or fail loudly. */
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

async function startPadi(stateRoot: string): Promise<Padi> {
  const p = spawnPadi(stateRoot);
  await waitForPadi(p.socketPath);
  return p;
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

const cleanups: Array<() => Promise<void>> = [];
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

const makeStateRoot = (): string =>
  mkdtempSync(join(tmpdir(), "kolu-mcp-e2e-sr-"));

// ── MCP result plumbing ───────────────────────────────────────────────────

/** Unwrap a tool result's JSON payload, failing LOUD on isError. (The SDK's
 *  result type is a union with a task-result branch this server never emits —
 *  read it structurally.) */
function toolJson(result: unknown): unknown {
  const r = result as { isError?: boolean; content?: { text: string }[] };
  const text = r.content?.[0]?.text;
  if (r.isError) {
    throw new Error(`tool call failed: ${text}`);
  }
  return JSON.parse(text ?? "null");
}

/** Read a resource and parse its JSON body. */
async function readJson(mcp: Client, uri: string): Promise<unknown> {
  const { contents } = await mcp.readResource({ uri });
  return JSON.parse((contents[0] as { text: string }).text);
}

/** The REAL local composition behind a connected MCP client:
 *  `connectKoluCliLocal` → `guardedMcpDial` → `serveKoluMcp`, re-dialing the
 *  SAME digest-keyed path on every invocation (the adapter's redial hook), with
 *  the Promise crossing where `runKoluMcp` puts it.
 *
 *  It drives the product's OWN dial rather than a re-composition of its parts:
 *  `connectKoluCliLocal` now takes the endpoint (`kolu mcp --socket <path>` is
 *  spellable), so the leg that used to rebuild `connectPadi` +
 *  `koluCliConnectionOf` by hand can simply BE the product path — including
 *  that projection, whose forgetting-to-carry-`onClose` failure is precisely
 *  juspay/kolu#2082. A look-alike could drift from the product; this cannot. */
async function serveMcpOverPadi(
  socketPath: string,
  clientName: string,
): Promise<Client> {
  const dial = guardedMcpDial(
    connectKoluCliLocal({ kind: "socket", path: socketPath }),
  );
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
}

// ── The round-trip each transport leg must prove ──────────────────────────

const SENTINEL = "MCP2-PIN-OK";

async function driveTerminalRoundTrip(mcp: Client): Promise<void> {
  // create — the returned TerminalInfo carries the id the driver captures.
  const created = toolJson(
    await mcp.callTool({ name: "lifecycle_create", arguments: {} }),
  ) as { id: string; pid: number };
  expect(created.id).toBeTruthy();
  const id = created.id;

  // The skills' three-step submit: text … settle … Enter (its OWN send).
  toolJson(
    await mcp.callTool({
      name: "lifecycle_sendInput",
      arguments: { id, text: `echo ${SENTINEL}` },
    }),
  );
  const settled1 = toolJson(
    await mcp.callTool({
      name: "wait_outputSettled",
      arguments: { id, idleMs: 800, timeoutMs: 30000 },
    }),
  ) as { result: string };
  expect(settled1.result).toBe("met");

  toolJson(
    await mcp.callTool({
      name: "lifecycle_sendInput",
      arguments: { id, key: "Enter" },
    }),
  );
  const settled2 = toolJson(
    await mcp.callTool({
      name: "wait_outputSettled",
      arguments: { id, idleMs: 800, timeoutMs: 30000 },
    }),
  ) as { result: string };
  expect(settled2.result).toBe("met");

  // The snapshot face shows the echoed sentinel (the command ran).
  const screen = toolJson(
    await mcp.callTool({ name: "screen_text", arguments: { id, tail: 50 } }),
  ) as string;
  expect(screen).toContain(SENTINEL);

  // kill → the tile leaves the roster (poll briefly; removal is async).
  toolJson(await mcp.callTool({ name: "lifecycle_kill", arguments: { id } }));
  const deadline = Date.now() + 10000;
  let keys: string[] = [];
  while (Date.now() < deadline) {
    keys = (await readJson(mcp, "surface://collections/terminals")) as string[];
    if (!keys.includes(id)) return;
    await sleep(200);
  }
  throw new Error(`terminal ${id} never left the roster: ${keys.join(", ")}`);
}

// ── Leg 1: the unix socket, through the REAL `kolu mcp` subprocess ────────

describeDaemon("kolu mcp — the headless graduation pin", () => {
  it("unix socket: the full round-trip through a real `kolu mcp` process", {
    timeout: 120000,
  }, async () => {
    const p = await startPadi(makeStateRoot());
    // ProcessEnv → Record<string,string> (drop undefined) for the SDK.
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(
      daemonEnv({ PADI_SOCKET: p.socketPath }),
    )) {
      if (v !== undefined) env[k] = v;
    }
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", TSX_LOADER, KOLU_MAIN, "mcp"],
      env,
      stderr: "inherit",
    });
    const mcp = new Client({ name: "pin-client", version: "0.0.0" });
    await mcp.connect(transport);
    cleanups.push(async () => {
      await mcp.close();
    });

    await driveTerminalRoundTrip(mcp);
  });

  // ── Leg 2: the ssh-shaped stdio transport (`padi --stdio`) ──────────────
  it("ssh stdio: the same round-trip over `padi --stdio` through the --host gate composition", {
    timeout: 120000,
  }, async () => {
    const stateRoot = makeStateRoot();
    // The child `ssh <host> padi --stdio` would run on the remote — spawn it
    // directly: ssh adds no framing, so this IS the transport's byte path.
    const child = spawn(
      process.execPath,
      [
        "--import",
        TSX_LOADER,
        PADI_BIN,
        "--stdio",
        "--state-root",
        stateRoot,
        "--allow-nix-shell-with-env-whitelist",
        "default",
      ],
      { stdio: ["pipe", "pipe", "ignore"], env: daemonEnv() },
    );
    const exited = new Promise<number | null>((res) =>
      child.on("exit", (code) => res(code)),
    );
    spawned.push({
      child,
      exited,
      stateRoot,
      socketPath: padiSocketPath(resolvePadiStateRoot(stateRoot)),
    });

    // The --host arm's gate composition, verbatim minus the nix provisioning
    // (dialAgentOnce's ssh/realise plumbing is proven in surface-remote):
    // stdioLink over the child's stdio → both sibling faces over its ONE
    // dispatch → frozen hello → the SAME compatibility gate → scope.
    if (child.stdout === null || child.stdin === null) {
      throw new Error("padi --stdio child has no stdio pipes");
    }
    // The REAL gate over the REAL front (juspay/kolu#2101): `padi --stdio`
    // converges its durable daemon and only then greets, so this proof is
    // evidence the far side settled — exactly what the `--host` arm now awaits.
    const readiness = await awaitStdioReadiness({
      read: child.stdout,
      deadlineMs: 60_000,
      describe: "padi --stdio child",
    });
    const link = await stdioLink({
      group: padiDaemonGroup,
      read: child.stdout,
      write: child.stdin,
      readiness,
    });
    // The link owns protocol fibers now — releasing it is the ONLY thing that
    // frees them, so it is a cleanup, not something the child's death covers.
    cleanups.push(async () => {
      await link.dispose();
    });
    const combined = padiClientOver(link.dispatch);
    const hello = await (async () => {
      // padi --stdio waits for its durable daemon to come up; poll hello.
      const deadline = Date.now() + 20000;
      for (;;) {
        try {
          return await Effect.runPromise(combined.control.surface.core.hello());
        } catch (err) {
          if (Date.now() > deadline) throw err;
          await sleep(200);
        }
      }
    })();
    assertPadiSurfaceCompatible(hello.surfaceVersion);
    const client = scopePadiSurface(combined);

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const { close } = await serveKoluMcp({
      connect: async () => ({ client, dispose: () => {} }),
      serverInfo: { name: "kolu-mcp", version: "0.0.0-e2e" },
      transport: serverTransport,
    });
    const mcp = new Client({ name: "pin-client-ssh", version: "0.0.0" });
    await mcp.connect(clientTransport);
    cleanups.push(async () => {
      await mcp.close();
      await close();
    });

    await driveTerminalRoundTrip(mcp);
  });

  // ── Leg 3: the restart discipline ────────────────────────────────────────
  it("restarts: kaval recycle + padi restart mid-subscribe — ids survive, in-gap fails typed, resources re-seed", {
    timeout: 180000,
  }, async () => {
    const stateRoot = makeStateRoot();
    const p = await startPadi(stateRoot);
    const socketPath = p.socketPath;

    const mcp = await serveMcpOverPadi(socketPath, "pin-client-restart");

    // A terminal to survive the restarts.
    const created = toolJson(
      await mcp.callTool({ name: "lifecycle_create", arguments: {} }),
    ) as { id: string };
    const id = created.id;

    // Subscribe the roster and count re-seed notifications.
    let updates = 0;
    mcp.setNotificationHandler(ResourceUpdatedNotificationSchema, (n) => {
      if (n.params.uri === "surface://collections/terminals") updates += 1;
    });
    await mcp.subscribeResource({
      uri: "surface://collections/terminals",
    });

    // (a) kaval recycle — session-preserving by contract: the id survives.
    {
      const supervisor = await unixSocketLink({
        group: padiDaemonGroup,
        socketPath,
      });
      try {
        await Effect.runPromise(
          padiClientOver(
            supervisor.dispatch,
          ).padi.surface.lifecycle.recycleKaval(undefined),
        );
      } finally {
        await supervisor.dispose();
      }
      const deadline = Date.now() + 30000;
      for (;;) {
        const keys = (await readJson(
          mcp,
          "surface://collections/terminals",
        )) as string[];
        if (keys.includes(id)) break;
        if (Date.now() > deadline) {
          throw new Error(`id ${id} did not survive the kaval recycle`);
        }
        await sleep(300);
      }
    }

    // The generation before the restart — `identity.startedAt` is padi's
    // own boot time, exposed so an agent can SEE "the daemon restarted
    // under me" (the restart is data, not an anomaly).
    const identityBefore = (await readJson(
      mcp,
      "surface://cells/identity",
    )) as { startedAt: number };

    // (b) padi restart mid-subscribe.
    p.child.kill("SIGTERM");
    await p.exited;

    // In the gap: a tool call fails FAST and TYPED — nothing queues. The
    // first call may surface the dying shared socket; the retry must carry
    // the named transport-down prefix from the redial path.
    const inGap = async (): Promise<string> => {
      const result = (await mcp.callTool({
        name: "screen_text",
        arguments: { id, tail: 5 },
      })) as { isError?: boolean; content?: { text: string }[] };
      expect(result.isError).toBe(true);
      return result.content?.[0]?.text ?? "";
    };
    await inGap();
    const secondFailure = await inGap();
    expect(secondFailure).toContain("padi transport down");

    const updatesBeforeRespawn = updates;

    // Respawn the SAME state-root: the warm path — kaval kept the PTYs, the
    // restarted padi re-binds them, the id stays valid.
    const p2 = spawnPadi(stateRoot);
    await waitForPadi(p2.socketPath);

    // The id survives the warm rebind, reachable through the SAME MCP face.
    {
      const deadline = Date.now() + 30000;
      for (;;) {
        try {
          const keys = (await readJson(
            mcp,
            "surface://collections/terminals",
          )) as string[];
          if (keys.includes(id)) break;
        } catch {
          // the shared conn may still be re-dialing — that's the point
        }
        if (Date.now() > deadline) {
          throw new Error(`id ${id} did not survive the padi restart`);
        }
        await sleep(300);
      }
    }

    // The subscription re-seeded: the pusher re-attached and pushed a fresh
    // snapshot notification (never a spliced delta).
    {
      const deadline = Date.now() + 30000;
      while (updates <= updatesBeforeRespawn) {
        if (Date.now() > deadline) {
          throw new Error(
            "no resources/updated re-seed after the padi restart",
          );
        }
        await sleep(300);
      }
    }

    // The id survived as the honest PARKED projection: the restarted padi
    // parks the persisted session for the restore decision (session.restore
    // is a named DENIAL — waking it is the human's verb, never the agent's),
    // while kaval keeps holding the PTY.
    const item = (await readJson(
      mcp,
      `surface://collections/terminals/${id}`,
    )) as { state: string };
    expect(item.state).toBe("parked");

    // And the restart is VISIBLE, never spliced: the identity cell carries
    // the new generation's boot time.
    const identityAfter = (await readJson(mcp, "surface://cells/identity")) as {
      startedAt: number;
    };
    expect(identityAfter.startedAt).toBeGreaterThan(identityBefore.startedAt);
  });

  // ── Leg 4: a restart across an IDLE gap costs no request (#2082) ─────────
  //
  // Leg 3 restarts padi and calls DURING the gap, so the dying socket is
  // discovered by a call that was going to fail anyway (padi is down). This leg
  // is the shape the field hit: padi restarts while the agent is idle, comes
  // back, and the agent's next call is its FIRST since the restart. That call
  // used to fail — the adapter had no way to learn the socket died except by
  // spending a request on it — with a message naming the stdio transport, which
  // the agent read as "the MCP server exited". It stopped using MCP for the rest
  // of the session; a single retry would have worked.
  it("restart across an IDLE gap: the FIRST padi-backed request after it succeeds (#2082)", {
    timeout: 180000,
  }, async () => {
    const stateRoot = makeStateRoot();
    const p = await startPadi(stateRoot);
    const socketPath = p.socketPath;

    const mcp = await serveMcpOverPadi(socketPath, "pin-client-idle-restart");

    // Establish the shared connection the restart will kill.
    const before = (await readJson(mcp, "surface://cells/identity")) as {
      startedAt: number;
    };
    expect(before.startedAt).toBeGreaterThan(0);

    // Restart padi with NO MCP traffic in the gap — the routine upgrade.
    p.child.kill("SIGTERM");
    await p.exited;
    const p2 = spawnPadi(stateRoot);
    await waitForPadi(p2.socketPath);

    // THE ASSERTION. Not "eventually succeeds", not "succeeds on retry" — the
    // FIRST request after the restart, with no retry and no warm-up, must land.
    const after = (await readJson(mcp, "surface://cells/identity")) as {
      startedAt: number;
    };
    expect(after.startedAt).toBeGreaterThan(before.startedAt);

    // The other half of fact #3 in the issue: the failure was POSITIONAL, so
    // whichever padi-backed request went first ate it. Prove the tool path is
    // equally unharmed — this call reaches padi and comes back with padi's OWN
    // application answer (no such terminal), never a transport complaint.
    const bogus = (await mcp.callTool({
      name: "screen_text",
      arguments: { id: "00000000-0000-4000-8000-000000000000" },
    })) as { content?: { text: string }[] };
    const text = bogus.content?.[0]?.text ?? "";
    expect(text).toContain("not found");
    expect(text).not.toContain("dropped");
    expect(text).not.toContain("transport");
  });
});
