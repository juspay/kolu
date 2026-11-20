import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildSurfaceFace } from "@kolu/surface/client";
import { unixSocketLink } from "@kolu/surface/links/unix-socket";
import { DAEMON_BIND_PID_ENV, gatePid } from "@kolu/surface-daemon";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { Effect } from "effect";
import {
  assertDaemonSpawnAllowed,
  describeDaemon,
} from "@kolu/daemon-test-gate";
import { runContractCorpus, spawnInput } from "./contractCorpus.testlib.ts";
import { KAVAL_GATE_FILE } from "./socketPath.ts";
import { ptyHostSurface } from "./ptyHostSurface.ts";
import { type PtyHostClient, ptyHostClientOver } from "./ptyHostClient.ts";
import { kavalControlSurface, kavalDaemonGroup } from "./daemonSurface.ts";
import { closeStream, openStream } from "./streamFrame.testlib.ts";

const SRC = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SRC, "../../..");
const KAVAL_BIN = join(SRC, "bin.ts");
const KAVAL_TUI = join(REPO_ROOT, "packages/kaval-tui/src/main.ts");

const TSX_LOADER = pathToFileURL(
  createRequire(import.meta.url).resolve("tsx"),
).href;

const TSX_CLI = createRequire(import.meta.url)
  .resolve("tsx/package.json")
  .replace(/package\.json$/, "dist/cli.mjs");

function spawnUnderShippedLoader(
  file: string,
  args: string[],
  stdout: "ignore" | "pipe",
): ChildProcess {
  assertDaemonSpawnAllowed("a real kaval daemon (node --import loader bin.ts)");
  return spawn(process.execPath, ["--import", TSX_LOADER, file, ...args], {
    stdio: ["ignore", stdout, "ignore"],
    env: process.env,
  });
}

function spawnUnderForkingCli(file: string, args: string[]): ChildProcess {
  assertDaemonSpawnAllowed("a real kaval daemon (tsx CLI fork)");
  return spawn(process.execPath, [TSX_CLI, file, ...args], {
    stdio: ["ignore", "ignore", "ignore"],
    env: process.env,
  });
}

interface Conn {
  client: PtyHostClient;
  dispose: () => Promise<void>;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

interface Daemon {
  child: ChildProcess;
  exited: Promise<number | null>;
  socketPath: string;
  gatePath: string;
}

const trackedChildren: ChildProcess[] = [];
const trackedRendezvous: string[] = [];
const allRendezvous: string[] = [];

beforeAll(() => {
  vi.stubEnv(DAEMON_BIND_PID_ENV, String(process.pid));
});
afterAll(() => {
  vi.unstubAllEnvs();
});

function rendezvousDir(socketPath: string): string {
  return dirname(socketPath);
}

function signalIfAlive(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ESRCH") throw err;
  }
}

const GRACEFUL_REAP_MS = 4_000;

