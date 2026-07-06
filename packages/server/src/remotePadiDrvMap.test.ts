/**
 * `parsePadiDrvMap` — the baked `{ system → padi .drv }` map's validation, tested
 * through its ONLY caller: `ensureRemotePadiBinding`'s `resolveDrvPath` dial thunk (the
 * parser is module-private).
 *
 * The map is baked onto kolu-server's Nix wrapper as `PADI_AGENT_DRVS_JSON`; a
 * missing/malformed value means the server was NOT run from that wrapper. This is a
 * LAZY, per-entry fault — NOT a boot crash. The warm pool dials `ensureRemotePadiBinding`
 * at boot for EVERY persisted `recentHosts` entry, so an eager throw for one remembered
 * remote host would brick the WHOLE server (local included). Instead the parse is
 * deferred into the dial thunk and throws a `ResolveDrvError` with cause `"remote"` —
 * that host's own connection failure (loud in the picker / connection cell) while the
 * server boots and serves local. So the contract these arms pin is: **construction never
 * throws (boot survives); the deferred thunk carries the fault.**
 *
 * The ssh machinery (`sshConnector` + `makeSession`, the arch probe `resolveSystem`) is
 * mocked so the valid-map arm never touches real ssh/nix — and so the parsed map can be
 * observed: the resolver thunk `sshConnector` receives closes over the parse, so
 * resolving the host's probed arch returns exactly the drv the map held for it.
 */

import { ResolveDrvError } from "@kolu/surface-nix-host";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  sshConnector: vi.fn(),
  makeSession: vi.fn(),
  resolveSystem: vi.fn(),
}));

// Partial mock — override ONLY the ssh seam (the connector + the session appliance +
// the arch probe), keep every other real export (`ResolveDrvError` etc.) so nothing in
// the binder's import graph breaks on load.
vi.mock("@kolu/surface-nix-host", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@kolu/surface-nix-host")>();
  return {
    ...actual,
    sshConnector: h.sshConnector,
    makeSession: h.makeSession,
    resolveSystem: h.resolveSystem,
  };
});

import { ensureRemotePadiBinding } from "./remotePadiBinding.ts";

const ENV = "PADI_AGENT_DRVS_JSON";

/** A minimal `Session` stand-in — the arm calls `onState` (snapshot-then-delta) at
 *  construction and spreads the rest through `asPadiSession`. Seed `onState` with a
 *  benign "connecting" frame; stub the remaining role methods as no-ops. */
function fakeSession() {
  return {
    onState: (cb: (s: unknown) => void) => {
      cb({
        connection: "connecting",
        progressLines: [],
        remoteProgressLines: [],
        lastError: null,
        failureCause: null,
      });
      return () => {};
    },
    currentClient: () => null,
    pin: () => Promise.resolve({}),
    markConnected: () => {},
    reconnect: () => {},
    recheck: () => {},
    identity: () => ({ kind: "disconnected" }) as const,
    isDestroyed: () => false,
    destroy: () => {},
  };
}

/** Construct the binding — which must NOT throw (boot survives) — and hand back the
 *  captured `resolveDrvPath` thunk so a test can drive the DEFERRED parse. */
function bindAndCaptureResolver(host = "nix@prod") {
  let resolveDrvPath: (() => Promise<string>) | undefined;
  h.sshConnector.mockImplementation(
    (opts: { resolveDrvPath: () => Promise<string> }) => {
      resolveDrvPath = opts.resolveDrvPath;
      // The connector is never invoked (makeSession is mocked); return a dummy.
      return async () => {
        throw new Error("mock connector should not run");
      };
    },
  );
  const binding = ensureRemotePadiBinding({ host });
  if (!resolveDrvPath) throw new Error("resolveDrvPath was not captured");
  return { binding, resolveDrvPath };
}

