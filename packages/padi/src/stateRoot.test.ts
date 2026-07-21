/**
 * padi's identity mechanics — the production state-root formula, bind resolution
 * that refuses a silent default (#1334), the digest that keys the runtime
 * rendezvous, and the manifest that maps the digest back. The load-bearing
 * property under test is #1313 ISOLATION: distinct state-roots yield distinct
 * digests, so two padis never share a kaval; an identical state-root yields an
 * identical digest, so a re-boot dials the same daemon.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { readStateRootManifest, writeStateRootManifest } from "kaval";
import {
  assertDaemonSpawnAllowed,
  describeDaemon,
} from "@kolu/daemon-test-gate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  productionPadiStateRoot,
  namePadiStateRootForDiscovery,
  discoverPadiDaemons,
  PADI_GATE_FILE,
  padiDigest,
  padiGatePath,
  padiKavalSocketPath,
  padiSocketPath,
  residentPadiSocket,
  resolvePadiStateRoot,
} from "./stateRoot.ts";

/** A pid that is definitely dead — spawn a child, kill it, await its exit. Mirrors
 *  `surface-daemon/src/pidGate.test.ts`'s `deadPid` — the same real-OS-pid pattern
 *  for the liveness probe (`isHolderLive` reads a genuinely gone pid as dead). */
async function deadPid(): Promise<number> {
  assertDaemonSpawnAllowed("a short-lived liveness-probe child");
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  const pid = child.pid;
  if (pid === undefined) throw new Error("child failed to start");
  await new Promise<void>((res) => {
    child.on("exit", () => res());
    child.kill("SIGKILL");
  });
  return pid;
}

/** A live child process whose pid stands in for a genuine gate holder. */
function liveChild(): ChildProcess {
  assertDaemonSpawnAllowed("a short-lived liveness-probe child");
  return spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], {
    stdio: "ignore",
  });
}

/** Write a `padi.pid` gate file naming `pid`, beside a socket at `socketDir`. */
function writeGate(socketDir: string, pid: number): void {
  writeFileSync(join(socketDir, PADI_GATE_FILE), `${pid}\n`);
}

/** Bind a real `net.Server` at `path`, leaving a genuine socket inode behind —
 *  discovery requires the rendezvous file to be an actual socket, not just an
 *  existing file. Returns the server so the caller can close it on teardown. */
function listenSocket(path: string): Promise<Server> {
  return new Promise((res, rej) => {
    const server = createServer();
    server.once("error", rej);
    server.listen(path, () => res(server));
  });
}

/** Close a seeded server, removing its socket inode. */
function closeServer(server: Server): Promise<void> {
  return new Promise((res) => server.close(() => res()));
}

