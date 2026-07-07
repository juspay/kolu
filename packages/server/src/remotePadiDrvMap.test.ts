/**
 * `parsePadiDrvMap` — the baked `{ system → padi .drv }` map's fail-fast, tested
 * through its ONLY caller, `ensureRemotePadiBinding` (the parser is module-private).
 *
 * The map is baked onto kolu-server's Nix wrapper as `PADI_AGENT_DRVS_JSON`; a
 * missing/malformed value means the server was NOT run from that wrapper, so a remote
 * padi binding is impossible and the parser CRASHES LOUDLY (fail-fast, no fallback) —
 * `index.ts` calls `ensureRemotePadiBinding` synchronously with no try/catch, so the
 * throw crashes boot instead of degrading the canvas through the deferred resolver's
 * retry-then-terminal path. These arms mirror the `parseDrvBySystem` precedent
 * (`@kolu/surface-remote/dialAgentOnce.test.ts`), which validates the same-shape
 * `KAVAL_AGENT_DRVS_JSON` map through ITS public seam.
 *
 * The ssh machinery (`sshConnector` + `makeSession`, the arch probe `resolveSystem`) is
 * mocked so the valid-map arm never touches real ssh/nix — and so the parsed map can be
 * observed: the resolver thunk `sshConnector` receives closes over the parsed object, so
 * resolving the host's probed arch returns exactly the drv the map held for it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  sshConnector: vi.fn(),
  makeSession: vi.fn(),
  resolveSystem: vi.fn(),
}));

// Partial mock — override ONLY the ssh seam (the connector + the session appliance +
// the arch probe), keep every other real export (`ResolveDrvError` etc.) so nothing in
// the binder's import graph breaks on load.
vi.mock("@kolu/surface-remote", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@kolu/surface-remote")>();
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

describe("parsePadiDrvMap fail-fast (via ensureRemotePadiBinding)", () => {
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

  it("(a) UNSET → throws loudly, and never builds a connector", () => {
    delete process.env[ENV];
    expect(() => ensureRemotePadiBinding({ host: "nix@prod" })).toThrow(
      /PADI_AGENT_DRVS_JSON is not baked/,
    );
    expect(h.sshConnector).not.toHaveBeenCalled();
  });

  it("(a') the unbaked sentinel '{}' → throws (same not-baked arm)", () => {
    process.env[ENV] = "{}";
    expect(() => ensureRemotePadiBinding({ host: "nix@prod" })).toThrow(
      /is not baked/,
    );
    expect(h.sshConnector).not.toHaveBeenCalled();
  });

  it("(b) malformed JSON → throws, and never builds a connector", () => {
    process.env[ENV] = "{not json";
    expect(() => ensureRemotePadiBinding({ host: "nix@prod" })).toThrow(
      /is not a valid \{ system → drv \} JSON map/,
    );
    expect(h.sshConnector).not.toHaveBeenCalled();
  });

  it("(c) valid JSON, wrong shape — a JSON ARRAY → throws (the parser validates shape, not just JSON.parse)", () => {
    process.env[ENV] = JSON.stringify(["/nix/store/x-padi.drv"]);
    expect(() => ensureRemotePadiBinding({ host: "nix@prod" })).toThrow(
      /is not a \{ system → drv string \} JSON object/,
    );
    expect(h.sshConnector).not.toHaveBeenCalled();
  });

  it("(c') valid JSON object with a NON-STRING value → throws (a bogus drv can't slip the shape guard)", () => {
    // `{ "x86_64-linux": 42 }` is an `object` that passes a naive typeof check but
    // would hand back `42` as a `.drv`; the per-value guard rejects it eagerly.
    process.env[ENV] = JSON.stringify({ "x86_64-linux": 42 });
    expect(() => ensureRemotePadiBinding({ host: "nix@prod" })).toThrow(
      /is not a \{ system → drv string \} JSON object/,
    );
    expect(h.sshConnector).not.toHaveBeenCalled();
  });

  it("(d) a valid { system → drv } map → parses, and threads the drv for the host's arch into the resolver", async () => {
    process.env[ENV] = JSON.stringify({
      "x86_64-linux": "/nix/store/aaa-padi.drv",
      "aarch64-linux": "/nix/store/bbb-padi.drv",
    });
    let capturedOpts: { resolveDrvPath: () => Promise<string> } | undefined;
    h.sshConnector.mockImplementation(
      (opts: { resolveDrvPath: () => Promise<string> }) => {
        capturedOpts = opts;
        // The connector is never invoked (makeSession is mocked); return a dummy.
        return async () => {
          throw new Error("mock connector should not run");
        };
      },
    );
    h.resolveSystem.mockResolvedValue("aarch64-linux");

    const binding = ensureRemotePadiBinding({ host: "nix@prod" });
    expect(binding).toBeDefined();
    expect(h.sshConnector).toHaveBeenCalledTimes(1);

    // The parsed map is closed over by the connector's `resolveDrvPath` thunk: probing
    // the host's arch and looking it up returns exactly the drv the map held for that
    // system — proving parsePadiDrvMap produced the expected { system → drv } OBJECT,
    // not merely valid JSON.
    expect(capturedOpts).toBeDefined();
    const drv = await capturedOpts?.resolveDrvPath();
    expect(drv).toBe("/nix/store/bbb-padi.drv");
    binding.destroy();
  });
});
