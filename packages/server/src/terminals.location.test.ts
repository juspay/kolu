/**
 * PR-0 — the terminal lifecycle honors `HostLocation` at CREATE (the sole
 * location-supplying entry).
 *
 * Two halves of the create seam, exercised pty-host-free (no kaval daemon is booted in
 * the unit env, so a create's spawn RPC rejects on a later microtask — the sync-shadow
 * entry the assertions read is already registered):
 *
 *   - `resolveCreateLocation` — the pure inherit/reject rule the create RPC applies: a
 *     top-level terminal takes the requested location (default local); a sub-terminal
 *     INHERITS its parent's host and REJECTS an explicit child location that disagrees
 *     (BAD_REQUEST).
 *   - `createTerminal` resolves the endpoint BY location (a remote location has no
 *     endpoint yet, so it throws — never silently degrades onto the local PTY), and a
 *     created terminal's location rides through to the saved session, so a saved
 *     `location` round-trips create → snapshot → re-create (the create→restore path).
 */

import { ORPCError } from "@orpc/server";
import { type HostLocation, LOCAL_LOCATION } from "kolu-common/surface";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetSurfaceCtxForTest,
  noopSurfaceCtxForTest,
  setSurfaceCtx,
} from "./surfaceCtx.ts";
import { getTerminal, unregisterTerminal } from "./terminal-registry.ts";
import {
  createTerminal,
  resolveCreateLocation,
  snapshotSession,
} from "./terminals.ts";
import {
  __resetWorkspaceSurfaceCtxForTest,
  noopWorkspaceSurfaceCtxForTest,
  setWorkspaceSurfaceCtx,
} from "./workspaceSurfaceCtx.ts";

const REMOTE: HostLocation = { kind: "remote", hostId: "build-box" };
const OTHER_REMOTE: HostLocation = { kind: "remote", hostId: "other-box" };

describe("resolveCreateLocation — inherit from parent, reject a mismatch", () => {
  it("a top-level terminal defaults to the local host when none is requested", () => {
    expect(resolveCreateLocation(undefined, undefined)).toEqual(LOCAL_LOCATION);
  });

  it("a top-level terminal uses the explicitly requested host", () => {
    expect(resolveCreateLocation(REMOTE, undefined)).toEqual(REMOTE);
  });

  it("a sub-terminal INHERITS its parent's host when none is requested", () => {
    expect(resolveCreateLocation(undefined, REMOTE)).toEqual(REMOTE);
    expect(resolveCreateLocation(undefined, LOCAL_LOCATION)).toEqual(
      LOCAL_LOCATION,
    );
  });

  it("a sub-terminal whose explicit location MATCHES the parent is accepted", () => {
    expect(resolveCreateLocation(LOCAL_LOCATION, LOCAL_LOCATION)).toEqual(
      LOCAL_LOCATION,
    );
    expect(resolveCreateLocation(REMOTE, REMOTE)).toEqual(REMOTE);
  });

  it("a sub-terminal whose explicit location DISAGREES with the parent is BAD_REQUEST", () => {
    // The wrong-host child is rejected loudly, never spawned on a different host than
    // its parent (one PTY tree, one kaval).
    for (const [requested, parent] of [
      [REMOTE, LOCAL_LOCATION],
      [LOCAL_LOCATION, REMOTE],
      [REMOTE, OTHER_REMOTE],
    ] as const) {
      let thrown: unknown;
      try {
        resolveCreateLocation(requested, parent);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(ORPCError);
      expect((thrown as ORPCError<string, unknown>).code).toBe("BAD_REQUEST");
    }
  });
});

describe("createTerminal — location selects the endpoint and round-trips to disk", () => {
  const created: string[] = [];

  beforeEach(() => {
    setSurfaceCtx(noopSurfaceCtxForTest());
    setWorkspaceSurfaceCtx(noopWorkspaceSurfaceCtxForTest());
  });

  afterEach(() => {
    for (const id of created.splice(0)) unregisterTerminal(id);
    __resetSurfaceCtxForTest();
    __resetWorkspaceSurfaceCtxForTest();
  });

  it("a local create round-trips its location through to the saved session", () => {
    const info = createTerminal(
      "/work/repo",
      undefined,
      undefined,
      LOCAL_LOCATION,
    );
    created.push(info.id);

    // The created terminal carries the requested host on its authored record…
    expect(getTerminal(info.id)?.meta.location).toEqual(LOCAL_LOCATION);

    // …and that location rides into the saved session record (the persist half of the
    // create→restore round-trip).
    const saved = snapshotSession().terminals.find((t) => t.id === info.id);
    expect(saved?.location).toEqual(LOCAL_LOCATION);

    // Feeding the saved location back into a create — exactly what session restore does
    // (forwarding `t.location`) — re-spawns on the same host.
    const reborn = createTerminal(
      saved?.cwd,
      undefined,
      undefined,
      saved?.location,
    );
    created.push(reborn.id);
    expect(getTerminal(reborn.id)?.meta.location).toEqual(LOCAL_LOCATION);
  });

  it("a remote location throws (no remote endpoint yet) rather than degrading onto the local PTY", () => {
    // The `{kind:"remote"}` resolver arm must fail loudly until F-REMOTE dials one — a
    // remote terminal silently served by the local endpoint would be a wrong-host bug,
    // not a graceful default (the no-fallbacks stance).
    expect(() =>
      createTerminal("/work/repo", undefined, undefined, REMOTE),
    ).toThrow(/remote host/);
  });
});
