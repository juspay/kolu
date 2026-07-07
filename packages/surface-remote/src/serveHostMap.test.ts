/**
 * `serveHostMap` — the pool → `SurfaceMap` `MapRegistry` adapter. Pinned NODE-side
 * (no solid client): the `SessionState → EntryConnectionState` projection as a pure
 * fn, `buildRemotePool.subscribe`'s ordering, and — the coordinator-mandated pin — a
 * STATUS transition (warming → connected) republishing the served `entries` stream
 * WITHOUT a membership change (the fused membership + `onState` subscribe).
 */

import { defineSurface } from "@kolu/surface/define";
import { directLink } from "@kolu/surface/links/direct";
import { defineSurfaceMap, type EntryStatus } from "@kolu/surface-map";
import type { AnyContractRouter } from "@orpc/contract";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { buildRemotePool } from "./hostFanout";
import { projectState, serveHostMap } from "./serveHostMap";
import type { Session, SessionState } from "./session";

const entrySurface = defineSurface({
  cells: {
    info: {
      schema: z.object({ v: z.number() }),
      default: { v: 0 },
      verbs: ["get"],
    },
  },
});
const HostKey = z.string().brand("HostKey");
const map = defineSurfaceMap(HostKey, entrySurface);

const st = (
  connection: SessionState["connection"],
  lastError: string | null = null,
): SessionState => ({
  connection,
  progressLines: [],
  remoteProgressLines: [],
  lastError,
  failureCause: null,
});

type FakeSession = Session & { clockOffset(): number | null };

function fakeSession(initial: SessionState, offset: number | null) {
  let state = initial;
  let clockOffset = offset;
  const listeners = new Set<(s: SessionState) => void>();
  const session = {
    onState(cb: (s: SessionState) => void) {
      cb(state);
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    clockOffset: () => clockOffset,
    destroy() {},
  } as unknown as FakeSession;
  return {
    session,
    setState(next: SessionState) {
      state = next;
      for (const l of [...listeners]) l(next);
    },
    setOffset(o: number | null) {
      clockOffset = o;
    },
  };
}

function fakePool() {
  const sessions = new Map<string, ReturnType<typeof fakeSession>>();
  const listeners = new Set<() => void>();
  const fire = () => {
    for (const l of [...listeners]) l();
  };
  const pool = {
    hosts: () => [...sessions.keys()],
    has: (h: string) => sessions.has(h),
    getSession: (h: string): FakeSession | undefined =>
      sessions.get(h)?.session,
    subscribe: (cb: () => void) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
  return {
    pool,
    add(h: string, s: ReturnType<typeof fakeSession>) {
      sessions.set(h, s);
      fire(); // fire AFTER the Map mutation (ordering), as buildRemotePool does
    },
    remove(h: string) {
      sessions.delete(h);
      fire();
    },
  };
}

/** Consume the served `entries.get({key})` stream node-side. */
async function entriesGet(
  link: unknown,
  key: string,
): Promise<AsyncIterator<EntryStatus>> {
  // biome-ignore lint/suspicious/noExplicitAny: walk the served oRPC link by string
  const iterable = await (link as any).surface.entries.get({ key });
  return iterable[Symbol.asyncIterator]();
}

describe("projectState — SessionState → EntryConnectionState", () => {
  it("maps each connection state, gating `connected` on the measured offset", () => {
    expect(projectState(st("copying"), 5)).toEqual({ kind: "copying" });
    expect(projectState(st("connecting"), 5)).toEqual({ kind: "connecting" });
    expect(projectState(st("connected"), 5)).toEqual({
      kind: "connected",
      clockOffset: 5,
    });
    // connected but no offset yet → still settling (connected REQUIRES the offset).
    expect(projectState(st("connected"), null)).toEqual({ kind: "connecting" });
    expect(projectState(st("disconnected", "boom"), 5)).toEqual({
      kind: "disconnected",
      reason: "boom",
    });
    expect(projectState(st("failed", "dead"), 5)).toEqual({
      kind: "failed",
      reason: "dead",
    });
    // reason coalesces a null lastError.
    expect(projectState(st("disconnected"), 5)).toEqual({
      kind: "disconnected",
      reason: "disconnected",
    });
    expect(projectState(undefined, 5)).toEqual({ kind: "connecting" });
  });
});

describe("buildRemotePool.subscribe — membership, ordering", () => {
  it("fires after add/remove/destroyAll, with hosts()/has() already reflecting the change", async () => {
    const built = buildRemotePool<Session, unknown>({
      initialHosts: ["a"],
      buildEntry: () => ({
        session: { destroy() {} } as unknown as Session,
        handler: null,
      }),
    });
    const seen: string[][] = [];
    built.subscribe(() => seen.push(built.hosts()));
    await built.add("b");
    expect(seen.at(-1)).toEqual(["a", "b"]); // add reflected BEFORE the fire
    expect(built.has("b")).toBe(true);
    await built.remove("a");
    expect(seen.at(-1)).toEqual(["b"]);
    built.destroyAll();
    expect(seen.at(-1)).toEqual([]);
  });
});

describe("serveHostMap — entries authority", () => {
  it("THE PIN: a warming→connected STATUS transition republishes entries with NO membership change", async () => {
    const pf = fakePool();
    const served = serveHostMap(map, pf.pool, {
      // dummy entry link — this pin exercises `entries`, not member forwarding
      linkFor: () => ({ surface: {} }),
    });
    const link = directLink<AnyContractRouter>(
      // biome-ignore lint/suspicious/noExplicitAny: served router
      served.router as any,
    );
    const s = fakeSession(st("connecting"), 42);
    pf.add("a", s);

    const iter = await entriesGet(link, "a");
    expect((await iter.next()).value).toEqual({ kind: "warming" }); // connecting → warming

    // A PURE status transition (no add/remove) must reach the entries stream.
    const pending = iter.next();
    s.setState(st("connected"));
    expect((await pending).value).toEqual({
      kind: "connected",
      clockOffset: 42,
    });
    served.dispose();
  });

  it("membership add drives entries.keys()", async () => {
    const pf = fakePool();
    const served = serveHostMap(map, pf.pool, {
      linkFor: () => ({ surface: {} }),
    });
    const link = directLink<AnyContractRouter>(
      // biome-ignore lint/suspicious/noExplicitAny: served router
      served.router as any,
    );
    // biome-ignore lint/suspicious/noExplicitAny: walk the served link by string
    const keysIter = (await (link as any).surface.entries.keys(undefined))[
      Symbol.asyncIterator
    ]();
    expect((await keysIter.next()).value).toEqual([]); // no members yet
    pf.add("a", fakeSession(st("connected"), 0));
    expect((await keysIter.next()).value).toEqual(["a"]);
    served.dispose();
  });
});
