/**
 * Unit tests for the `--host` connect path — no ssh, no nix. `resolveSystem`
 * and `getHostSession` (the ssh/provision machinery) are mocked; the fake
 * session's `pin()` yields a REAL in-process arivu client (a `directLink` over
 * the served `arivuSurface`), so the test proves the wiring (`pin` →
 * version-cell probe → `markConnected` → `dispose`) and that the returned
 * `Connection` is the SAME shape every `cmd*()` consumes — over a real
 * `arivuSurface` round-trip, just without the transport. The genuine ssh wire is
 * exercised separately against a real `pu` box for PR evidence.
 */
import {
  type AwarenessValue,
  arivuSurface,
  DEFAULT_VERSION,
  type TerminalId,
} from "@kolu/arivu-contract";
import { directLink } from "@kolu/surface/links/direct";
import {
  implementSurface,
  inMemoryChannelByName,
  inMemoryStore,
} from "@kolu/surface/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  markConnected: vi.fn(),
  destroy: vi.fn(),
  resolveSystem: vi.fn(),
  // Indirection so each test can swap what pin() resolves to.
  pin: { current: async (): Promise<unknown> => ({}) },
}));

vi.mock("@kolu/surface-nix-host", () => ({
  resolveSystem: h.resolveSystem,
  getHostSession: vi.fn(() => ({
    pin: () => h.pin.current(),
    markConnected: h.markConnected,
    destroy: h.destroy,
    onState: () => () => {},
  })),
}));

import { getHostSession } from "@kolu/surface-nix-host";
import { connectArivuViaHost, resolveArivuAgentDrv } from "./hostConnect.ts";
import { snapshotAwareness } from "./read.ts";

/** A real in-process arivu surface client over a `directLink` — the awareness
 *  collection backed by a plain Map, the `version` cell at this build's default.
 *  Mirrors the daemon's served fragment (daemon.ts) without dialing kaval, so
 *  the test exercises a real `arivuSurface` round-trip in place of the ssh wire. */
function makeInProcessArivuClient(
  cache = new Map<TerminalId, AwarenessValue>(),
) {
  // `directLink` consumes the raw `implementSurface` fragment router directly
  // (no `implement(contract).router(...)` wire-serve wrap — see
  // `surface/links/direct.test.ts`), so the in-process client speaks the exact
  // same `arivuSurface` the daemon serves.
  const { router } = implementSurface(arivuSurface, {
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
  });
  return directLink<typeof arivuSurface.contract>(router);
}

const ORIGINAL_DRVS = process.env.ARIVU_AGENT_DRVS_JSON;
afterEach(() => {
  if (ORIGINAL_DRVS === undefined) delete process.env.ARIVU_AGENT_DRVS_JSON;
  else process.env.ARIVU_AGENT_DRVS_JSON = ORIGINAL_DRVS;
  vi.clearAllMocks();
});

describe("resolveArivuAgentDrv", () => {
  // The map is already parsed+validated by the caller; this resolver only does
  // the genuinely-per-host arch probe + lookup against it.
  beforeEach(() => h.resolveSystem.mockResolvedValue("x86_64-linux"));

  it("ships the host-arch derivation: probe system, then map-lookup", async () => {
    await expect(
      resolveArivuAgentDrv("nix@prod", {
        "x86_64-linux": "/nix/store/aaa-arivu.drv",
        "aarch64-darwin": "/nix/store/bbb-arivu.drv",
      }),
    ).resolves.toBe("/nix/store/aaa-arivu.drv");
  });

  it("fails clearly when no derivation is baked for the host's system", async () => {
    await expect(
      resolveArivuAgentDrv("nix@prod", {
        "aarch64-darwin": "/nix/store/bbb-arivu.drv",
      }),
    ).rejects.toThrow(/no arivu derivation baked for system=x86_64-linux/);
  });
});

describe("connectArivuViaHost: eager drv-map validation", () => {
  // The static-config check runs eagerly at the --host entry — BEFORE the
  // session is constructed — so a missing/malformed map fails synchronously
  // (caught by connectHost's fail-fast) and never enters the session's
  // retryable "network" classification.
  it("fails when the drv map is missing entirely (run outside the Nix wrapper)", async () => {
    delete process.env.ARIVU_AGENT_DRVS_JSON;
    await expect(connectArivuViaHost("nix@prod")).rejects.toThrow(
      /ARIVU_AGENT_DRVS_JSON is not set/,
    );
    // It threw before ever constructing a session — no reconnect path entered.
    expect(getHostSession).not.toHaveBeenCalled();
  });

  it("rejects a malformed (non-string-valued) map", async () => {
    process.env.ARIVU_AGENT_DRVS_JSON = JSON.stringify({ "x86_64-linux": 7 });
    await expect(connectArivuViaHost("nix@prod")).rejects.toThrow(
      /must be a JSON object of \{ system: drvPath \} strings/,
    );
    expect(getHostSession).not.toHaveBeenCalled();
  });

  it("rejects a JSON array (an object whose string values would slip the shape check)", async () => {
    // An array passes `typeof === "object"` and all-string `Object.values`, so
    // without an explicit array guard it would slip past eager validation and
    // only fail later as a host-system map miss after the ssh probe.
    process.env.ARIVU_AGENT_DRVS_JSON = JSON.stringify(["/nix/store/x.drv"]);
    await expect(connectArivuViaHost("nix@prod")).rejects.toThrow(
      /must be a JSON object of \{ system: drvPath \} strings/,
    );
    expect(getHostSession).not.toHaveBeenCalled();
  });
});

describe("connectArivuViaHost", () => {
  let dispose: () => void;

  beforeEach(() => {
    // `connectArivuViaHost` parses the drv map eagerly at entry, so the
    // happy-path dial needs a valid one even though the fake session never
    // invokes the deferred resolver.
    process.env.ARIVU_AGENT_DRVS_JSON = JSON.stringify({
      "x86_64-linux": "/nix/store/aaa-arivu.drv",
    });
    // The fake ssh session hands back a real in-process arivu client.
    const client = makeInProcessArivuClient();
    h.pin.current = async () => client;
  });

  afterEach(() => dispose?.());

  it("dials, probes the version cell, marks the session connected, and yields a usable client", async () => {
    const conn = await connectArivuViaHost("nix@prod");
    dispose = conn.dispose;

    // getHostSession was asked for THIS host with binary=arivu and a deferred
    // resolver (not awaited at construction).
    expect(getHostSession).toHaveBeenCalledWith(
      expect.objectContaining({ host: "nix@prod", binary: "arivu" }),
    );
    const opts = vi.mocked(getHostSession).mock.calls[0]?.[0];
    expect(typeof opts?.resolveDrvPath).toBe("function");

    // The connect path roundtripped the version cell and flipped the watchdog
    // off — so a long `watch` can't be reaped mid-stream.
    expect(h.markConnected).toHaveBeenCalledTimes(1);

    // The returned Connection is the SAME shape cmd*() use: the real awareness
    // read path works over it (here `snapshotAwareness`, against the empty
    // in-process collection).
    const rows = await snapshotAwareness(conn.client);
    expect(Array.isArray(rows)).toBe(true);
  });

  it("dispose tears down the ssh session", async () => {
    const conn = await connectArivuViaHost("nix@prod");
    dispose = conn.dispose;
    conn.dispose();
    expect(h.destroy).toHaveBeenCalledTimes(1);
  });
});
