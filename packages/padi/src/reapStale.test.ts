/**
 * Reaping stale padis — the ghost collector. Two properties carry this module:
 *
 *   - **PROOF gates the kill.** Only a daemon whose manifest names a state-root
 *     that is GONE is stale. A live state-root (production, or any worktree that
 *     still exists) is never a candidate, and an UNREADABLE manifest is never a
 *     candidate either — "I could not read what this is anchored to" is the
 *     opposite of proof.
 *   - **The rendezvous outlives nothing.** Once every holder is down, the runtime
 *     dirs go with them; while a holder is still up, they must be LEFT (removing a
 *     live daemon's socket strands it — running, but undiscoverable and unreapable).
 *
 * The seeding harness (a fabricated `$XDG_RUNTIME_DIR` drawer + a real socket
 * inode) mirrors `stateRoot.test.ts`'s discovery suite, since these tests exercise
 * the same registration shape from the other side.
 */

import { type ChildProcess, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { writeStateRootManifest } from "kaval";
import {
  assertDaemonSpawnAllowed,
  describeDaemon,
} from "@kolu/daemon-test-gate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { reapPadi, type StalePadi, stalePadis } from "./reapStale.ts";
import {
  PADI_GATE_FILE,
  padiKavalSocketPath,
  padiSocketPath,
} from "./stateRoot.ts";

/** Bind a real `net.Server` at `path` — discovery requires an actual socket
 *  inode, not merely an existing file. Mirrors `stateRoot.test.ts`. */
function listenSocket(path: string): Promise<Server> {
  return new Promise((res, rej) => {
    const server = createServer();
    server.once("error", rej);
    server.listen(path, () => res(server));
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((res) => server.close(() => res()));
}

/** A live child process whose pid stands in for a genuine gate holder. */
function liveChild(): ChildProcess {
  assertDaemonSpawnAllowed("a stand-in gate holder for the reaper to stop");
  return spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], {
    stdio: "ignore",
  });
}

/** Wait until `child` has exited, or reject once `ms` elapses — so a reaper that
 *  fails to kill shows up as a test failure rather than a hang. */
function awaitExit(child: ChildProcess, ms = 15_000): Promise<void> {
  return new Promise((res, rej) => {
    if (child.exitCode !== null || child.signalCode !== null) return res();
    const timer = setTimeout(
      () => rej(new Error("gate holder never exited")),
      ms,
    );
    child.on("exit", () => {
      clearTimeout(timer);
      res();
    });
  });
}

const servers: Server[] = [];
const dirs: string[] = [];
const children: ChildProcess[] = [];
const SAVED_XDG = process.env.XDG_RUNTIME_DIR;

/** Register a padi at `stateRoot` inside a fresh fabricated drawer: a real socket
 *  inode, the digest→state-root manifest, and (optionally) a `padi.pid` gate.
 *  Returns the drawer and the seeded socket path. */
async function seedPadi(
  stateRoot: string,
  gateHolder?: number,
): Promise<{ drawer: string; socket: string }> {
  const drawer = mkdtempSync(join(tmpdir(), "padi-reap-"));
  dirs.push(drawer);
  process.env.XDG_RUNTIME_DIR = drawer;
  const socket = padiSocketPath(stateRoot);
  mkdirSync(dirname(socket), { recursive: true, mode: 0o700 });
  writeStateRootManifest(dirname(socket), stateRoot);
  servers.push(await listenSocket(socket));
  if (gateHolder !== undefined) {
    writeFileSync(join(dirname(socket), PADI_GATE_FILE), `${gateHolder}\n`);
  }
  return { drawer, socket };
}

/** A state-root path that is guaranteed NOT to exist — a deleted worktree's
 *  `.kolu-dev/padi`, spelled the way `pnpm dev` spells it. */
function goneStateRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "padi-reap-worktree-"));
  rmSync(root, { recursive: true, force: true });
  return join(root, ".kolu-dev", "padi");
}

beforeEach(() => {
  process.env.XDG_RUNTIME_DIR = "/run/user/1000";
});

