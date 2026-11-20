import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertDaemonSpawnAllowed,
  describeDaemon,
  PADI_DIAL_RT_PREFIX,
  PADI_DIAL_SR_PREFIX,
} from "@kolu/daemon-test-gate";
import { type PadiSurfaceClient, padiClientOver } from "@kolu/padi-client/dial";
import { padiSocketPath } from "@kolu/padi-client/rendezvous";
import {
  type PadiRoster,
  type PadiTerminal,
  padiDaemonGroup,
} from "@kolu/padi-client/surface";
import { unixSocketLink } from "@kolu/surface/links/unix-socket";
import { Effect, Stream } from "effect";
import { afterAll, beforeAll, expect, it } from "vitest";
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

const sleep = (ms: number): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
};

interface Padi {
  child: ChildProcess;
  exited: Promise<number | null>;
}

function spawnPadi(stateRoot: string): Padi {
  assertDaemonSpawnAllowed("a real padi daemon (boot roster)");
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
      "--state-root",
      stateRoot,
      "--allow-nix-shell-with-env-whitelist",
      "default",
    ],
    { stdio: ["ignore", "ignore", "ignore"], env },
  );
  const { promise, resolve } = Promise.withResolvers<number | null>();
  child.on("exit", (code) => resolve(code));
  return { child, exited: promise };
}

async function reap(padi: Padi, stateRoot: string): Promise<void> {
  padi.child.kill("SIGTERM");
  await padi.exited;
  const pidPath = join(dirname(padiKavalSocketPath(stateRoot)), "kaval.pid");
  let stamped: string;
  try {
    stamped = readFileSync(pidPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  const pid = Number.parseInt(stamped.trim(), 10);
  if (!Number.isFinite(pid)) return;
  try {
    process.kill(pid, "SIGKILL");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ESRCH") throw err;
  }
}

async function dial(
  socketPath: string,
): Promise<{ padi: PadiSurfaceClient; dispose: () => Promise<void> }> {
  const link = await unixSocketLink({ group: padiDaemonGroup, socketPath });
  return {
    padi: padiClientOver(link.dispatch).padi,
    dispose: () => link.dispose(),
  };
}

async function waitForPadi(socketPath: string, ms = 60_000): Promise<void> {
  const deadline = Date.now() + ms;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const conn = await dial(socketPath);
      await conn.dispose();
      return;
    } catch (err) {
      last = err;
      await sleep(250);
    }
  }
  throw new Error(`padi socket never came up: ${socketPath} (${String(last)})`);
}

const head = <A>(stream: Stream.Stream<A, unknown>): Promise<A> =>
  Effect.runPromise(
    Effect.map(Stream.runHead(stream), (option) => {
      if (option === undefined || option._tag === "None")
        throw new Error("member yielded no snapshot frame");
      return option.value as A;
    }),
  );

