/**
 * RemoteTerminalEndpoint (hermetic — mock HostSession + fake watcher client).
 *
 * No ssh, no real session: `getHostSession` is mocked to a fake session whose
 * `acquire()` hands back an in-process fake watcher client, and the mirror pump
 * is parked (cursor never advances) so the constructor's async bridge stays
 * inert. We assert the deterministic seam behaviour:
 *   - fs/git one-shots FORWARD to the watcher client,
 *   - `spawnPty` returns a sync shadow + registers immediately (invariant #3),
 *   - the session's `onState` drives publishDaemonStatus, mapped onto the wire
 *     enum (copying/disconnected/failed → connecting/degraded/dead).
 */

import { afterEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => {
  const surface = {
    git: {
      getStatus: vi.fn(async () => ({ files: [], base: null })),
      getDiff: vi.fn(async () => ({
        oldFileName: null,
        newFileName: "a.ts",
        hunks: [],
        binary: false,
      })),
      worktreeCreate: vi.fn(async () => ({
        path: "/r/.worktrees/wt",
        branch: "wt",
      })),
      worktreeRemove: vi.fn(async () => undefined),
    },
    fs: {
      listAll: vi.fn(async () => ({ paths: ["README.md"] })),
      readFile: vi.fn(async () => ({ content: "x", truncated: false })),
      statFileMtimeMs: vi.fn(async () => ({ mtimeMs: 7 })),
      writeFile: vi.fn(async () => ({ path: "/scratch/term/image.png" })),
    },
    terminal: {
      spawn: vi.fn(async () => ({ id: "t", pid: 99, cwd: "/r" })),
      kill: vi.fn(async () => ({ ok: true })),
      killAll: vi.fn(async () => ({ killed: 0 })),
    },
    terminalAttach: {
      // One snapshot frame then close — enough to drive attach()'s first-frame
      // read without hanging.
      get: vi.fn(async () => ({
        async *[Symbol.asyncIterator]() {
          yield { kind: "snapshot", data: "screen" };
        },
      })),
    },
    system: {
      info: vi.fn(async () => ({
        shell: "/bin/sh",
        home: "/h",
        platform: "linux",
        rcDir: "/h/.rc",
        path: "/usr/bin:/bin",
      })),
      // The absorbed pty-host `system.version` — the remote endpoint queries it
      // once on connect to fold the remote kaval's identity + startedAt onto the
      // published daemonStatus.
      version: vi.fn(async () => ({
        contractVersion: "3.0",
        pid: 42,
        startedAt: 1700,
        identity: { staleKey: "rk-stale", navigableCommit: "rk-commit" },
      })),
      heartbeat: vi.fn(async () => ({ ts: 0 })),
    },
  };
  const client = { surface };
  let onState: ((s: unknown) => void) | undefined;
  const session = {
    acquire: vi.fn(async () => client),
    release: vi.fn(),
    onState: vi.fn((cb: (s: unknown) => void) => {
      onState = cb;
      return () => {};
    }),
    pin: vi.fn(() => new Promise<never>(() => {})),
    isDestroyed: () => false,
    markConnected: vi.fn(),
    destroy: vi.fn(),
  };
  return {
    surface,
    session,
    // The real HostSessionState always carries `progressLines` (cell-init []);
    // model it so `mapDaemonStatus`'s `[...s.progressLines]` has a valid source.
    pushState: (connection: string, progressLines: string[] = []) =>
      onState?.({ connection, progressLines }),
  };
});

const publishDaemonStatus = vi.hoisted(() => vi.fn());
const registry = vi.hoisted(() => ({ entries: new Map<string, unknown>() }));

vi.mock("@kolu/surface-nix-host", () => ({
  getHostSession: () => fake.session,
  // Park the mirror pump — the cursor never yields a client, so bridge() idles.
  makeClientCursor: () => ({ next: () => new Promise<never>(() => {}) }),
  mirrorRemoteCollection: () => new Promise<never>(() => {}),
}));
vi.mock("../ptyHost/daemonStatus.ts", () => ({ publishDaemonStatus }));
vi.mock("../ptyHost/index.ts", () => ({
  composeRemoteSpawnInput: () => ({
    argv: ["/bin/sh"],
    cwd: "/r",
    env: {},
    initFiles: [],
  }),
}));
vi.mock("./metadata.ts", () => ({
  createMetadata: (cwd: string) => ({
    cwd,
    git: null,
    lastActivityAt: 0,
    pr: { kind: "absent" },
    agent: null,
    foreground: null,
  }),
  applyInitialMetadata: vi.fn(),
}));
vi.mock("../surfaceCtx.ts", () => ({
  surfaceCtx: {
    cells: { terminalList: { set: vi.fn() } },
    collections: { terminalMetadata: { upsert: vi.fn(), remove: vi.fn() } },
    events: { terminalExit: { publish: vi.fn() } },
  },
}));
vi.mock("../publisher.ts", () => ({
  terminalsDirtyChannel: { publish: vi.fn() },
}));
vi.mock("../log.ts", () => ({
  log: { info: vi.fn(), error: vi.fn(), child: () => ({ info: vi.fn() }) },
}));
vi.mock("../terminal-registry.ts", () => ({
  registerTerminal: (id: string, entry: unknown) =>
    registry.entries.set(id, entry),
  getTerminal: (id: string) => registry.entries.get(id),
  unregisterTerminal: (id: string) => registry.entries.delete(id),
  listTerminals: () =>
    [...registry.entries.values()].map((e) => (e as { info: unknown }).info),
}));

