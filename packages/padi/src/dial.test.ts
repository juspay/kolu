import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertDaemonSpawnAllowed,
  describeDaemon,
  PADI_DIAL_RT_PREFIX,
  PADI_DIAL_SR_PREFIX,
} from "@kolu/daemon-test-gate";
import {
  assertPadiSurfaceCompatible,
  type PadiDaemonClient,
  padiClientOver,
} from "@kolu/padi-client/dial";
import { padiGatePath, padiSocketPath } from "@kolu/padi-client/rendezvous";
import {
  PADI_SURFACE_VERSION,
  padiDaemonGroup,
  TOPLEVEL_PLACEMENT,
} from "@kolu/padi-client/surface";
import { isContractVersionCompatible } from "@kolu/surface/define";
import { awaitStdioReadiness } from "@kolu/surface/links/readiness";
import { stdioLink } from "@kolu/surface/links/stdio";
import { unixSocketLink } from "@kolu/surface/links/unix-socket";
import { isHolderLive } from "@kolu/surface-daemon";
import { DaemonContractSkewError } from "@kolu/surface-daemon-supervisor";
import { Effect, Stream } from "effect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { TerminalAttachFrame } from "./endpoint.ts";
import { probeKavalStatus } from "./hostInventory.ts";
import { padiKavalSocketPath } from "./stateRoot.ts";

const SRC = dirname(fileURLToPath(import.meta.url));
const PADI_BIN = join(SRC, "daemonBoot", "bin.ts");
const TSX_LOADER = pathToFileURL(
  createRequire(import.meta.url).resolve("tsx"),
).href;

const RUNTIME_ROOT = mkdtempSync(join(tmpdir(), PADI_DIAL_RT_PREFIX));
const priorXdg = process.env.XDG_RUNTIME_DIR;
beforeAll(() => {
  process.env.XDG_RUNTIME_DIR = RUNTIME_ROOT;
});
afterAll(() => {
  process.env.XDG_RUNTIME_DIR = priorXdg;
  rmSync(RUNTIME_ROOT, { recursive: true, force: true });
});

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

async function waitUntil(
  pred: () => boolean,
  ms: number,
  msg: string,
): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (pred()) return;
    await sleep(100);
  }
  throw new Error(msg);
}

interface Conn {
  client: PadiDaemonClient;
  dispose: () => Promise<void>;
}

interface Padi {
  child: ChildProcess;
  exited: Promise<number | null>;
  stateRoot: string;
  socketPath: string;
  kavalSocket: string;
}

const spawned: Padi[] = [];

function spawnPadi(stateRoot: string, bindPid: number = process.pid): Padi {
  assertDaemonSpawnAllowed("a real padi daemon (node --import loader bin.ts)");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    XDG_RUNTIME_DIR: RUNTIME_ROOT,
    KOLU_KAVAL_SPAWN: "detached",
    KOLU_DAEMON_BIND_PID: String(bindPid),
  };
  delete env.INVOCATION_ID;
  delete env.KOLU_KAVAL_BIN;
  delete env.KOLU_KAVAL_SOCKET;
  delete env.KOLU_STATE_DIR;
  const child = spawn(
    process.execPath,
    [
      "--import",
      TSX_LOADER,
      PADI_BIN,
      "--state-root",
      stateRoot,
      "--allow-nix-shell-with-env-whitelist",
      "default",
    ],
    { stdio: ["ignore", "ignore", "ignore"], env },
  );
  const exited = new Promise<number | null>((res) =>
    child.on("exit", (code) => res(code)),
  );
  const padi: Padi = {
    child,
    exited,
    stateRoot,
    socketPath: padiSocketPath(stateRoot),
    kavalSocket: padiKavalSocketPath(stateRoot),
  };
  spawned.push(padi);
  return padi;
}

async function connect(socketPath: string): Promise<Conn> {
  const link = await unixSocketLink({ group: padiDaemonGroup, socketPath });
  return {
    client: padiClientOver(link.dispatch),
    dispose: () => link.dispose(),
  };
}

async function waitForPadi(socketPath: string, ms = 15000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const conn = await connect(socketPath);
      await Effect.runPromise(conn.client.control.surface.core.hello());
      await conn.dispose();
      return;
    } catch {
      await sleep(150);
    }
  }
  throw new Error(`padi socket never came up: ${socketPath}`);
}