describeDaemon(
  "a padi that boots with a saved session and no survivors",
  () => {
    it("parks the saved terminals under their own ids BEFORE it establishes the roster", async () => {
      const stateRoot = mkdtempSync(join(tmpdir(), PADI_DIAL_SR_PREFIX));
      const socketPath = padiSocketPath(stateRoot);
      const first = spawnPadi(stateRoot);
      await waitForPadi(socketPath);
      let conn = await dial(socketPath);
      const created = (await Effect.runPromise(
        conn.padi.surface.lifecycle.create({
          placement: { kind: "toplevel" },
        }) as Effect.Effect<{ id: string }, unknown>,
      )) as { id: string };
      const id = created.id;
      await sleep(2_000);
      await conn.dispose();

      await reap(first, stateRoot);

      const second = spawnPadi(stateRoot);
      await waitForPadi(socketPath);
      conn = await dial(socketPath);
      try {
        const standing = (await head(
          conn.padi.surface.roster.get(undefined),
        )) as PadiRoster;
        const keys = (await head(
          conn.padi.surface.terminals.keys(undefined),
        )) as readonly string[];
        expect(standing.kind).toBe("established");
        expect(keys).toContain(id);
        const record = (await head(
          conn.padi.surface.terminals.get({ key: id }),
        )) as PadiTerminal;
        expect(record.state).toBe("parked");

        await Effect.runPromise(
          conn.padi.surface.session.restore({}) as Effect.Effect<
            unknown,
            unknown
          >,
        );
        let afterRestore: readonly string[] = [];
        let live: PadiTerminal | undefined;
        for (let i = 0; i < 20; i++) {
          afterRestore = (await head(
            conn.padi.surface.terminals.keys(undefined),
          )) as readonly string[];
          live = afterRestore.includes(id)
            ? ((await head(
                conn.padi.surface.terminals.get({ key: id }),
              )) as PadiTerminal)
            : undefined;
          if (live?.state === "active") break;
          await sleep(500);
        }
        console.log(
          `[boot-roster] after restore: keys=${afterRestore.join(",")} saved=${id} state=${live?.state ?? "absent"}`,
        );
        expect(afterRestore).toContain(id);
        expect(live).toBeDefined();
      } finally {
        await conn.dispose();
        await reap(second, stateRoot);
        rmSync(stateRoot, { recursive: true, force: true });
      }
    }, 180_000);

    it("DISCARDING the restore is what makes those terminals really gone", async () => {
      const stateRoot = mkdtempSync(join(tmpdir(), PADI_DIAL_SR_PREFIX));
      const socketPath = padiSocketPath(stateRoot);
      const first = spawnPadi(stateRoot);
      await waitForPadi(socketPath);
      let conn = await dial(socketPath);
      const created = (await Effect.runPromise(
        conn.padi.surface.lifecycle.create({
          placement: { kind: "toplevel" },
        }) as Effect.Effect<{ id: string }, unknown>,
      )) as { id: string };
      await sleep(2_000);
      await conn.dispose();
      await reap(first, stateRoot);

      const second = spawnPadi(stateRoot);
      await waitForPadi(socketPath);
      conn = await dial(socketPath);
      try {
        await Effect.runPromise(
          conn.padi.surface.session.forfeit({}) as Effect.Effect<
            unknown,
            unknown
          >,
        );
        const keys = (await head(
          conn.padi.surface.terminals.keys(undefined),
        )) as readonly string[];
        expect(keys).not.toContain(created.id);
        const standing = (await head(
          conn.padi.surface.roster.get(undefined),
        )) as PadiRoster;
        expect(standing.kind).toBe("established");
      } finally {
        await conn.dispose();
        await reap(second, stateRoot);
        rmSync(stateRoot, { recursive: true, force: true });
      }
    }, 180_000);

    it("RESTORE brings the parked terminal back LIVE on its own id, after an unclean kaval death", async () => {
      const stateRoot = mkdtempSync(join(tmpdir(), PADI_DIAL_SR_PREFIX));
      const socketPath = padiSocketPath(stateRoot);
      const first = spawnPadi(stateRoot);
      await waitForPadi(socketPath);
      let conn = await dial(socketPath);
      const created = (await Effect.runPromise(
        conn.padi.surface.lifecycle.create({
          placement: { kind: "toplevel" },
        }) as Effect.Effect<{ id: string }, unknown>,
      )) as { id: string };
      await sleep(2_000);
      await conn.dispose();
      await reap(first, stateRoot);

      const second = spawnPadi(stateRoot);
      await waitForPadi(socketPath);
      conn = await dial(socketPath);
      try {
        const parked = (await head(
          conn.padi.surface.terminals.get({ key: created.id }),
        )) as PadiTerminal;
        expect(parked.state).toBe("parked");

        await Effect.runPromise(
          conn.padi.surface.session.restore({}) as Effect.Effect<
            unknown,
            unknown
          >,
        );
        let live: PadiTerminal | undefined;
        for (let i = 0; i < 20; i++) {
          live = (await head(
            conn.padi.surface.terminals.get({ key: created.id }),
          )) as PadiTerminal;
          if (live.state === "active") break;
          await sleep(500);
        }
        expect(live?.state).toBe("active");
      } finally {
        await conn.dispose();
        await reap(second, stateRoot);
        rmSync(stateRoot, { recursive: true, force: true });
      }
    }, 180_000);
  },
);