async function reapRendezvousGracefullyThenKill(dir: string): Promise<void> {
  const pid = gatePid(join(dir, KAVAL_GATE_FILE));
  if (pid !== undefined && isAlive(pid)) {
    signalIfAlive(pid, "SIGTERM");
    const deadline = Date.now() + GRACEFUL_REAP_MS;
    while (isAlive(pid) && Date.now() < deadline) await sleep(50);
    if (isAlive(pid)) signalIfAlive(pid, "SIGKILL");
  }
  rmSync(dir, { recursive: true, force: true });
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function track<T extends Daemon | ChildProcess>(x: T): T {
  if ("child" in x) {
    trackedChildren.push(x.child);
    trackedRendezvous.push(rendezvousDir(x.socketPath));
  } else {
    trackedChildren.push(x);
  }
  return x;
}

function launch(socketPath: string): Daemon {
  const child = spawnUnderShippedLoader(
    KAVAL_BIN,
    ["--socket", socketPath],
    "ignore",
  );
  const exited = new Promise<number | null>((res) => {
    child.on("exit", (code) => res(code));
  });
  allRendezvous.push(rendezvousDir(socketPath));
  return {
    child,
    exited,
    socketPath,
    gatePath: join(dirname(socketPath), KAVAL_GATE_FILE),
  };
}

afterAll(async () => {
  const leaked = allRendezvous.filter((dir) => {
    const pid = gatePid(join(dir, KAVAL_GATE_FILE));
    return pid !== undefined && isAlive(pid);
  });
  for (const dir of allRendezvous.splice(0))
    await reapRendezvousGracefullyThenKill(dir);
  expect(leaked).toEqual([]);
});

async function connect(socketPath: string): Promise<Conn> {
  const link = await unixSocketLink({
    group: ptyHostSurface.group,
    socketPath,
  });
  return {
    client: ptyHostClientOver(link.dispatch),
    dispose: () => link.dispose(),
  };
}

async function waitForSocket(socketPath: string, ms = 10000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const conn = await connect(socketPath);
      await Effect.runPromise(conn.client.surface.system.heartbeat({}));
      await conn.dispose();
      return;
    } catch {
      await sleep(100);
    }
  }
  throw new Error(`kaval socket never came up: ${socketPath}`);
}

function socketIn(): string {
  return join(mkdtempSync(join(tmpdir(), "kaval-e2e-")), "pty-host.sock");
}

const makeCwd = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "kaval-e2e-cwd-"));
  allRendezvous.push(dir);
  return dir;
};

async function startDaemon(): Promise<Daemon> {
  const d = launch(socketIn());
  await waitForSocket(d.socketPath);
  return d;
}

async function reap(d: Daemon): Promise<void> {
  d.child.kill("SIGTERM");
  await d.exited;
}

function runKavalTui(
  args: string[],
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  assertDaemonSpawnAllowed("a real kaval-tui (node --import loader)");
  return new Promise((resolvePromise) => {
    const child = track(
      spawn(process.execPath, ["--import", TSX_LOADER, KAVAL_TUI, ...args], {
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      }),
    );
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (b) => {
      stdout += String(b);
    });
    child.stderr?.on("data", (b) => {
      stderr += String(b);
    });
    child.on("exit", (code) => resolvePromise({ code, stdout, stderr }));
  });
}

runContractCorpus({
  label: "spawned daemon socket",
  makeHost: async () => {
    const d = await startDaemon();
    const conn = await connect(d.socketPath);
    return {
      client: conn.client,
      isolated: async () => {
        const probe = await connect(d.socketPath);
        return { client: probe.client, dispose: () => probe.dispose() };
      },
      dispose: async () => {
        await conn.dispose();
        await reap(d);
      },
    };
  },
  makeCwd,
});