async function startPadi(stateRoot: string): Promise<Padi> {
  const p = spawnPadi(stateRoot);
  await waitForPadi(p.socketPath);
  return p;
}

function gatePid(gatePath: string): number | undefined {
  try {
    const pid = Number.parseInt(readFileSync(gatePath, "utf8").trim(), 10);
    return Number.isFinite(pid) ? pid : undefined;
  } catch {
    return undefined;
  }
}

/** Signal `pid`, tolerating only the race this teardown is written for: the
 *  process already exited (`ESRCH`). Any other failure — a permission error, a
 *  bad pid — surfaces instead of passing for a successful kill. */
function signalIfLive(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ESRCH") throw err;
  }
}

async function reap(p: Padi): Promise<void> {
  p.child.kill("SIGTERM");
  await p.exited;
  const kavalPid = gatePid(join(dirname(p.kavalSocket), "kaval.pid"));
  if (kavalPid !== undefined) signalIfLive(kavalPid, "SIGKILL");
}

afterEach(async () => {
  for (const p of spawned.splice(0)) {
    if (p.child.exitCode === null) await reap(p);
  }
});

const makeStateRoot = (): string =>
  mkdtempSync(join(tmpdir(), PADI_DIAL_SR_PREFIX));

interface PadiStdioFront {
  child: ChildProcess;
  exited: Promise<number | null>;
  stateRoot: string;
  socketPath: string;
  kavalSocket: string;
}

const stdioFronts: PadiStdioFront[] = [];

function spawnPadiStdioFront(stateRoot: string): PadiStdioFront {
  assertDaemonSpawnAllowed(
    "a real padi --stdio front (node --import loader bin.ts)",
  );
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    XDG_RUNTIME_DIR: RUNTIME_ROOT,
    KOLU_KAVAL_SPAWN: "detached",
    KOLU_DAEMON_BIND_PID: String(process.pid),
  };
  delete env.INVOCATION_ID;
  delete env.KOLU_KAVAL_BIN;
  delete env.KOLU_KAVAL_SOCKET;
  delete env.KOLU_STATE_DIR;
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
    { stdio: ["pipe", "pipe", "inherit"], env },
  );
  const exited = new Promise<number | null>((res) =>
    child.on("exit", (code) => res(code)),
  );
  const front: PadiStdioFront = {
    child,
    exited,
    stateRoot,
    socketPath: padiSocketPath(stateRoot),
    kavalSocket: padiKavalSocketPath(stateRoot),
  };
  stdioFronts.push(front);
  return front;
}

async function stdioClient(front: PadiStdioFront): Promise<Conn> {
  if (!front.child.stdout || !front.child.stdin)
    throw new Error("stdio front child has no piped stdio");
  const readiness = await awaitStdioReadiness({
    read: front.child.stdout,
    deadlineMs: 60_000,
    describe: `padi --stdio front (${front.stateRoot})`,
  });
  const link = await stdioLink({
    group: padiDaemonGroup,
    read: front.child.stdout,
    write: front.child.stdin,
    readiness,
  });
  return {
    client: padiClientOver(link.dispatch),
    dispose: () => link.dispose(),
  };
}

async function reapStdioFront(front: PadiStdioFront): Promise<void> {
  front.child.kill("SIGTERM");
  await front.exited;
  const padiPid = gatePid(padiGatePath(front.socketPath));
  if (padiPid !== undefined) signalIfLive(padiPid, "SIGTERM");
  const kavalPid = gatePid(join(dirname(front.kavalSocket), "kaval.pid"));
  if (kavalPid !== undefined) signalIfLive(kavalPid, "SIGKILL");
}

afterEach(async () => {
  for (const f of stdioFronts.splice(0)) {
    if (f.child.exitCode === null) await reapStdioFront(f);
  }
});

