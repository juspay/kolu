import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  assertDaemonSpawnAllowed,
  describeDaemon,
} from "@kolu/daemon-test-gate";
import { scrubDaemonLocatorEnv } from "@kolu/daemon-test-gate/setup";
import {
  PADI_GATE_FILE,
  padiDigest,
  padiGatePath,
  padiSocketPath,
  productionPadiStateRoot,
  resolvePadiStateRoot,
} from "@kolu/padi-client/rendezvous";
import { readStateRootManifest, writeStateRootManifest } from "kaval";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  classifyLivePadis,
  discoverPadiDaemons,
  localPadiSocket,
  namePadiStateRootForDiscovery,
  type PadiDaemon,
  padiKavalSocketPath,
  residentPadiSocket,
  resolveRunningPadiSocket,
} from "./stateRoot.ts";

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

function liveChild(): ChildProcess {
  assertDaemonSpawnAllowed("a short-lived liveness-probe child");
  return spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], {
    stdio: "ignore",
  });
}

function writeGate(socketDir: string, pid: number): void {
  writeFileSync(join(socketDir, PADI_GATE_FILE), `${pid}\n`, { mode: 0o600 });
}

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

const SAVED = {
  XDG_STATE_HOME: process.env.XDG_STATE_HOME,
  XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR,
  HOME: process.env.HOME,
  KOLU_PADI_STATE_DIR: process.env.KOLU_PADI_STATE_DIR,
  PADI_SOCKET: process.env.PADI_SOCKET,
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
    try {
      resolvePadiStateRoot();
    } catch (e) {
      expect((e as Error).message).toMatch(
        /Relative paths are resolved against cwd/,
      );
      expect((e as Error).message).not.toMatch(/absolute directory/);
    }
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

describe("the primary padi — which one a flag-less client dials among several (#2154)", () => {
  const servers: Server[] = [];
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => closeServer(s)));
    for (const d of dirs.splice(0)) {
      rmSync(d, { recursive: true, force: true });
    }
  });

  async function registerLivePadi(stateRoot: string): Promise<string> {
    const socket = padiSocketPath(stateRoot);
    mkdirSync(dirname(socket), { recursive: true, mode: 0o700 });
    writeStateRootManifest(dirname(socket), stateRoot);
    writeGate(dirname(socket), process.pid);
    servers.push(await listenSocket(socket));
    return socket;
  }

  function pinFreshHost(): string {
    scrubDaemonLocatorEnv();
    const home = mkdtempSync(join(tmpdir(), "padi-primary-home-"));
    dirs.push(home);
    const drawer = mkdtempSync(join(tmpdir(), "padi-primary-drawer-"));
    dirs.push(drawer);
    process.env.HOME = home;
    process.env.XDG_RUNTIME_DIR = drawer;
    return join(home, ".local", "state", "padi");
  }

  it("dials the daemon keyed to this environment's state root, though a dev daemon is live too", async () => {
    const primaryRoot = pinFreshHost();
    const devSocket = await registerLivePadi(
      join(primaryRoot, "..", "dev-e2e"),
    );
    const primarySocket = await registerLivePadi(primaryRoot);
    expect(devSocket).not.toBe(primarySocket);

    const resolved = resolveRunningPadiSocket();
    expect(resolved).toMatchObject({ kind: "primary", socket: primarySocket });
    expect(localPadiSocket({ kind: "auto" })).toEqual({
      kind: "ok",
      socket: primarySocket,
    });
  });

  it("still refuses when several are live and NONE is this environment's — naming the root it looked for", async () => {
    const primaryRoot = pinFreshHost();
    const a = await registerLivePadi(join(primaryRoot, "..", "worktree-a"));
    const b = await registerLivePadi(join(primaryRoot, "..", "worktree-b"));

    const resolved = resolveRunningPadiSocket();
    expect(resolved.kind).toBe("many");

    const refusal = localPadiSocket({ kind: "auto" });
    expect(refusal.kind).toBe("unaddressable");
    if (refusal.kind !== "unaddressable") throw new Error("unreachable");
    expect(refusal.message).toContain(primaryRoot);
    expect(refusal.message).toContain(`PADI_SOCKET=${a}`);
    expect(refusal.message).toContain(`PADI_SOCKET=${b}`);
  });

  it("finds the primary even when it bound under /tmp and this shell has XDG set", async () => {
    const uid = process.getuid?.();
    if (uid === undefined) return;
    const primaryRoot = pinFreshHost();
    const drawer = process.env.XDG_RUNTIME_DIR;

    delete process.env.XDG_RUNTIME_DIR;
    const tmpSocket = await registerLivePadi(primaryRoot);
    dirs.push(dirname(tmpSocket));
    expect(tmpSocket.startsWith("/tmp/")).toBe(true);

    process.env.XDG_RUNTIME_DIR = drawer;
    const resolved = resolveRunningPadiSocket();
    expect(resolved).toMatchObject({ socket: tmpSocket });
    expect(["one", "primary"]).toContain(resolved.kind);
    expect(localPadiSocket({ kind: "auto" })).toEqual({
      kind: "ok",
      socket: tmpSocket,
    });
  });
});