describeDaemon("kaval daemon — process-boundary behaviour", () => {
  afterEach(async () => {
    for (const dir of trackedRendezvous.splice(0))
      await reapRendezvousGracefullyThenKill(dir);
    for (const c of trackedChildren.splice(0)) {
      if (c.exitCode === null) c.kill("SIGKILL");
    }
  });

  it("serves frozen identity beside the unchanged pty surface and refuses drain without exiting", async () => {
    const d = track(await startDaemon());
    const link = await unixSocketLink({
      group: kavalDaemonGroup,
      socketPath: d.socketPath,
    });
    try {
      const pty = ptyHostClientOver(link.dispatch);
      const control = buildSurfaceFace(kavalControlSurface, link.dispatch)
        .surface.core as {
        hello(): Effect.Effect<Record<string, unknown>, unknown>;
        drain(): Effect.Effect<void, unknown>;
      };

      const version = await Effect.runPromise(pty.surface.system.version({}));
      const hello = await Effect.runPromise(control.hello());
      expect(hello.surfaceVersion).toBe(version.contractVersion);
      expect(hello.startedAt).toBe(version.startedAt);

      await expect(Effect.runPromise(control.drain())).rejects.toThrow();
      await expect(Effect.runPromise(control.hello())).resolves.toEqual(hello);
      expect(isAlive(d.child.pid ?? -1)).toBe(true);
    } finally {
      await link.dispose();
    }
  }, 30000);

  it("single-instance gate: a second kaval yields (exit 0); a SIGKILL'd one leaves a stale gate the next reaps", async () => {
    const socketPath = socketIn();
    const a = track(launch(socketPath));
    await waitForSocket(socketPath);

    const b = track(launch(socketPath));
    expect(await b.exited).toBe(0);

    const c1 = await connect(socketPath);
    await Effect.runPromise(c1.client.surface.system.heartbeat({}));
    await c1.dispose();

    a.child.kill("SIGKILL");
    await a.exited;

    const c = track(launch(socketPath));
    await waitForSocket(socketPath);
    const c2 = await connect(socketPath);
    expect(
      (await Effect.runPromise(c2.client.surface.terminal.list({}))).entries,
    ).toEqual([]);
    await c2.dispose();
    await reap(c);
  }, 30000);

  it("graceful shutdown reaps a non-tty-aware PTY leader — no orphaned spawn-helper", async () => {
    const d = track(await startDaemon());
    const conn = await connect(d.socketPath);
    const { pid } = await Effect.runPromise(
      conn.client.surface.terminal.spawn({
        argv: ["sleep", "100000"],
        cwd: makeCwd(),
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin", TERM: "xterm" },
        initFiles: [],
      }),
    );
    await conn.dispose();
    expect(isAlive(pid)).toBe(true);

    try {
      await reap(d);

      for (let i = 0; i < 50 && isAlive(pid); i++) await sleep(100);
      expect(isAlive(pid)).toBe(false);
    } finally {
      signalIfAlive(pid, "SIGKILL");
    }
  }, 30000);

  it("the rendezvous backstop reaps a daemon's PTY leaders — even one the master-close hangup cannot kill", async () => {
    const d = track(await startDaemon());
    const conn = await connect(d.socketPath);
    const { pid } = await Effect.runPromise(
      conn.client.surface.terminal.spawn({
        argv: ["/bin/sh", "-c", "trap '' HUP; exec sleep 100000"],
        cwd: makeCwd(),
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin", TERM: "xterm" },
        initFiles: [],
      }),
    );
    await conn.dispose();
    expect(isAlive(pid)).toBe(true);

    try {
      await reapRendezvousGracefullyThenKill(rendezvousDir(d.socketPath));

      expect(await d.exited).toBe(0);
      for (let i = 0; i < 50 && isAlive(pid); i++) await sleep(100);
      expect(isAlive(pid)).toBe(false);
    } finally {
      signalIfAlive(pid, "SIGKILL");
    }
  }, 30000);

  it("self-liveness: a daemon whose own address stops answering exits NON-ZERO and releases its gate (#2101 N2)", async () => {
    const d = track(await startDaemon());
    expect(existsSync(d.gatePath)).toBe(true);

    rmSync(d.socketPath, { force: true });

    const code = await Promise.race([
      d.exited,
      sleep(60_000).then(() => "never exited" as const),
    ]);
    expect(code).not.toBe("never exited");
    expect(code).not.toBe(0);
    expect(existsSync(d.gatePath)).toBe(false);
  }, 90_000);

  it("SIGTERM teardown removes the socket and releases the gate", async () => {
    const d = track(await startDaemon());
    expect(existsSync(d.socketPath)).toBe(true);
    expect(existsSync(d.gatePath)).toBe(true);

    await reap(d);
    expect(existsSync(d.socketPath)).toBe(false);
    expect(existsSync(d.gatePath)).toBe(false);
  }, 30000);

  it("the launcher choice is load-bearing: tsx's CLI fork swallows SIGTERM teardown; the loader form (the shipped wrapper) does not", async () => {
    const startGet = (
      spawnFn: (file: string, args: string[]) => ChildProcess,
    ): Promise<{
      code: number | null;
      socketLeft: boolean;
      gateLeft: boolean;
    }> =>
      (async () => {
        const socketPath = socketIn();
        const gatePath = join(dirname(socketPath), KAVAL_GATE_FILE);
        trackedRendezvous.push(rendezvousDir(socketPath));
        allRendezvous.push(rendezvousDir(socketPath));
        const child = track(spawnFn(KAVAL_BIN, ["--socket", socketPath]));
        const exited = new Promise<number | null>((res) =>
          child.on("exit", (code) => res(code)),
        );
        await waitForSocket(socketPath);
        child.kill("SIGTERM");
        const code = await exited;
        return {
          code,
          socketLeft: existsSync(socketPath),
          gateLeft: existsSync(gatePath),
        };
      })();

    const loader = await startGet((f, a) =>
      spawnUnderShippedLoader(f, a, "ignore"),
    );
    expect(loader.code).toBe(0);
    expect(loader.socketLeft).toBe(false);
    expect(loader.gateLeft).toBe(false);

    const cli = await startGet(spawnUnderForkingCli);
    expect(cli.code).not.toBe(0);
    expect(cli.socketLeft || cli.gateLeft).toBe(true);
  }, 30000);

  it("initFiles materialise under the daemon's rcDir across the process boundary, then are removed on exit", async () => {
    const d = track(await startDaemon());
    const conn = await connect(d.socketPath);
    const info = await Effect.runPromise(conn.client.surface.system.info({}));
    const rcName = "corpus-initfile";
    const rcPath = join(info.rcDir, rcName);

    const { id } = await Effect.runPromise(
      conn.client.surface.terminal.spawn({
        argv: [info.shell],
        cwd: makeCwd(),
        env: { PATH: process.env.PATH ?? "", HOME: info.home },
        initFiles: [{ name: rcName, content: "# corpus init marker\n" }],
      }),
    );
    expect(existsSync(rcPath)).toBe(true);

    await Effect.runPromise(conn.client.surface.terminal.kill({ id }));
    for (let i = 0; i < 60 && existsSync(rcPath); i++) await sleep(50);
    expect(existsSync(rcPath)).toBe(false);

    await conn.dispose();
    await reap(d);
  }, 30000);

  it("a restart on the same socket serves fresh — B1 makes no survival promise", async () => {
    const socketPath = socketIn();
    const first = track(launch(socketPath));
    await waitForSocket(socketPath);
    const c1 = await connect(socketPath);
    await Effect.runPromise(
      c1.client.surface.terminal.spawn(spawnInput(makeCwd())),
    );
    expect(
      (await Effect.runPromise(c1.client.surface.terminal.list({}))).entries,
    ).toHaveLength(1);
    await c1.dispose();
    await reap(first);

    const second = track(launch(socketPath));
    await waitForSocket(socketPath);
    const c2 = await connect(socketPath);
    expect(
      (await Effect.runPromise(c2.client.surface.terminal.list({}))).entries,
    ).toEqual([]);
    await c2.dispose();
    await reap(second);
  }, 30000);

  it("SIGKILL mid-attach: the client's stream errors or ends — it does not hang", async () => {
    const d = track(await startDaemon());
    const conn = await connect(d.socketPath);
    const { id, pid } = await Effect.runPromise(
      conn.client.surface.terminal.spawn(spawnInput(makeCwd())),
    );
    try {
      const iterator = openStream(
        conn.client.surface.terminalAttach.get({ id }),
      );
      await iterator.next();

      d.child.kill("SIGKILL");
      await d.exited;

      const outcome = await Promise.race([
        iterator
          .next()
          .then(() => "settled" as const)
          .catch(() => "errored" as const),
        sleep(6000).then(() => "hung" as const),
      ]);
      expect(outcome).not.toBe("hung");
      closeStream(iterator);
      await conn.dispose().catch(() => {});
    } finally {
      signalIfAlive(pid, "SIGKILL");
    }
  }, 30000);

  it("kaval-tui drives the real daemon: `list` exits 0 and reflects spawns", async () => {
    const d = track(await startDaemon());

    const empty = await runKavalTui(["list", "--socket", d.socketPath]);
    expect(empty.code).toBe(0);
    expect(empty.stdout).toContain("no live terminals");

    const conn = await connect(d.socketPath);
    await Effect.runPromise(
      conn.client.surface.terminal.spawn(spawnInput(makeCwd())),
    );

    const populated = await runKavalTui(["list", "--socket", d.socketPath]);
    expect(populated.code).toBe(0);
    expect(populated.stdout).not.toContain("no live terminals");

    await conn.dispose();
    await reap(d);
  }, 30000);

  it("kaval-tui create: the CLI spawns through main.ts and the id is then listable", async () => {
    const d = track(await startDaemon());

    const created = await runKavalTui([
      "create",
      "--socket",
      d.socketPath,
      "--json",
      "--",
      "sh",
      "-c",
      "echo CREATEMARK; sleep 100",
    ]);
    expect(created.code).toBe(0);
    const { id } = JSON.parse(created.stdout) as { id: string };
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );

    const human = await runKavalTui([
      "create",
      "--socket",
      d.socketPath,
      "--",
      "sh",
      "-c",
      "sleep 100",
    ]);
    expect(human.code).toBe(0);
    expect(human.stdout).toMatch(/^spawned /);
    expect(human.stderr).toContain("attach with `kaval-tui attach");

    const listed = await runKavalTui([
      "list",
      "--socket",
      d.socketPath,
      "--json",
    ]);
    expect(listed.code).toBe(0);
    const entries = JSON.parse(listed.stdout) as Array<{ id: string }>;
    expect(entries.some((e) => e.id === id)).toBe(true);

    const conn = await connect(d.socketPath);
    let screen = "";
    for (let i = 0; i < 100 && !screen.includes("CREATEMARK"); i++) {
      screen = (
        await Effect.runPromise(
          conn.client.surface.terminal.getScreenText({ id }),
        )
      ).text;
      if (!screen.includes("CREATEMARK")) await sleep(50);
    }
    expect(screen).toContain("CREATEMARK");
    await conn.dispose();

    await reap(d);
  }, 30000);

  it("kaval-tui create: stamps KAVAL_SOCKET so a process inside can reach its daemon", async () => {
    const d = track(await startDaemon());

    const created = await runKavalTui([
      "create",
      "--socket",
      d.socketPath,
      "--json",
      "--",
      "sh",
      "-c",
      'echo "KS=[$KAVAL_SOCKET]"; sleep 100',
    ]);
    expect(created.code).toBe(0);
    const { id } = JSON.parse(created.stdout) as { id: string };

    const conn = await connect(d.socketPath);
    let screen = "";
    for (let i = 0; i < 100 && !screen.includes("KS=["); i++) {
      screen = (
        await Effect.runPromise(
          conn.client.surface.terminal.getScreenText({ id }),
        )
      ).text;
      if (!screen.includes("KS=[")) await sleep(50);
    }
    expect(screen).toContain(`KS=[${d.socketPath}]`);
    await conn.dispose();

    await reap(d);
  }, 30000);

  it("a flag BEFORE the subcommand fails with a flag-order hint, not silent help", async () => {
    const wrong = await runKavalTui(["--socket", "/whatever", "list"]);
    expect(wrong.code).not.toBe(0);
    expect(wrong.stderr).toContain("AFTER the subcommand");
    const right = await runKavalTui([
      "list",
      "--socket",
      "/no/such/kaval.sock",
    ]);
    expect(right.code).not.toBe(0);
    expect(right.stderr).toContain("no socket at /no/such/kaval.sock");
  }, 30000);

  it("--host and --socket are mutually exclusive: passing both fails with a clear hint", async () => {
    const both = await runKavalTui([
      "list",
      "--host",
      "nix@prod",
      "--socket",
      "/some/where.sock",
    ]);
    expect(both.code).not.toBe(0);
    expect(both.stderr).toContain("mutually exclusive");
  }, 30000);
});
