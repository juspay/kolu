/**
 * Unit tests for the pulam-tui `--host` wrapper. The one-shot dial composition
 * (drv-map parse, arch-probe + lookup, pin → probe → markConnected → destroy)
 * lives in `@kolu/surface-nix-host`'s `dialAgentOnce` and is tested there; here
 * we mock `dialAgentOnce` and prove the thin seam this wrapper owns: it passes
 * pulam's three volatile values (binary, env var, drvNoun) and OVERRIDES the
 * dial's default `system.live` probe with a protocol assertion — reading the
 * `version` cell's first frame (a contract check, not merely liveness). The
 * override is exercised against a REAL in-process pulam client (a `directLink`
 * over the served `terminalWorkspaceSurface`), and the returned `Connection`
 * flows back unchanged.
 */
import {
  type AwarenessValue,
  terminalWorkspaceSurface,
  DEFAULT_VERSION,
  type TerminalId,
} from "@kolu/terminal-workspace/surface";
import { directLink } from "@kolu/surface/links/direct";
import {
  implementSurface,
  inMemoryChannelByName,
  inMemoryStore,
} from "@kolu/surface/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ dialAgentOnce: vi.fn() }));

vi.mock("@kolu/surface-nix-host", () => ({ dialAgentOnce: h.dialAgentOnce }));

import { dialAgentOnce } from "@kolu/surface-nix-host";
import { connectArivuViaHost } from "./hostConnect.ts";
import { snapshotAwareness } from "./read.ts";

/** A stub for the fs/git primitives this probe never exercises: it asserts loud
 *  if a host-connect test ever reaches a workspace read, rather than faking one. */
function unusedInProbe(name: string): never {
  throw new Error(`${name} not exercised by the host-connect probe`);
}

/** A real in-process pulam surface client over a `directLink` — the awareness
 *  collection backed by a plain Map, the `version` cell at this build's default.
 *  Mirrors the daemon's served fragment (daemon.ts) without dialing kaval, so
 *  the probe exercises a real `terminalWorkspaceSurface` round-trip in place of the ssh wire. */
function makeInProcessArivuClient(
  cache = new Map<TerminalId, AwarenessValue>(),
) {
  const { router } = implementSurface(terminalWorkspaceSurface, {
    channel: inMemoryChannelByName(),
    cells: { version: { store: inMemoryStore(DEFAULT_VERSION) } },
    collections: {
      awareness: {
        readAll: () => cache,
        upsert: (key, value) => {
          cache.set(key, value);
        },
        remove: (key) => {
          cache.delete(key);
        },
      },
    },
    // The probe only reads the `version` cell, but `implementSurface` wires a dep
    // per declared stream + procedure, so the full R6 surface is stubbed here:
    // `activity` yields an empty set and the fs/git watchers + reads are never
    // exercised by a host-connect probe.
    streams: {
      activity: {
        source: async function* (): AsyncGenerator<TerminalId[]> {
          yield [];
        },
      },
      subscribeRepoChange: {
        source: async function* (): AsyncGenerator<{ seq: number }> {},
      },
      subscribeFileChange: {
        source: async function* (): AsyncGenerator<{ seq: number }> {},
      },
    },
    procedures: {
      fs: {
        listAll: () => unusedInProbe("fs.listAll"),
        readFile: () => unusedInProbe("fs.readFile"),
        statFileMtimeMs: () => unusedInProbe("fs.statFileMtimeMs"),
      },
      git: {
        getStatus: () => unusedInProbe("git.getStatus"),
        getDiff: () => unusedInProbe("git.getDiff"),
      },
    },
  });
  return directLink<typeof terminalWorkspaceSurface.contract>(router);
}

afterEach(() => vi.clearAllMocks());

describe("connectArivuViaHost", () => {
  it("dials with pulam's binary, env var, and drvNoun", async () => {
    const client = makeInProcessArivuClient();
    h.dialAgentOnce.mockResolvedValue({ client, dispose: () => {} });

    const conn = await connectArivuViaHost("nix@prod");

    const opts = vi.mocked(dialAgentOnce).mock.calls[0]?.[0];
    expect(opts).toMatchObject({
      host: "nix@prod",
      binary: "pulam",
      envVar: "PULAM_AGENT_DRVS_JSON",
      drvNoun: "pulam",
    });

    // The returned Connection is the SAME shape cmd*() use.
    const rows = await snapshotAwareness(conn.client);
    expect(Array.isArray(rows)).toBe(true);

    // No --kaval → no extraArgs, so the remote pulam discovers its kaval.
    expect(opts?.extraArgs).toBeUndefined();
  });

  it("forwards --kaval as extraArgs to the remote pulam", async () => {
    h.dialAgentOnce.mockResolvedValue({
      client: makeInProcessArivuClient(),
      dispose: () => {},
    });
    await connectArivuViaHost(
      "nix@prod",
      "/run/user/1000/kaval-7692/pty-host.sock",
    );
    const opts = vi.mocked(dialAgentOnce).mock.calls[0]?.[0];
    expect(opts?.extraArgs).toEqual([
      "--kaval",
      "/run/user/1000/kaval-7692/pty-host.sock",
    ]);
  });

  it("the probe reads the first frame of the version cell (pulam has no heartbeat)", async () => {
    const client = makeInProcessArivuClient();
    h.dialAgentOnce.mockResolvedValue({ client, dispose: () => {} });

    await connectArivuViaHost("nix@prod");
    const opts = vi.mocked(dialAgentOnce).mock.calls[0]?.[0];

    // pulam OVERRIDES the dial's default `system.live` with a protocol assertion,
    // so its `probe` is defined. Running it against the real in-process surface
    // resolves with the version cell's first frame — the proof the override exists.
    expect(opts?.probe).toBeDefined();
    // biome-ignore lint/suspicious/noExplicitAny: the mocked generic collapses the probe's client type; the directLink client speaks the same contract.
    await expect(opts?.probe?.(client as any)).resolves.toEqual(
      DEFAULT_VERSION,
    );
  });

  it("the probe THROWS when the version stream ends empty (link/protocol failure, not connected)", async () => {
    h.dialAgentOnce.mockResolvedValue({
      client: makeInProcessArivuClient(),
      dispose: () => {},
    });
    await connectArivuViaHost("nix@prod");
    const opts = vi.mocked(dialAgentOnce).mock.calls[0]?.[0];

    // A client whose `version.get` resolves to a stream that ends WITHOUT a
    // snapshot frame. The probe must surface that as a failure — an empty stream
    // is a dead/half-open link, never a "connected" session (the F4 regression).
    const emptyStreamClient = {
      surface: {
        version: {
          // eslint-disable-next-line require-yield
          get: async () =>
            (async function* () {
              /* no frames — the remote surface yielded nothing */
            })(),
        },
      },
    };
    expect(opts?.probe).toBeDefined();
    // biome-ignore lint/suspicious/noExplicitAny: a hand-rolled stub standing in for the contract client; only `version.get` is exercised.
    await expect(opts?.probe?.(emptyStreamClient as any)).rejects.toThrow(
      /yielded no snapshot frame/,
    );
  });

  it("threads dispose back through the Connection", async () => {
    const dispose = vi.fn();
    h.dialAgentOnce.mockResolvedValue({
      client: makeInProcessArivuClient(),
      dispose,
    });
    const conn = await connectArivuViaHost("nix@prod");
    conn.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