describeDaemon("padi the process — dial acceptance", () => {
  it("handshakes the frozen control core over its socket", async () => {
    const stateRoot = makeStateRoot();
    const p = await startPadi(stateRoot);
    const conn = await connect(p.socketPath);

    const hello = await Effect.runPromise(
      conn.client.control.surface.core.hello(),
    );
    expect(hello.stateRoot).toBe(resolve(stateRoot));
    expect(hello.surfaceVersion).toBe(PADI_SURFACE_VERSION);
    expect(hello.controlCoreVersion).toBe("1.0");
    expect(hello.startedAt).toBeGreaterThan(0);

    const clock = await Effect.runPromise(
      conn.client.control.surface.core.clockNow(),
    );
    expect(clock.epochMs).toBeGreaterThan(0);

    await conn.dispose();
    await reap(p);
  }, 40000);

  it("round-trips a terminal through padiSurface over the socket", async () => {
    const stateRoot = makeStateRoot();
    const p = await startPadi(stateRoot);
    const conn = await connect(p.socketPath);

    const { id } = await Effect.runPromise(
      conn.client.padi.surface.lifecycle.create({
        placement: TOPLEVEL_PLACEMENT,
        cwd: makeStateRoot(),
      }),
    );
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    const attach = Stream.toAsyncIterable(
      conn.client.padi.surface.terminalAttach.get({ id }),
    )[Symbol.asyncIterator]();
    const first = await attach.next();
    const firstFrame = first.value as TerminalAttachFrame;
    if (firstFrame.kind !== "snapshot")
      throw new Error(`expected a snapshot frame, got ${firstFrame.kind}`);
    expect(typeof firstFrame.data).toBe("string");
    expect(typeof firstFrame.topLine).toBe("number");

    await Effect.runPromise(
      conn.client.padi.surface.lifecycle.sendInput({
        id,
        data: "echo DIALMARK\r",
      }),
    );
    let screen = "";
    for (let i = 0; i < 120 && !screen.includes("DIALMARK"); i++) {
      screen = await Effect.runPromise(
        conn.client.padi.surface.screen.state({ id }),
      );
      if (!screen.includes("DIALMARK")) await sleep(50);
    }
    expect(screen).toContain("DIALMARK");

    await conn.dispose();
    await reap(p);
  }, 40000);

  it("two padis at distinct state-roots never touch each other's kaval", async () => {
    const srA = makeStateRoot();
    const srB = makeStateRoot();
    expect(padiKavalSocketPath(srA)).not.toBe(padiKavalSocketPath(srB));

    const a = await startPadi(srA);
    const b = await startPadi(srB);
    const connA = await connect(a.socketPath);
    const connB = await connect(b.socketPath);

    const { id } = await Effect.runPromise(
      connA.client.padi.surface.lifecycle.create({
        placement: TOPLEVEL_PLACEMENT,
        cwd: makeStateRoot(),
      }),
    );
    expect(
      typeof (await Effect.runPromise(
        connA.client.padi.surface.screen.state({ id }),
      )),
    ).toBe("string");
    await expect(
      Effect.runPromise(connB.client.padi.surface.screen.state({ id })),
    ).rejects.toThrow();

    await connA.dispose();
    await connB.dispose();
    await reap(a);
    await reap(b);
  }, 60000);

  it("the frozen control core stays reachable UNDER a padiSurface version skew", async () => {
    const stateRoot = makeStateRoot();
    const p = await startPadi(stateRoot);
    const conn = await connect(p.socketPath);

    const oneMajorUp = `${Number(PADI_SURFACE_VERSION.split(".")[0]) + 1}.0`;
    const hello = await Effect.runPromise(
      conn.client.control.surface.core.hello(),
    );
    expect(hello.surfaceVersion).toBe(PADI_SURFACE_VERSION);
    expect(isContractVersionCompatible(hello.surfaceVersion, oneMajorUp)).toBe(
      false,
    );

    await Effect.runPromise(conn.client.control.surface.core.drain()).catch(
      () => {},
    );
    expect(await p.exited).toBe(0);

    await conn.dispose();
    await reap(p);
  }, 40000);

  it("reaps padi AND its kaval when the bound run pid dies (boundToPid, cross-process)", async () => {
    const sentinel = spawn(
      process.execPath,
      ["-e", "setTimeout(() => {}, 600000)"],
      { stdio: "ignore" },
    );
    if (sentinel.pid === undefined) throw new Error("sentinel failed to start");
    try {
      const stateRoot = makeStateRoot();
      const p = spawnPadi(stateRoot, sentinel.pid);
      await waitForPadi(p.socketPath);
      const padiGate = padiGatePath(p.socketPath);
      const kavalGate = join(dirname(p.kavalSocket), "kaval.pid");
      await waitUntil(
        () => gatePid(kavalGate) !== undefined,
        15000,
        "kaval never came up under the bound padi",
      );
      expect(gatePid(padiGate)).toBeGreaterThan(0);

      sentinel.kill("SIGKILL");
      expect(await p.exited).toBe(0);
      await waitUntil(
        () => gatePid(kavalGate) === undefined,
        15000,
        "kaval did not self-reap after the bound run pid died",
      );
      expect(gatePid(padiGate)).toBeUndefined();
    } finally {
      sentinel.kill("SIGKILL");
    }
  }, 60000);

  it("reaps a SIGSTOP'd kaval after the bound run pid dies — TERM is not enough (#2178)", async () => {
    const sentinel = spawn(
      process.execPath,
      ["-e", "setTimeout(() => {}, 600000)"],
      { stdio: "ignore" },
    );
    if (sentinel.pid === undefined) throw new Error("sentinel failed to start");
    let kavalPid: number | undefined;
    try {
      const stateRoot = makeStateRoot();
      const p = spawnPadi(stateRoot, sentinel.pid);
      await waitForPadi(p.socketPath);
      const kavalGate = join(dirname(p.kavalSocket), "kaval.pid");
      await waitUntil(
        () => gatePid(kavalGate) !== undefined,
        15000,
        "kaval never came up under the bound padi",
      );
      kavalPid = gatePid(kavalGate);
      if (kavalPid === undefined) throw new Error("no kaval pid to wedge");
      expect(isHolderLive(kavalPid)).toBe(true);

      process.kill(kavalPid, "SIGSTOP");
      process.kill(kavalPid, "SIGTERM");
      await sleep(400);
      expect(
        isHolderLive(kavalPid),
        "SIGTERM must not reap a stopped kaval",
      ).toBe(true);

      sentinel.kill("SIGKILL");
      await waitUntil(
        () => kavalPid !== undefined && !isHolderLive(kavalPid),
        15000,
        "wedged kaval survived the bound run pid dying — #2178, SIGKILL never landed",
      );
    } finally {
      sentinel.kill("SIGKILL");
      if (kavalPid !== undefined) {
        signalIfLive(kavalPid, "SIGCONT");
        signalIfLive(kavalPid, "SIGKILL");
      }
    }
  }, 60000);

  it("REPAIRS a comatose kaval by itself — SIGSTOP, no human (#2101 N1)", async () => {
    const stateRoot = makeStateRoot();
    const p = await startPadi(stateRoot);
    const kavalGate = join(dirname(p.kavalSocket), "kaval.pid");
    await waitUntil(
      () => gatePid(kavalGate) !== undefined,
      15000,
      "kaval never came up under the padi",
    );
    const comatose = gatePid(kavalGate);
    if (comatose === undefined) throw new Error("no kaval pid to freeze");

    process.kill(comatose, "SIGSTOP");
    try {
      await waitUntil(
        () => {
          const now = gatePid(kavalGate);
          return now !== undefined && now !== comatose;
        },
        120_000,
        "padi never repaired the comatose kaval — the #2101 field incident, reproduced",
      );
    } finally {
      signalIfLive(comatose, "SIGCONT");
      signalIfLive(comatose, "SIGKILL");
    }

    const probe = await Effect.runPromise(probeKavalStatus(p.kavalSocket));
    expect(probe.contractVersion).not.toBeNull();
  }, 180_000);
});