import { TerminalServerMetadataSchema } from "kolu-common/surface";
import { surfaceCtx } from "../surfaceCtx.ts";
import { RemoteTerminalEndpoint, SERVER_META_KEYS } from "./remote.ts";

function makeEndpoint() {
  return new RemoteTerminalEndpoint({
    hostId: "prod",
    host: "nix@prod",
    resolveDrvPath: async () => "/drv",
  });
}

afterEach(() => {
  registry.entries.clear();
  vi.clearAllMocks();
});

describe("RemoteTerminalEndpoint", () => {
  it("forwards fs/git one-shots to the watcher client", async () => {
    const ep = makeEndpoint();
    expect((await ep.git.getStatus("/r", "local")).files).toEqual([]);
    expect(fake.surface.git.getStatus).toHaveBeenCalledWith({
      repoPath: "/r",
      mode: "local",
    });
    expect((await ep.fs.listAll("/r")).paths).toContain("README.md");
    expect(await ep.fs.statFileMtimeMs("/r", "a")).toBe(7); // unwrapped from { mtimeMs }
  });

  it("spawnPty returns a sync shadow and registers immediately (invariant #3)", () => {
    const ep = makeEndpoint();
    const info = ep.spawnPty("term-1", { cwd: "/r" });
    expect(info.id).toBe("term-1");
    // Registered synchronously, before the async remote spawn resolves.
    expect(registry.entries.has("term-1")).toBe(true);
    const entry = registry.entries.get("term-1") as {
      meta: { location?: { hostId: string } };
    };
    expect(entry.meta.location).toEqual({ hostId: "prod" });
    // The seed metadata is published to the collection SYNCHRONOUSLY (not only
    // once the mirror delivers it post-connect), so the client renders the tile
    // — and its connecting-screen overlay — during the dial, not seconds later.
    expect(surfaceCtx.collections.terminalMetadata.upsert).toHaveBeenCalledWith(
      "term-1",
      expect.objectContaining({ location: { hostId: "prod" } }),
    );
  });

  // The mirror copies the watcher's server-owned half onto the registry entry
  // as a UNIT driven off this key set. If the set drifts from the schema (a new
  // server/live field added but not mirrored, or a field-by-field rewrite that
  // dropped one), a remote tile would silently lose that field — the #1275
  // lossy-adoption class. This pins the set to `TerminalServerMetadata` keys
  // minus `location` (kolu-server stamps location itself from the hostId).
  it("copies exactly the TerminalServerMetadata keys minus location", () => {
    const schemaKeys = TerminalServerMetadataSchema.keyof().options.filter(
      (k) => k !== "location",
    );
    expect([...SERVER_META_KEYS].sort()).toEqual([...schemaKeys].sort());
    expect(SERVER_META_KEYS).not.toContain("location");
  });

  // F3 (codex round 1): the user can close a remote tile while the cold
  // provision + spawn RPC is still in flight. By the time spawn resolves, the
  // local shadow is already unregistered — the live remote PTY would leak with no
  // local owner. The async tail must detect the missing registry entry and KILL
  // the just-spawned remote PTY rather than mark it ready.
  it("kills the remote PTY when the terminal is killed mid-spawn", async () => {
    const ep = makeEndpoint();
    // Make the spawn RPC pend so we can unregister the shadow before it resolves.
    let resolveSpawn!: (v: { id: string; pid: number; cwd: string }) => void;
    fake.surface.terminal.spawn.mockImplementationOnce(
      () => new Promise((r) => (resolveSpawn = r)),
    );
    ep.spawnPty("term-kill", { cwd: "/r" });
    // Let the async tail reach the (pending) spawn RPC — it sits behind
    // `session.acquire()` + `system.info()`, so flush until `spawn` is invoked.
    await vi.waitFor(() => expect(resolveSpawn).toBeTypeOf("function"));
    // Simulate the kill landing while spawn is in flight.
    registry.entries.delete("term-kill");
    resolveSpawn({ id: "term-kill", pid: 99, cwd: "/r" });
    await vi.waitFor(() =>
      expect(fake.surface.terminal.kill).toHaveBeenCalledWith({
        id: "term-kill",
      }),
    );
    // Never re-registered, and no orphan left behind.
    expect(registry.entries.has("term-kill")).toBe(false);
  });

  // F2 (codex round 1): a tile attaching off the sync shadow must not race the
  // in-flight spawn. `attach` awaits the proxy's `ready` (resolved by the spawn
  // tail) BEFORE opening the watcher attach stream, so it can't hit a
  // not-yet-spawned PTY. We assert `terminalAttach.get` is deferred until spawn
  // resolves.
  it("attach waits for the spawn to resolve before opening the stream", async () => {
    const ep = makeEndpoint();
    let resolveSpawn!: (v: { id: string; pid: number; cwd: string }) => void;
    fake.surface.terminal.spawn.mockImplementationOnce(
      () => new Promise((r) => (resolveSpawn = r)),
    );
    ep.spawnPty("term-attach", { cwd: "/r" });
    await vi.waitFor(() => expect(resolveSpawn).toBeTypeOf("function"));
    const attachPromise = ep.attach(
      "term-attach",
      new AbortController().signal,
    );
    // Let microtasks flush — the attach stream MUST still be unopened because the
    // proxy's `ready` hasn't resolved (spawn is pending).
    await Promise.resolve();
    await Promise.resolve();
    expect(fake.surface.terminalAttach.get).not.toHaveBeenCalled();
    resolveSpawn({ id: "term-attach", pid: 99, cwd: "/r" });
    const att = await attachPromise;
    expect(fake.surface.terminalAttach.get).toHaveBeenCalledWith(
      { id: "term-attach" },
      expect.anything(),
    );
    expect(att.snapshot).toBe("screen");
  });

  it("maps the ssh session state onto the wire daemonStatus enum", () => {
    makeEndpoint();
    fake.pushState("copying");
    expect(publishDaemonStatus).toHaveBeenLastCalledWith("prod", {
      state: "connecting",
      progress: [],
    });
    fake.pushState("connected");
    expect(publishDaemonStatus).toHaveBeenLastCalledWith("prod", {
      state: "connected",
      progress: [],
    });
    fake.pushState("disconnected");
    expect(publishDaemonStatus).toHaveBeenLastCalledWith("prod", {
      state: "degraded",
      progress: [],
    });
    fake.pushState("failed");
    expect(publishDaemonStatus).toHaveBeenLastCalledWith("prod", {
      state: "dead",
      progress: [],
    });
  });

  it("carries the session's dial-progress lines to the client", () => {
    makeEndpoint();
    // The cold-dial progress ring rides each status so the host chip can show
    // what a minute-long provision is doing instead of a static dot.
    fake.pushState("copying", [
      "[local] prod: copying derivation…",
      "[remote] building 'kaval.drv'",
    ]);
    expect(publishDaemonStatus).toHaveBeenLastCalledWith("prod", {
      state: "connecting",
      progress: [
        "[local] prod: copying derivation…",
        "[remote] building 'kaval.drv'",
      ],
    });
  });

  // P3 (worktree): worktree create/remove route through the OWNING host's
  // endpoint and forward to the watcher's `git.worktreeCreate`/`worktreeRemove`
  // procedures so a remote tile's worktree lands on the remote host.
  it("forwards worktree create/remove to the watcher client", async () => {
    const ep = makeEndpoint();
    const created = await ep.git.worktreeCreate("/r", "wt");
    expect(created).toEqual({ path: "/r/.worktrees/wt", branch: "wt" });
    expect(fake.surface.git.worktreeCreate).toHaveBeenCalledWith({
      repoPath: "/r",
      name: "wt",
    });
    await ep.git.worktreeRemove("/r/.worktrees/wt");
    expect(fake.surface.git.worktreeRemove).toHaveBeenCalledWith({
      worktreePath: "/r/.worktrees/wt",
    });
  });

  // P3 (upload): a pasted/uploaded file is written to the REMOTE host's scratch
  // via the watcher's `fs.writeFile`, returning the on-disk path kolu-server
  // bracket-pastes into the terminal.
  it("forwards file uploads to the watcher's fs.writeFile", async () => {
    const ep = makeEndpoint();
    const out = await ep.fs.writeFile("term-1", "image.png", "ZGF0YQ==");
    expect(out).toEqual({ path: "/scratch/term/image.png" });
    expect(fake.surface.fs.writeFile).toHaveBeenCalledWith({
      terminalId: "term-1",
      name: "image.png",
      base64Data: "ZGF0YQ==",
    });
  });

  // P3 (kaval identity): the endpoint queries `system.version` once on connect
  // and folds the remote kaval's identity + startedAt onto every published
  // daemonStatus, so the rail's per-host currency nudge + uptime read the same
  // collection the local host does.
  it("folds the remote kaval identity + startedAt onto daemonStatus", async () => {
    makeEndpoint();
    // Let the constructor's `queryKavalVersion()` (acquire → system.version)
    // resolve and cache before driving a status publish.
    await vi.waitFor(() =>
      expect(fake.surface.system.version).toHaveBeenCalled(),
    );
    fake.pushState("connected");
    expect(publishDaemonStatus).toHaveBeenLastCalledWith("prod", {
      state: "connected",
      progress: [],
      identity: { staleKey: "rk-stale", navigableCommit: "rk-commit" },
      startedAt: 1700,
    });
  });
});