afterEach(async () => {
  for (const c of children.splice(0)) c.kill("SIGKILL");
  await Promise.all(servers.splice(0).map((s) => closeServer(s)));
  for (const d of dirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
  if (SAVED_XDG === undefined) delete process.env.XDG_RUNTIME_DIR;
  else process.env.XDG_RUNTIME_DIR = SAVED_XDG;
});

describe("stalePadis — proof gates the kill", () => {
  it("classifies a padi whose state-root is GONE as stale (the deleted-worktree ghost)", async () => {
    const stateRoot = goneStateRoot();
    const { drawer, socket } = await seedPadi(stateRoot);

    const stale = stalePadis([drawer]);
    expect(stale.some((d) => d.socket === socket)).toBe(true);
  });

  it("NEVER classifies a padi whose state-root still exists — production is not a candidate", async () => {
    // A state-root that is present on disk. This is production's shape (and any
    // worktree that still exists): the daemon is doing its job, so the sweep must
    // not see it however long it has been running.
    const stateRoot = mkdtempSync(join(tmpdir(), "padi-reap-live-"));
    dirs.push(stateRoot);
    const { drawer, socket } = await seedPadi(stateRoot);

    const stale = stalePadis([drawer]);
    expect(stale.some((d) => d.socket === socket)).toBe(false);
  });

  it("NEVER classifies a registration whose manifest is unreadable — no manifest, no proof", async () => {
    // Seed a socket + gate but NO `state-root` manifest, so discovery reports
    // `stateRoot: null`. We cannot prove what it is anchored to, so we must not
    // kill it — it stays visible in the raw discovery listing instead.
    const drawer = mkdtempSync(join(tmpdir(), "padi-reap-nomanifest-"));
    dirs.push(drawer);
    process.env.XDG_RUNTIME_DIR = drawer;
    const socket = padiSocketPath("/anything");
    mkdirSync(dirname(socket), { recursive: true, mode: 0o700 });
    servers.push(await listenSocket(socket));

    const stale = stalePadis([drawer]);
    expect(stale.some((d) => d.socket === socket)).toBe(false);
  });
});

/** The one seeded padi matching `socket`, as a {@link StalePadi} — fails the test
 *  rather than returning undefined, so a seeding mistake reads as a seeding
 *  mistake and not as a reaper bug. */
function stale(drawer: string, socket: string): StalePadi {
  const [target] = stalePadis([drawer]).filter((d) => d.socket === socket);
  if (target === undefined) throw new Error("seeded padi was not found stale");
  return target;
}

describeDaemon(
  "reapPadi — stops the holders, then clears the rendezvous",
  () => {
    it("SIGTERMs a LIVE gate holder and removes the padi + kaval runtime dirs", async () => {
      const stateRoot = goneStateRoot();
      const holder = liveChild();
      children.push(holder);
      const pid = holder.pid;
      if (pid === undefined) throw new Error("gate holder failed to start");

      const { drawer, socket } = await seedPadi(stateRoot, pid);
      // Seed the kaval side too, so the reap has both dirs to clear.
      const kavalSocket = padiKavalSocketPath(stateRoot);
      mkdirSync(dirname(kavalSocket), { recursive: true, mode: 0o700 });
      const target = stale(drawer, socket);

      // Release our stand-in listener before the reap removes the dir out from under
      // it; teardown would otherwise close a server whose inode is already gone.
      await closeServer(servers.pop() as Server);

      const reaped = await reapPadi(target);
      await awaitExit(holder);

      expect(reaped.padiPid).toBe(pid);
      expect(existsSync(dirname(socket))).toBe(false);
      expect(existsSync(dirname(kavalSocket))).toBe(false);
    });

    it("clears an ALREADY-DEAD holder's registration — the crashed-padi ghost", async () => {
      // No signal is deliverable here: the gate names a pid that has already exited.
      // That is a no-op success, not an error — clearing exactly this leftover is
      // half the point of the sweep.
      const stateRoot = goneStateRoot();
      const holder = liveChild();
      const pid = holder.pid;
      if (pid === undefined) throw new Error("gate holder failed to start");
      holder.kill("SIGKILL");
      await awaitExit(holder);

      const { drawer, socket } = await seedPadi(stateRoot, pid);
      const target = stale(drawer, socket);
      await closeServer(servers.pop() as Server);

      await expect(reapPadi(target)).resolves.toMatchObject({ padiPid: pid });
      expect(existsSync(dirname(socket))).toBe(false);
    });
  },
);