// Save + restore the env the helpers read, so cases can pin each branch without
// leaking into siblings.
const SAVED = {
  XDG_STATE_HOME: process.env.XDG_STATE_HOME,
  XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR,
  HOME: process.env.HOME,
  KOLU_PADI_STATE_DIR: process.env.KOLU_PADI_STATE_DIR,
};
beforeEach(() => {
  process.env.XDG_RUNTIME_DIR = "/run/user/1000";
});
afterEach(() => {
  for (const [k, v] of Object.entries(SAVED)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("productionPadiStateRoot — the production formula (wrappers + discovery)", () => {
  it("IGNORES $XDG_STATE_HOME — HOME-only, so two launch contexts can't split padi's identity", () => {
    // Even with $XDG_STATE_HOME set (a login shell), the formula is env-INSENSITIVE:
    // HOME-only, so a context WITHOUT it (a bare systemd unit, an ssh exec) resolves
    // the exact SAME root and the digest never diverges.
    process.env.XDG_STATE_HOME = "/somewhere/else/state";
    process.env.HOME = "/home/u";
    expect(productionPadiStateRoot()).toBe("/home/u/.local/state/padi");
  });

  it("is $HOME/.local/state/padi with no $XDG_STATE_HOME either", () => {
    delete process.env.XDG_STATE_HOME;
    process.env.HOME = "/home/u";
    expect(productionPadiStateRoot()).toBe("/home/u/.local/state/padi");
  });

  it("crashes loudly with no anchor — never a silent throwaway path", () => {
    delete process.env.XDG_STATE_HOME;
    delete process.env.HOME;
    // homedir() may still resolve from the passwd entry, so only assert the throw
    // when there is genuinely no anchor. On a box where homedir() answers, this
    // returns a real path — which is the point (never a throwaway). We assert the
    // shape either way: a resolved absolute path, or a loud throw.
    try {
      expect(productionPadiStateRoot()).toMatch(/^\/.*\/padi$/);
    } catch (e) {
      expect((e as Error).message).toContain(
        "cannot resolve the production state-root formula",
      );
    }
  });
});

describe("resolvePadiStateRoot — override wins, always absolute, no silent default (#1334)", () => {
  it("resolves an explicit override to an absolute path", () => {
    expect(resolvePadiStateRoot("/srv/padi")).toBe("/srv/padi");
    expect(resolvePadiStateRoot("relative/dir")).toBe(resolve("relative/dir"));
  });

  it("reads KOLU_PADI_STATE_DIR when no explicit override", () => {
    process.env.KOLU_PADI_STATE_DIR = "/e2e/worker-3/padi";
    expect(resolvePadiStateRoot()).toBe("/e2e/worker-3/padi");
  });

  it("crashes with neither override nor env — bare launch cannot inherit production (#1334)", () => {
    delete process.env.KOLU_PADI_STATE_DIR;
    process.env.HOME = "/home/u";
    expect(() => resolvePadiStateRoot()).toThrow(
      /KOLU_PADI_STATE_DIR must be set/,
    );
    expect(() => resolvePadiStateRoot()).toThrow(/1334/);
    // Relative paths are supported when provided — message must not claim
    // "absolute only" (codex F4).
    expect(resolvePadiStateRoot("relative/padi")).toBe(resolve("relative/padi"));
  });
});

describe("namePadiStateRootForDiscovery — dial/error naming (not bind)", () => {
  it("honors KOLU_PADI_STATE_DIR when set (isolated dev/e2e chair)", () => {
    process.env.KOLU_PADI_STATE_DIR = "/e2e/worker-9/padi";
    process.env.HOME = "/home/u";
    expect(namePadiStateRootForDiscovery()).toBe("/e2e/worker-9/padi");
    expect(namePadiStateRootForDiscovery()).not.toBe(productionPadiStateRoot());
  });

  it("falls to the production formula when env is unset", () => {
    delete process.env.KOLU_PADI_STATE_DIR;
    process.env.HOME = "/home/u";
    expect(namePadiStateRootForDiscovery()).toBe("/home/u/.local/state/padi");
  });
});

describe("padiDigest — the rendezvous key (#1313 isolation)", () => {
  it("is deterministic — the same state-root always keys the same daemon", () => {
    expect(padiDigest("/home/u/.local/state/padi")).toBe(
      padiDigest("/home/u/.local/state/padi"),
    );
  });

  it("is stable under path spelling — resolve normalizes . and ..", () => {
    expect(padiDigest("/a/b")).toBe(padiDigest("/a/./b"));
    expect(padiDigest("/a/b")).toBe(padiDigest("/a/x/../b"));
  });

  it("distinct state-roots yield distinct digests (the isolation property)", () => {
    expect(padiDigest("/home/a/padi")).not.toBe(padiDigest("/home/b/padi"));
  });

  it("is a short lowercase-hex slice (a short socket path, any state-root depth)", () => {
    expect(padiDigest("/some/deep/nested/state/root")).toMatch(
      /^[0-9a-f]{16}$/,
    );
  });
});

describe("the digest-keyed rendezvous paths", () => {
  it("padi serves at $XDG_RUNTIME_DIR/padi-<digest>/padi.sock", () => {
    const sr = "/home/u/.local/state/padi";
    const d = padiDigest(sr);
    expect(padiSocketPath(sr)).toBe(`/run/user/1000/padi-${d}/padi.sock`);
  });

  it("padi's kaval serves at kaval-<digest>/pty-host.sock — SAME digest", () => {
    const sr = "/home/u/.local/state/padi";
    const d = padiDigest(sr);
    expect(padiKavalSocketPath(sr)).toBe(
      `/run/user/1000/kaval-${d}/pty-host.sock`,
    );
  });

  it("padi and its kaval are distinct dirs under the same digest", () => {
    const sr = "/home/u/.local/state/padi";
    expect(dirname(padiSocketPath(sr))).not.toBe(
      dirname(padiKavalSocketPath(sr)),
    );
  });

  it("two padis at distinct state-roots get distinct kaval sockets (#1313)", () => {
    expect(padiKavalSocketPath("/home/a/padi")).not.toBe(
      padiKavalSocketPath("/home/b/padi"),
    );
  });

  it("an explicit socket override wins verbatim", () => {
    expect(padiSocketPath("/any/sr", "/tmp/pinned/padi.sock")).toBe(
      "/tmp/pinned/padi.sock",
    );
  });

  it("the gate sits beside the socket as padi.pid", () => {
    expect(padiGatePath("/run/user/1000/padi-abc/padi.sock")).toBe(
      "/run/user/1000/padi-abc/padi.pid",
    );
  });
});

describe("the state-root manifest (digest → state-root)", () => {
  it("round-trips the state-root through the runtime dir", () => {
    const dir = mkdtempSync(join(tmpdir(), "padi-manifest-"));
    writeStateRootManifest(dir, "/home/u/.local/state/padi");
    expect(readStateRootManifest(dir)).toBe("/home/u/.local/state/padi");
  });

  it("reads undefined from a dir with no manifest (a bare / legacy daemon)", () => {
    const dir = mkdtempSync(join(tmpdir(), "padi-nomanifest-"));
    expect(readStateRootManifest(dir)).toBeUndefined();
  });

  it("creates the 0700 dir if absent (padi writes kaval's before it binds)", () => {
    const parent = mkdtempSync(join(tmpdir(), "padi-mkmanifest-"));
    const dir = join(parent, "kaval-deadbeef");
    writeStateRootManifest(dir, "/srv/padi");
    expect(readStateRootManifest(dir)).toBe("/srv/padi");
  });
});

// THE #1713 ADOPT-PATH SIBLING: `ensurePadiBinding`'s wait side must DISCOVER a
// resident's socket via the state-root manifest read-back, not compute it from its
// own env — a resident spawned in a session with `$XDG_RUNTIME_DIR` SET is
// otherwise invisible to a waiter whose own env lacks it (a bare `nix run` outside
// a login session), which reproduced as a 30s "daemon socket never came up" hang.
// `extraRegimes` lets these tests substitute a fabricated drawer for the real
// `/run/user/$UID` guess (a unit test cannot write there outside a real session).
describe("discoverPadiDaemons — unions every drawer a padi could be registered under", () => {
  const servers: Server[] = [];
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => closeServer(s)));
    for (const d of dirs.splice(0)) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    }
  });

  it("finds a resident registered under an EXTRA regime the caller's own env does not cover", async () => {
    const stateRoot = "/home/u/.local/state/padi";
    const drawer = mkdtempSync(join(tmpdir(), "padi-discover-extra-"));
    dirs.push(drawer);
    process.env.XDG_RUNTIME_DIR = drawer;
    const socket = padiSocketPath(stateRoot);
    mkdirSync(dirname(socket), { recursive: true, mode: 0o700 });
    writeStateRootManifest(dirname(socket), stateRoot);
    servers.push(await listenSocket(socket));

    // The caller's OWN env computes an entirely different (empty) drawer — the
    // resident is found ONLY via the extra regime, proving the union (not the
    // caller's own-env regime alone) is what discovers it.
    const ownDrawer = mkdtempSync(join(tmpdir(), "padi-discover-own-"));
    dirs.push(ownDrawer);
    process.env.XDG_RUNTIME_DIR = ownDrawer;

    const found = discoverPadiDaemons([drawer]);
    expect(
      found.some((d) => d.socket === socket && d.stateRoot === stateRoot),
    ).toBe(true);
  });

  it("de-dupes when a regime coincides with the caller's own env (no double-counting)", async () => {
    const stateRoot = "/home/u/.local/state/padi";
    const drawer = mkdtempSync(join(tmpdir(), "padi-discover-dedupe-"));
    dirs.push(drawer);
    process.env.XDG_RUNTIME_DIR = drawer;
    const socket = padiSocketPath(stateRoot);
    mkdirSync(dirname(socket), { recursive: true, mode: 0o700 });
    writeStateRootManifest(dirname(socket), stateRoot);
    servers.push(await listenSocket(socket));

    // The "extra" regime is the SAME drawer the caller's own env already computes.
    const found = discoverPadiDaemons([drawer]);
    expect(found.filter((d) => d.socket === socket)).toHaveLength(1);
  });
});

