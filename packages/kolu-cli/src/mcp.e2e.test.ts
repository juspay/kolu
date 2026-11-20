import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeDaemon } from "@kolu/daemon-test-gate";
import {
  assertPadiSurfaceCompatible,
  padiClientOver,
  scopePadiSurface,
} from "@kolu/padi-client/dial";
import {
  padiSocketPath,
  resolvePadiStateRoot,
} from "@kolu/padi-client/rendezvous";
import { padiDaemonGroup } from "@kolu/padi-client/surface";
import { awaitStdioReadiness } from "@kolu/surface/links/readiness";
import { stdioLink } from "@kolu/surface/links/stdio";
import { unixSocketLink } from "@kolu/surface/links/unix-socket";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { Effect } from "effect";
import { serveKoluMcp } from "kolu-mcp";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { connectKoluCliLocal } from "./connect.ts";
import {
  daemonEnv as daemonEnvIn,
  e2eRuntimeRoot,
  KOLU_MAIN,
  PADI_BIN,
  type Padi,
  reapPadi,
  sleep,
  spawnPadi,
  TSX_LOADER,
  waitForPadi,
} from "./e2eDaemon.testlib.ts";
import { midSessionDial, probePadiAtStartup } from "./mcp.ts";

const RUNTIME = e2eRuntimeRoot("mcp-e2e");
beforeAll(() => RUNTIME.enter());
afterAll(() => RUNTIME.leave());

const daemonEnv = (extra: Record<string, string> = {}): NodeJS.ProcessEnv =>
  daemonEnvIn(RUNTIME.root, extra);

const spawned: Padi[] = [];

async function startPadi(stateRoot: string): Promise<Padi> {
  const p = spawnPadi({ runtimeRoot: RUNTIME.root, stateRoot });
  spawned.push(p);
  await waitForPadi(p.socketPath);
  return p;
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  const teardownFailures: unknown[] = [];
  for (const c of cleanups.splice(0).reverse()) {
    try {
      await c();
    } catch (err) {
      teardownFailures.push(err);
    }
  }
  for (const p of spawned.splice(0)) {
    if (p.child.exitCode === null) await reapPadi(p);
  }
  for (const err of teardownFailures) {
    process.stderr.write(`mcp e2e: cleanup failed: ${String(err)}\n`);
  }
}, 30000);

const makeStateRoot = (): string =>
  mkdtempSync(join(tmpdir(), "kolu-mcp-e2e-sr-"));

function toolJson(result: unknown): unknown {
  const r = result as { isError?: boolean; content?: { text: string }[] };
  const text = r.content?.[0]?.text;
  if (r.isError) {
    throw new Error(`tool call failed: ${text}`);
  }
  return JSON.parse(text ?? "null");
}

async function readJson(mcp: Client, uri: string): Promise<unknown> {
  const { contents } = await mcp.readResource({ uri });
  return JSON.parse((contents[0] as { text: string }).text);
}

async function serveMcpOverPadi(
  socketPath: string,
  clientName: string,
): Promise<Client> {
  const rawDial = connectKoluCliLocal({ kind: "socket", path: socketPath });
  await Effect.runPromise(probePadiAtStartup(rawDial));
  const dial = midSessionDial(rawDial);
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

const SENTINEL = "MCP2-PIN-OK";

async function driveTerminalRoundTrip(mcp: Client): Promise<void> {
  const created = toolJson(
    await mcp.callTool({
      name: "lifecycle_create",
      arguments: { placement: { kind: "toplevel" } },
    }),
  ) as { id: string; pid: number };
  expect(created.id).toBeTruthy();
  const id = created.id;

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

  const screen = toolJson(
    await mcp.callTool({ name: "screen_text", arguments: { id, tail: 50 } }),
  ) as string;
  expect(screen).toContain(SENTINEL);

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

describeDaemon("kolu mcp — the headless graduation pin", () => {
  it("unix socket: the full round-trip through a real `kolu mcp` process", {
    timeout: 120000,
  }, async () => {
    const p = await startPadi(makeStateRoot());
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

  it("ssh stdio: the same round-trip over `padi --stdio` through the --host gate composition", {
    timeout: 120000,
  }, async () => {
    const stateRoot = makeStateRoot();
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

    if (child.stdout === null || child.stdin === null) {
      throw new Error("padi --stdio child has no stdio pipes");
    }
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
    cleanups.push(async () => {
      await link.dispose();
    });
    const combined = padiClientOver(link.dispatch);
    const hello = await (async () => {
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
      connect: async () => ({ client: { core: client }, dispose: () => {} }),
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

  it("restarts: kaval recycle + padi restart mid-subscribe — ids survive, in-gap fails typed, resources re-seed", {
    timeout: 180000,
  }, async () => {
    const stateRoot = makeStateRoot();
    const p = await startPadi(stateRoot);
    const socketPath = p.socketPath;

    const mcp = await serveMcpOverPadi(socketPath, "pin-client-restart");

    const created = toolJson(
      await mcp.callTool({
        name: "lifecycle_create",
        arguments: { placement: { kind: "toplevel" } },
      }),
    ) as { id: string };
    const id = created.id;

    let updates = 0;
    mcp.setNotificationHandler(ResourceUpdatedNotificationSchema, (n) => {
      if (n.params.uri === "surface://collections/terminals") updates += 1;
    });
    await mcp.subscribeResource({
      uri: "surface://collections/terminals",
    });

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

    const identityBefore = (await readJson(
      mcp,
      "surface://cells/identity",
    )) as { startedAt: number };

    p.child.kill("SIGTERM");
    await p.exited;

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

    const p2 = spawnPadi({ runtimeRoot: RUNTIME.root, stateRoot });
    spawned.push(p2);
    await waitForPadi(p2.socketPath);

    {
      const deadline = Date.now() + 30000;
      let lastError: unknown;
      for (;;) {
        try {
          const keys = (await readJson(
            mcp,
            "surface://collections/terminals",
          )) as string[];
          if (keys.includes(id)) break;
        } catch (err) {
          lastError = err;
        }
        if (Date.now() > deadline) {
          throw new Error(
            `id ${id} did not survive the padi restart: ${String(lastError)}`,
          );
        }
        await sleep(300);
      }
    }

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

    const item = (await readJson(
      mcp,
      `surface://collections/terminals/${id}`,
    )) as { state: string };
    expect(item.state).toBe("parked");

    const identityAfter = (await readJson(mcp, "surface://cells/identity")) as {
      startedAt: number;
    };
    expect(identityAfter.startedAt).toBeGreaterThan(identityBefore.startedAt);
  });

  it("restart across an IDLE gap: the FIRST padi-backed request after it succeeds (#2082)", {
    timeout: 180000,
  }, async () => {
    const stateRoot = makeStateRoot();
    const p = await startPadi(stateRoot);
    const socketPath = p.socketPath;

    const mcp = await serveMcpOverPadi(socketPath, "pin-client-idle-restart");

    const before = (await readJson(mcp, "surface://cells/identity")) as {
      startedAt: number;
    };
    expect(before.startedAt).toBeGreaterThan(0);

    p.child.kill("SIGTERM");
    await p.exited;
    const p2 = spawnPadi({ runtimeRoot: RUNTIME.root, stateRoot });
    spawned.push(p2);
    await waitForPadi(p2.socketPath);

    const after = (await readJson(mcp, "surface://cells/identity")) as {
      startedAt: number;
    };
    expect(after.startedAt).toBeGreaterThan(before.startedAt);

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