describe("parsePadiDrvMap — lazy per-entry fault (via ensureRemotePadiBinding's dial thunk)", () => {
  // Save/restore the baked env around EACH test so no case leaks into the next
  // (or into other files) — the parser reads process.env at call time.
  let prior: string | undefined;
  beforeEach(() => {
    prior = process.env[ENV];
    h.sshConnector.mockReset();
    h.makeSession.mockReset();
    h.resolveSystem.mockReset();
    h.makeSession.mockReturnValue(fakeSession());
  });
  afterEach(() => {
    if (prior === undefined) delete process.env[ENV];
    else process.env[ENV] = prior;
  });

  it("(a) UNSET → boot SURVIVES (no throw at construction); the dial thunk rejects with a remote ResolveDrvError", async () => {
    delete process.env[ENV];
    const { binding, resolveDrvPath } = bindAndCaptureResolver();
    expect(binding).toBeDefined(); // boot survived — construction did NOT throw
    expect(h.sshConnector).toHaveBeenCalledTimes(1);
    // The fault is THIS host's deferred connection failure, classified "remote".
    await expect(resolveDrvPath()).rejects.toThrow(
      /PADI_AGENT_DRVS_JSON is not baked/,
    );
    await expect(resolveDrvPath()).rejects.toMatchObject({
      name: "ResolveDrvError",
      failureCause: "remote",
    });
    binding.destroy();
  });

  it("(a') the unbaked sentinel '{}' → same not-baked deferred fault (boot survives)", async () => {
    process.env[ENV] = "{}";
    const { binding, resolveDrvPath } = bindAndCaptureResolver();
    expect(binding).toBeDefined();
    await expect(resolveDrvPath()).rejects.toThrow(/is not baked/);
    binding.destroy();
  });

  it("(b) malformed JSON → deferred throw (boot survives, connector still built)", async () => {
    process.env[ENV] = "{not json";
    const { binding, resolveDrvPath } = bindAndCaptureResolver();
    expect(binding).toBeDefined();
    expect(h.sshConnector).toHaveBeenCalledTimes(1);
    await expect(resolveDrvPath()).rejects.toThrow(
      /is not a valid \{ system → drv \} JSON map/,
    );
    binding.destroy();
  });

  it("(c) valid JSON, wrong shape — a JSON ARRAY → deferred throw (the parser validates shape, not just JSON.parse)", async () => {
    process.env[ENV] = JSON.stringify(["/nix/store/x-padi.drv"]);
    const { binding, resolveDrvPath } = bindAndCaptureResolver();
    expect(binding).toBeDefined();
    await expect(resolveDrvPath()).rejects.toThrow(
      /is not a \{ system → drv string \} JSON object/,
    );
    binding.destroy();
  });

  it("(c') valid JSON object with a NON-STRING value → deferred throw (a bogus drv can't slip the shape guard)", async () => {
    // `{ "x86_64-linux": 42 }` is an `object` that passes a naive typeof check but
    // would hand back `42` as a `.drv`; the per-value guard rejects it.
    process.env[ENV] = JSON.stringify({ "x86_64-linux": 42 });
    const { binding, resolveDrvPath } = bindAndCaptureResolver();
    expect(binding).toBeDefined();
    await expect(resolveDrvPath()).rejects.toThrow(
      /is not a \{ system → drv string \} JSON object/,
    );
    binding.destroy();
  });

  it("(d) a valid { system → drv } map → the thunk threads the drv for the host's probed arch", async () => {
    process.env[ENV] = JSON.stringify({
      "x86_64-linux": "/nix/store/aaa-padi.drv",
      "aarch64-linux": "/nix/store/bbb-padi.drv",
    });
    const { binding, resolveDrvPath } = bindAndCaptureResolver();
    expect(binding).toBeDefined();
    expect(h.sshConnector).toHaveBeenCalledTimes(1);
    h.resolveSystem.mockResolvedValue("aarch64-linux");

    // Probing the host's arch and looking it up returns exactly the drv the map held for
    // that system — proving parsePadiDrvMap produced the expected { system → drv } OBJECT,
    // not merely valid JSON.
    const drv = await resolveDrvPath();
    expect(drv).toBe("/nix/store/bbb-padi.drv");
    binding.destroy();
  });

  it("keeps ResolveDrvError importable (the mock spreads the real export)", () => {
    expect(ResolveDrvError).toBeTypeOf("function");
  });
});