describeDaemon(
  "residentPadiSocket — the ADOPT-PATH manifest read-back (#1713 adopt-path sibling)",
  () => {
    const servers: Server[] = [];
    const dirs: string[] = [];
    const children: ChildProcess[] = [];
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
    });

    it("a manifest naming a socket at drawer A wins over a caller whose own env computes drawer B", async () => {
      const stateRoot = mkdtempSync(join(tmpdir(), "padi-resident-sr-"));
      dirs.push(stateRoot);
      const drawerA = mkdtempSync(join(tmpdir(), "padi-resident-drawerA-"));
      dirs.push(drawerA);
      const drawerB = mkdtempSync(join(tmpdir(), "padi-resident-drawerB-"));
      dirs.push(drawerB);

      // The resident: construct its socket path EXACTLY as a real padi would, under
      // drawer A's regime, write its manifest + a gate naming a LIVE pid (this test
      // process itself — any live pid proves the liveness filter, #1713-delta-review
      // finding 1), and bind a real socket there.
      process.env.XDG_RUNTIME_DIR = drawerA;
      const residentSocket = padiSocketPath(stateRoot);
      mkdirSync(dirname(residentSocket), { recursive: true, mode: 0o700 });
      writeStateRootManifest(dirname(residentSocket), stateRoot);
      writeGate(dirname(residentSocket), process.pid);
      servers.push(await listenSocket(residentSocket));

      // The caller's OWN env computes a DIFFERENT drawer (B) — the exact
      // env-divergence that reproduces the bug (an XDG-unset kolu against an
      // XDG-set resident is the real-world instance; two distinct temp dirs prove
      // the general case without depending on any process's real environment).
      process.env.XDG_RUNTIME_DIR = drawerB;
      const ownComputedSocket = padiSocketPath(stateRoot);
      expect(ownComputedSocket).not.toBe(residentSocket); // sanity: genuinely different drawers

      // The resolver returns drawer A's socket — the manifest wins over the
      // caller's own-env guess. `drawerA` stands in for the real `/run/user/$UID`
      // guess (a unit test can't write there).
      expect(residentPadiSocket(stateRoot, [drawerA])).toBe(residentSocket);
    });

    it("returns undefined when no candidate drawer holds a resident — the caller spawns at its own drawer, unchanged", () => {
      const stateRoot = mkdtempSync(join(tmpdir(), "padi-resident-none-sr-"));
      dirs.push(stateRoot);
      const ownDrawer = mkdtempSync(join(tmpdir(), "padi-resident-none-own-"));
      dirs.push(ownDrawer);
      const extraDrawer = mkdtempSync(
        join(tmpdir(), "padi-resident-none-extra-"),
      );
      dirs.push(extraDrawer);
      process.env.XDG_RUNTIME_DIR = ownDrawer;
      expect(residentPadiSocket(stateRoot, [extraDrawer])).toBeUndefined();
    });

    it("ignores a candidate whose manifest names a DIFFERENT state-root (never a bare digest-path guess)", async () => {
      const stateRoot = mkdtempSync(join(tmpdir(), "padi-resident-other-sr-"));
      dirs.push(stateRoot);
      const otherStateRoot = mkdtempSync(
        join(tmpdir(), "padi-resident-other2-sr-"),
      );
      dirs.push(otherStateRoot);
      const drawer = mkdtempSync(join(tmpdir(), "padi-resident-other-drawer-"));
      dirs.push(drawer);

      process.env.XDG_RUNTIME_DIR = drawer;
      // A padi IS running at this drawer, but for a DIFFERENT state-root.
      const socket = padiSocketPath(otherStateRoot);
      mkdirSync(dirname(socket), { recursive: true, mode: 0o700 });
      writeStateRootManifest(dirname(socket), otherStateRoot);
      servers.push(await listenSocket(socket));

      expect(residentPadiSocket(stateRoot, [drawer])).toBeUndefined();
    });

    // Delta-re-review finding 1 (P1): a manifest match ALONE is not proof of a live
    // resident — a crashed padi's `/tmp` registration (inode + manifest both survive a
    // crash) can SHADOW a genuinely live resident registered in a later regime.
    // `residentPadiSocket` must filter matches by GATE-PID LIVENESS, preferring a live
    // resident and never returning a dead-only match (which would adopt a socket
    // nothing answers on, or cause a second padi to spawn onto an already-served state
    // root).
    it("PIN: with a DEAD-gate drawer and a LIVE-gate drawer both naming the same state-root, returns the LIVE one — never the dead one", async () => {
      const stateRoot = mkdtempSync(join(tmpdir(), "padi-resident-live-sr-"));
      dirs.push(stateRoot);
      const deadDrawer = mkdtempSync(join(tmpdir(), "padi-resident-dead-"));
      dirs.push(deadDrawer);
      const liveDrawer = mkdtempSync(join(tmpdir(), "padi-resident-live-"));
      dirs.push(liveDrawer);

      // The DEAD registration: a crashed padi's leftover inode + manifest + a gate
      // naming a pid that is genuinely gone. Its socket still accepts connections
      // (nothing unlinked it) — the exact "stale but still discoverable" shape a
      // crash leaves behind, so discovery finds it and only the gate-pid liveness
      // check can tell it apart from a live resident.
      process.env.XDG_RUNTIME_DIR = deadDrawer;
      const deadSocket = padiSocketPath(stateRoot);
      mkdirSync(dirname(deadSocket), { recursive: true, mode: 0o700 });
      writeStateRootManifest(dirname(deadSocket), stateRoot);
      writeGate(dirname(deadSocket), await deadPid());
      servers.push(await listenSocket(deadSocket));

      // The LIVE registration, in a LATER regime — a genuinely running resident.
      process.env.XDG_RUNTIME_DIR = liveDrawer;
      const liveSocket = padiSocketPath(stateRoot);
      mkdirSync(dirname(liveSocket), { recursive: true, mode: 0o700 });
      writeStateRootManifest(dirname(liveSocket), stateRoot);
      const child = liveChild();
      children.push(child);
      if (child.pid === undefined)
        throw new Error("live child failed to start");
      writeGate(dirname(liveSocket), child.pid);
      servers.push(await listenSocket(liveSocket));

      // The caller's own env computes neither drawer directly — both are supplied as
      // extra regimes, exactly like the real /tmp + /run/user/$UID union.
      const caller = mkdtempSync(join(tmpdir(), "padi-resident-live-caller-"));
      dirs.push(caller);
      process.env.XDG_RUNTIME_DIR = caller;

      expect(residentPadiSocket(stateRoot, [deadDrawer, liveDrawer])).toBe(
        liveSocket,
      );
    });

    it("PIN: with ONLY a dead-gate manifest match, returns undefined — never a stale socket that would shadow a fresh spawn", async () => {
      const stateRoot = mkdtempSync(
        join(tmpdir(), "padi-resident-onlydead-sr-"),
      );
      dirs.push(stateRoot);
      const deadDrawer = mkdtempSync(join(tmpdir(), "padi-resident-onlydead-"));
      dirs.push(deadDrawer);

      process.env.XDG_RUNTIME_DIR = deadDrawer;
      const deadSocket = padiSocketPath(stateRoot);
      mkdirSync(dirname(deadSocket), { recursive: true, mode: 0o700 });
      writeStateRootManifest(dirname(deadSocket), stateRoot);
      writeGate(dirname(deadSocket), await deadPid());
      servers.push(await listenSocket(deadSocket));

      const caller = mkdtempSync(
        join(tmpdir(), "padi-resident-onlydead-caller-"),
      );
      dirs.push(caller);
      process.env.XDG_RUNTIME_DIR = caller;

      expect(residentPadiSocket(stateRoot, [deadDrawer])).toBeUndefined();
    });
  },
);