describeDaemon(
  "padi the process — dialed over a stdio front (the ssh transport, minus ssh)",
  () => {
    it("handshakes the frozen control core through the byte relay", async () => {
      const stateRoot = makeStateRoot();
      const front = spawnPadiStdioFront(stateRoot);
      await waitForPadi(front.socketPath);
      const { client } = await stdioClient(front);

      const hello = await Effect.runPromise(
        client.control.surface.core.hello(),
      );
      expect(hello.stateRoot).toBe(resolve(stateRoot));
      expect(hello.surfaceVersion).toBe(PADI_SURFACE_VERSION);
      expect(hello.controlCoreVersion).toBe("1.0");
      expect(hello.startedAt).toBeGreaterThan(0);

      const clock = await Effect.runPromise(
        client.control.surface.core.clockNow(),
      );
      expect(clock.epochMs).toBeGreaterThan(0);

      await reapStdioFront(front);
    }, 40000);

    it("round-trips a terminal through padiSurface over the byte relay", async () => {
      const stateRoot = makeStateRoot();
      const front = spawnPadiStdioFront(stateRoot);
      await waitForPadi(front.socketPath);
      const { client } = await stdioClient(front);

      const { id } = await Effect.runPromise(
        client.padi.surface.lifecycle.create({
          placement: TOPLEVEL_PLACEMENT,
          cwd: makeStateRoot(),
        }),
      );
      expect(id).toMatch(/^[0-9a-f-]{36}$/);

      const attach = Stream.toAsyncIterable(
        client.padi.surface.terminalAttach.get({ id }),
      )[Symbol.asyncIterator]();
      const first = await attach.next();
      const firstFrame = first.value as TerminalAttachFrame;
      if (firstFrame.kind !== "snapshot")
        throw new Error(`expected a snapshot frame, got ${firstFrame.kind}`);
      expect(typeof firstFrame.data).toBe("string");
      expect(typeof firstFrame.topLine).toBe("number");

      await Effect.runPromise(
        client.padi.surface.lifecycle.sendInput({
          id,
          data: "echo FRONTMARK\r",
        }),
      );
      let screen = "";
      for (let i = 0; i < 120 && !screen.includes("FRONTMARK"); i++) {
        screen = await Effect.runPromise(
          client.padi.surface.screen.state({ id }),
        );
        if (!screen.includes("FRONTMARK")) await sleep(50);
      }
      expect(screen).toContain("FRONTMARK");

      await reapStdioFront(front);
    }, 40000);

    it("the durable daemon SURVIVES the front dropping (detach → reattach)", async () => {
      const stateRoot = makeStateRoot();
      const front1 = spawnPadiStdioFront(stateRoot);
      await waitForPadi(front1.socketPath);
      const { client: client1 } = await stdioClient(front1);
      const { id } = await Effect.runPromise(
        client1.padi.surface.lifecycle.create({
          placement: TOPLEVEL_PLACEMENT,
          cwd: makeStateRoot(),
        }),
      );
      await Effect.runPromise(
        client1.padi.surface.lifecycle.sendInput({
          id,
          data: "echo SURVIVOR\r",
        }),
      );

      front1.child.kill("SIGTERM");
      await front1.exited;

      const front2 = spawnPadiStdioFront(stateRoot);
      await waitForPadi(front2.socketPath);
      const { client: client2 } = await stdioClient(front2);
      let screen = "";
      for (let i = 0; i < 120 && !screen.includes("SURVIVOR"); i++) {
        screen = await Effect.runPromise(
          client2.padi.surface.screen.state({ id }),
        );
        if (!screen.includes("SURVIVOR")) await sleep(50);
      }
      expect(screen).toContain("SURVIVOR");

      await reapStdioFront(front2);
    }, 60000);
  },
);

