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
    },
    fs: {
      listAll: vi.fn(async () => ({ paths: ["README.md"] })),
      readFile: vi.fn(async () => ({ content: "x", truncated: false })),
      statFileMtimeMs: vi.fn(async () => ({ mtimeMs: 7 })),
    },
    terminal: {
      spawn: vi.fn(async () => ({ id: "t", pid: 99, cwd: "/r" })),
      kill: vi.fn(async () => ({ ok: true })),
      killAll: vi.fn(async () => ({ killed: 0 })),
    },
    system: {
      info: vi.fn(async () => ({
        shell: "/bin/sh",
        home: "/h",
        platform: "linux",
        rcDir: "/h/.rc",
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
    pushState: (connection: string) => onState?.({ connection }),
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
  composeSpawnInput: () => ({
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

import { RemoteTerminalEndpoint } from "./remote.ts";

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
  });

  it("maps the ssh session state onto the wire daemonStatus enum", () => {
    makeEndpoint();
    fake.pushState("copying");
    expect(publishDaemonStatus).toHaveBeenLastCalledWith("prod", {
      state: "connecting",
    });
    fake.pushState("connected");
    expect(publishDaemonStatus).toHaveBeenLastCalledWith("prod", {
      state: "connected",
    });
    fake.pushState("disconnected");
    expect(publishDaemonStatus).toHaveBeenLastCalledWith("prod", {
      state: "degraded",
    });
    fake.pushState("failed");
    expect(publishDaemonStatus).toHaveBeenLastCalledWith("prod", {
      state: "dead",
    });
  });
});
