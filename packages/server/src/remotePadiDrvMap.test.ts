/**
 * `parsePadiDrvMap` — the baked `{ system → padi .drv }` map, parsed LAZILY inside the
 * resolver thunk (F6). A missing/malformed value means kolu-server was NOT run from its
 * Nix wrapper, so a remote padi binding is impossible — but that is THIS entry's TERMINAL
 * fault, NOT a boot-brick: `ensureRemotePadiBinding` returns a session that warms, and the
 * drv-map throw surfaces on the FIRST dial, re-raised as a TERMINAL `ResolveDrvError` (so
 * the entry settles `failed(reason)` and the chip reads it, while the server + the healthy
 * local default keep serving). These arms prove: (1) the SEED call NEVER throws — boot
 * survives a bad/absent map — and (2) the resolver thunk rejects with the exact reason.
 * This is the seed invariant Group-1a's boot-brick class died for, held at the seed path.
 *
 * The ssh machinery (`sshConnector` + `makeSession`, the arch probe `resolveSystem`) is
 * mocked so no arm touches real ssh/nix; the resolver thunk `sshConnector` receives is
 * captured + invoked to observe the lazy fault (or the resolved drv).
 */

import { ResolveDrvError } from "@kolu/surface-remote";
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
  const actual = await importOriginal<typeof import("@kolu/surface-remote")>();
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

/** Seed a remote binding and hand back the resolver thunk `sshConnector` was given (the
 *  lazy drv-map parse lives INSIDE it). The SEED call must NOT throw — the whole point of
 *  F6 is that a bad/absent map never bricks boot; it faults only THIS entry, on dial. */
function seedAndCaptureResolver(): () => Promise<string> {
  let captured: (() => Promise<string>) | undefined;
  h.sshConnector.mockImplementation(
    (opts: { resolveDrvPath: () => Promise<string> }) => {
      captured = opts.resolveDrvPath;
      // The connector is never invoked (makeSession is mocked); return a dummy.
      return async () => {
        throw new Error("mock connector should not run");
      };
    },
  );
  const binding = ensureRemotePadiBinding({ host: "nix@prod" });
  expect(binding).toBeDefined(); // ← boot survives: the seed call did not throw (F6)
  expect(h.sshConnector).toHaveBeenCalledTimes(1);
  binding.destroy();
  if (captured === undefined)
    throw new Error("resolver thunk was not captured");
  return captured;
}

describe("parsePadiDrvMap — LAZY entry-scope fault (F6, via ensureRemotePadiBinding)", () => {
  // Save/restore the baked env around EACH test so no case leaks (the parser reads
  // process.env at RESOLVE time now, not construction).
  let prior: string | undefined;
  beforeEach(() => {
    prior = process.env[ENV];
    h.sshConnector.mockReset();
    h.makeSession.mockReset();
    h.resolveSystem.mockReset();
    h.makeSession.mockReturnValue(fakeSession());
    // Arch probe resolves fine — so in the error arms it is the drv-map parse (which
    // runs FIRST in the resolver) that rejects, never the probe.
    h.resolveSystem.mockResolvedValue("x86_64-linux");
  });
  afterEach(() => {
    if (prior === undefined) delete process.env[ENV];
    else process.env[ENV] = prior;
  });

  it("(a) UNSET → seed does NOT throw; resolver rejects TERMINAL with the not-baked reason", async () => {
    delete process.env[ENV];
    const resolve = seedAndCaptureResolver();
    await expect(resolve()).rejects.toThrow(
      /PADI_AGENT_DRVS_JSON is not baked/,
    );
    // Terminal, not a retry: a missing map can't self-heal, so the entry settles failed.
    await expect(resolve()).rejects.toBeInstanceOf(ResolveDrvError);
  });

  it("(a') the unbaked sentinel '{}' → resolver rejects (same not-baked arm)", async () => {
    process.env[ENV] = "{}";
    const resolve = seedAndCaptureResolver();
    await expect(resolve()).rejects.toThrow(/is not baked/);
  });

  it("(b) malformed JSON → resolver rejects", async () => {
    process.env[ENV] = "{not json";
    const resolve = seedAndCaptureResolver();
    await expect(resolve()).rejects.toThrow(/is not valid JSON/);
  });

  it("(c) valid JSON, wrong shape — a JSON ARRAY → resolver rejects (shape, not just JSON.parse)", async () => {
    process.env[ENV] = JSON.stringify(["/nix/store/x-padi.drv"]);
    const resolve = seedAndCaptureResolver();
    await expect(resolve()).rejects.toThrow(
      /must be a JSON object of \{ system: drvPath \} strings/,
    );
  });

  it("(c') valid JSON object with a NON-STRING value → resolver rejects", async () => {
    process.env[ENV] = JSON.stringify({ "x86_64-linux": 42 });
    const resolve = seedAndCaptureResolver();
    await expect(resolve()).rejects.toThrow(
      /must be a JSON object of \{ system: drvPath \} strings/,
    );
  });

  it("(d) a valid { system → drv } map → resolver threads the drv for the host's arch", async () => {
    process.env[ENV] = JSON.stringify({
      "x86_64-linux": "/nix/store/aaa-padi.drv",
      "aarch64-linux": "/nix/store/bbb-padi.drv",
    });
    h.resolveSystem.mockResolvedValue("aarch64-linux");
    const resolve = seedAndCaptureResolver();
    // Probing the host's arch and looking it up returns exactly the drv the map held —
    // proving parsePadiDrvMap produced the expected { system → drv } OBJECT.
    expect(await resolve()).toBe("/nix/store/bbb-padi.drv");
  });
});