describe("classifyLivePadis — which of the live daemons, as pure data", () => {
  const daemon = (stateRoot: string | null, socket: string): PadiDaemon => ({
    socket,
    stateRoot,
    gatePid: 1234,
  });
  const PROD = "/home/u/.local/state/padi";

  beforeEach(() => {
    process.env.HOME = "/home/u";
    delete process.env.KOLU_PADI_STATE_DIR;
  });

  it("dials a SOLE live daemon whatever its root — the flag-less dev box, unchanged", () => {
    const resolved = classifyLivePadis([
      daemon("/tmp/dev/padi", "/run/d.sock"),
    ]);
    expect(resolved).toEqual({ kind: "one", socket: "/run/d.sock" });
  });

  it("picks the daemon serving this environment's root when several are live", () => {
    const resolved = classifyLivePadis([
      daemon("/tmp/dev/padi", "/run/dev.sock"),
      daemon(PROD, "/run/prod.sock"),
    ]);
    expect(resolved).toEqual({ kind: "primary", socket: "/run/prod.sock" });
  });

  it("honors $KOLU_PADI_STATE_DIR over the production formula", () => {
    process.env.KOLU_PADI_STATE_DIR = "/tmp/dev/padi";
    const resolved = classifyLivePadis([
      daemon("/tmp/dev/padi", "/run/dev.sock"),
      daemon(PROD, "/run/prod.sock"),
    ]);
    expect(resolved).toEqual({ kind: "primary", socket: "/run/dev.sock" });
  });

  it("matches on the RESOLVED path, so two spellings of one root are one daemon", () => {
    const resolved = classifyLivePadis([
      daemon("/tmp/dev/padi", "/run/dev.sock"),
      daemon("/home/u/./x/../.local/state/padi", "/run/prod.sock"),
    ]);
    expect(resolved).toEqual({ kind: "primary", socket: "/run/prod.sock" });
  });

  it("refuses when several are live and none serves this environment's root", () => {
    const live = [
      daemon("/tmp/a/padi", "/run/a.sock"),
      daemon("/tmp/b/padi", "/run/b.sock"),
    ];
    expect(classifyLivePadis(live)).toEqual({
      kind: "many",
      runningPadis: live,
      unmatchedStateRoot: PROD,
    });
  });

  it("never assumes a manifest-less daemon is primary — an unlabeled registration is not an identity", () => {
    const live = [daemon(null, "/run/bare.sock"), daemon(null, "/run/b2.sock")];
    expect(classifyLivePadis(live).kind).toBe("many");
  });

  it("names a socket for the error path when none is live — never a throwing bind resolve", () => {
    const resolved = classifyLivePadis([]);
    expect(resolved).toEqual({ kind: "none", socket: padiSocketPath(PROD) });
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

describe("discoverPadiDaemons — the regime in force, plus the extra drawers", () => {
  const servers: Server[] = [];
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => closeServer(s)));
    for (const d of dirs.splice(0)) {
      rmSync(d, { recursive: true, force: true });
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

    const found = discoverPadiDaemons([drawer]);
    expect(found.filter((d) => d.socket === socket)).toHaveLength(1);
  });

  it.runIf(process.getuid)(
    "does NOT walk /tmp while $XDG_RUNTIME_DIR is set, and does once it is not",
    async () => {
      const stateRoot = "/home/u/.local/state/padi-tmp-regime";
      delete process.env.XDG_RUNTIME_DIR;
      const socket = padiSocketPath(stateRoot);
      mkdirSync(dirname(socket), { recursive: true, mode: 0o700 });
      dirs.push(dirname(socket));
      writeStateRootManifest(dirname(socket), stateRoot);
      servers.push(await listenSocket(socket));

      expect(discoverPadiDaemons([]).some((d) => d.socket === socket)).toBe(
        true,
      );

      const drawer = mkdtempSync(join(tmpdir(), "padi-discover-xdg-"));
      dirs.push(drawer);
      process.env.XDG_RUNTIME_DIR = drawer;
      expect(discoverPadiDaemons([]).some((d) => d.socket === socket)).toBe(
        false,
      );
    },
  );

  it.runIf(process.getuid)(
    "both DIAL paths still find a /tmp resident while $XDG_RUNTIME_DIR is set",
    async () => {
      const stateRoot = "/home/u/.local/state/padi-adopt-regime";
      delete process.env.XDG_RUNTIME_DIR;
      const socket = padiSocketPath(stateRoot);
      const dir = dirname(socket);
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      dirs.push(dir);
      writeStateRootManifest(dir, stateRoot);
      writeFileSync(join(dir, PADI_GATE_FILE), String(process.pid), {
        mode: 0o600,
      });
      servers.push(await listenSocket(socket));

      const drawer = mkdtempSync(join(tmpdir(), "padi-adopt-xdg-"));
      dirs.push(drawer);
      process.env.XDG_RUNTIME_DIR = drawer;
      expect(residentPadiSocket(stateRoot)).toBe(socket);
    },
  );
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
        rmSync(d, { recursive: true, force: true });
      }
    });

    it("a manifest naming a socket at drawer A wins over a caller whose own env computes drawer B", async () => {
      const stateRoot = mkdtempSync(join(tmpdir(), "padi-resident-sr-"));
      dirs.push(stateRoot);
      const drawerA = mkdtempSync(join(tmpdir(), "padi-resident-drawerA-"));
      dirs.push(drawerA);
      const drawerB = mkdtempSync(join(tmpdir(), "padi-resident-drawerB-"));
      dirs.push(drawerB);

      process.env.XDG_RUNTIME_DIR = drawerA;
      const residentSocket = padiSocketPath(stateRoot);
      mkdirSync(dirname(residentSocket), { recursive: true, mode: 0o700 });
      writeStateRootManifest(dirname(residentSocket), stateRoot);
      writeGate(dirname(residentSocket), process.pid);
      servers.push(await listenSocket(residentSocket));

      process.env.XDG_RUNTIME_DIR = drawerB;
      const ownComputedSocket = padiSocketPath(stateRoot);
      expect(ownComputedSocket).not.toBe(residentSocket);

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
      const socket = padiSocketPath(otherStateRoot);
      mkdirSync(dirname(socket), { recursive: true, mode: 0o700 });
      writeStateRootManifest(dirname(socket), otherStateRoot);
      servers.push(await listenSocket(socket));

      expect(residentPadiSocket(stateRoot, [drawer])).toBeUndefined();
    });

    it("PIN: with a DEAD-gate drawer and a LIVE-gate drawer both naming the same state-root, returns the LIVE one — never the dead one", async () => {
      const stateRoot = mkdtempSync(join(tmpdir(), "padi-resident-live-sr-"));
      dirs.push(stateRoot);
      const deadDrawer = mkdtempSync(join(tmpdir(), "padi-resident-dead-"));
      dirs.push(deadDrawer);
      const liveDrawer = mkdtempSync(join(tmpdir(), "padi-resident-live-"));
      dirs.push(liveDrawer);

      process.env.XDG_RUNTIME_DIR = deadDrawer;
      const deadSocket = padiSocketPath(stateRoot);
      mkdirSync(dirname(deadSocket), { recursive: true, mode: 0o700 });
      writeStateRootManifest(dirname(deadSocket), stateRoot);
      writeGate(dirname(deadSocket), await deadPid());
      servers.push(await listenSocket(deadSocket));

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