describe("assertPadiSurfaceCompatible", () => {
  const parts = PADI_SURFACE_VERSION.split(".").map(Number);
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;

  it("passes an exactly-matching padiSurface version", () => {
    expect(() =>
      assertPadiSurfaceCompatible(PADI_SURFACE_VERSION),
    ).not.toThrow();
  });

  it("passes a newer MINOR (a padi ahead this client can still speak)", () => {
    expect(() =>
      assertPadiSurfaceCompatible(`${major}.${minor + 1}`),
    ).not.toThrow();
  });

  it("REFUSES a newer MAJOR with a loud DaemonContractSkewError", () => {
    expect(() => assertPadiSurfaceCompatible(`${major + 1}.0`)).toThrow(
      DaemonContractSkewError,
    );
    expect(() => assertPadiSurfaceCompatible(`${major + 1}.0`)).toThrow(
      /contract skew/,
    );
  });

  it("REFUSES an older version (a padi too old for this client)", () => {
    const older = minor > 0 ? `${major}.${minor - 1}` : `${major - 1}.0`;
    expect(() => assertPadiSurfaceCompatible(older)).toThrow(
      DaemonContractSkewError,
    );
  });

  it("REFUSES an unparseable version string", () => {
    expect(() => assertPadiSurfaceCompatible("not-a-version")).toThrow(
      DaemonContractSkewError,
    );
  });
});
