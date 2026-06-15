/**
 * Unit tests for the `--host` connect path — no ssh, no nix. `resolveSystem`
 * and `getHostSession` (the ssh/provision machinery) are mocked; the fake
 * session's `pin()` yields a REAL in-process kaval client, so the test proves
 * the wiring (`pin` → `heartbeat` → `markConnected` → `dispose`) and that the
 * returned `Connection` is the SAME shape every `cmd*()` consumes — over a real
 * `ptyHostSurface` round-trip, just without the transport. The genuine ssh
 * wire is exercised separately against a real `pu` box for PR evidence.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

import { createInProcessPtyHost, type InProcessPtyHostDeps } from "kaval";
import { getHostSession } from "@kolu/surface-nix-host";
import { connectPtyHostViaHost, resolveKavalAgentDrv } from "./hostConnect.ts";

const silentLog = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLog,
} as unknown as InProcessPtyHostDeps["log"];

const ORIGINAL_DRVS = process.env.KAVAL_AGENT_DRVS_JSON;
afterEach(() => {
  if (ORIGINAL_DRVS === undefined) delete process.env.KAVAL_AGENT_DRVS_JSON;
  else process.env.KAVAL_AGENT_DRVS_JSON = ORIGINAL_DRVS;
  vi.clearAllMocks();
});

describe("resolveKavalAgentDrv", () => {
  // The map is already parsed+validated by the caller; this resolver only does
  // the genuinely-per-host arch probe + lookup against it.
  beforeEach(() => h.resolveSystem.mockResolvedValue("x86_64-linux"));

  it("ships the host-arch derivation: probe system, then map-lookup", async () => {
    await expect(
      resolveKavalAgentDrv("nix@prod", {
        "x86_64-linux": "/nix/store/aaa-kaval.drv",
        "aarch64-darwin": "/nix/store/bbb-kaval.drv",
      }),
    ).resolves.toBe("/nix/store/aaa-kaval.drv");
  });

  it("fails clearly when no derivation is baked for the host's system", async () => {
    await expect(
      resolveKavalAgentDrv("nix@prod", {
        "aarch64-darwin": "/nix/store/bbb-kaval.drv",
      }),
    ).rejects.toThrow(/no kaval derivation baked for system=x86_64-linux/);
  });
});

describe("connectPtyHostViaHost: eager drv-map validation", () => {
  // The static-config check runs eagerly at the --host entry — BEFORE the
  // session is constructed — so a missing/malformed map fails synchronously
  // (caught by connectHost's fail-fast) and never enters the session's
  // retryable "network" classification.
  it("fails when the drv map is missing entirely (run outside the Nix wrapper)", async () => {
    delete process.env.KAVAL_AGENT_DRVS_JSON;
    await expect(connectPtyHostViaHost("nix@prod")).rejects.toThrow(
      /KAVAL_AGENT_DRVS_JSON is not set/,
    );
    // It threw before ever constructing a session — no reconnect path entered.
    expect(getHostSession).not.toHaveBeenCalled();
  });

  it("rejects a malformed (non-string-valued) map", async () => {
    process.env.KAVAL_AGENT_DRVS_JSON = JSON.stringify({ "x86_64-linux": 7 });
    await expect(connectPtyHostViaHost("nix@prod")).rejects.toThrow(
      /must be a JSON object of \{ system: drvPath \} strings/,
    );
    expect(getHostSession).not.toHaveBeenCalled();
  });
});

describe("connectPtyHostViaHost", () => {
  let dispose: () => void;

  beforeEach(() => {
    // `connectPtyHostViaHost` parses the drv map eagerly at entry, so the
    // happy-path dial needs a valid one even though the fake session never
    // invokes the deferred resolver.
    process.env.KAVAL_AGENT_DRVS_JSON = JSON.stringify({
      "x86_64-linux": "/nix/store/aaa-kaval.drv",
    });
    const inproc = createInProcessPtyHost({
      log: silentLog,
      rcDir: mkdtempSync(join(tmpdir(), "kaval-host-rc-")),
    });
    // The fake ssh session hands back a real in-process kaval client.
    h.pin.current = async () => inproc.client;
  });

  afterEach(() => dispose?.());

  it("dials, proves the link, marks the session connected, and yields a usable client", async () => {
    const conn = await connectPtyHostViaHost("nix@prod");
    dispose = conn.dispose;

    // getHostSession was asked for THIS host with binary=kaval and a deferred
    // resolver (not awaited at construction).
    expect(getHostSession).toHaveBeenCalledWith(
      expect.objectContaining({ host: "nix@prod", binary: "kaval" }),
    );
    const opts = vi.mocked(getHostSession).mock.calls[0]?.[0];
    expect(typeof opts?.resolveDrvPath).toBe("function");

    // The connect path roundtripped one RPC and flipped the watchdog off — so a
    // long `attach` can't be reaped at 30s.
    expect(h.markConnected).toHaveBeenCalledTimes(1);

    // The returned Connection is the SAME shape cmd*() use: a real ptyHostSurface
    // round-trip works over it (here `list`, against the in-process host).
    const { entries } = await conn.client.surface.terminal.list({});
    expect(Array.isArray(entries)).toBe(true);
  });

  it("dispose tears down the ssh session", async () => {
    const conn = await connectPtyHostViaHost("nix@prod");
    dispose = conn.dispose;
    conn.dispose();
    expect(h.destroy).toHaveBeenCalledTimes(1);
  });
});
