/**
 * Shared in-process map harness — the vertical slice (`serveSurfaceMap` +
 * `connectSurfaceMap`) wired over `directLink` and a mock `MapRegistry`, reused
 * by both `mapHarness.test.ts` (the framework e2e) and `scoped.test.ts` (the
 * `scopedByEntry` ownership contract). `.testlib.ts` is test-only (dropped from
 * the build fileset and not matched by the vitest `*.test.ts` include), so it
 * never ships and never runs as a suite of its own.
 */

import type { Surface, SurfaceSpec } from "@kolu/surface/define";
import { defineSurface } from "@kolu/surface/define";
import { directLink } from "@kolu/surface/links/direct";
import { implementSurface, inMemoryStore } from "@kolu/surface/server";
import type { AnyContractRouter } from "@orpc/contract";
import { z } from "zod";
import { connectSurfaceMap } from "./client";
import { defineSurfaceMap, type KeyCodec } from "./define";
import {
  type EntryConnectionState,
  type EntrySession,
  type MapRegistry,
  serveSurfaceMap,
} from "./server";

// ── The entry surface (padi-shaped: a read-only `urgency` cell + a collection) ─
export const entrySurface = defineSurface({
  cells: {
    urgency: {
      schema: z.object({
        awaiting: z.number(),
        awaitingIds: z.array(z.string()),
      }),
      default: { awaiting: 0, awaitingIds: [] },
      verbs: ["get"], // server-authority, read-only — like padi's real `urgency`
    },
  },
  collections: {
    terminals: {
      keySchema: z.string(),
      schema: z.object({ title: z.string() }),
    },
  },
});

export const HostKeySchema = z.string().brand("HostKey");
export type HostKey = z.infer<typeof HostKeySchema>;
// The harness's own key IS already a plain (branded) string, so its codec is the
// identity pair — kolu's real `HostKey` (a discriminated-sum object) is the case
// {@link KeyCodec} exists for; see `hostKeyCodec` in `kolu-common/hostKey`.
export const identityCodec: KeyCodec<HostKey> = {
  encode: (k) => k,
  decode: (s) => s as HostKey,
};

// ── The harness's DOMAIN failure schema (PR4) ────────────────────────────────
// A minimal `{ cause, reason }` — the real padi map carries a richer discriminated
// union (`PadiEntryFailureSchema`); the framework only needs SOME schema-valid
// domain value on the `failed` arm, so this is the smallest one that exercises it.
export const testFailureSchema = z.object({
  cause: z.string(),
  reason: z.string(),
});
export type TestFailure = z.infer<typeof testFailureSchema>;

/** Build a test map — `failure` is the one field every test map shares
 *  ({@link testFailureSchema}), defaulted here so a future required `defineSurfaceMap`
 *  field is a ONE-line change rather than editing every call site (PR4's own `failure`
 *  addition was exactly that pain). Callers pass the per-map `key`/`entry`/`codec`. */
export function buildTestMap<
  KS extends z.ZodType,
  const ES extends SurfaceSpec,
>(opts: { key: KS; entry: Surface<ES>; codec: KeyCodec<z.infer<KS>> }) {
  return defineSurfaceMap({ ...opts, failure: testFailureSchema });
}

export const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

/** A mock in-process entry surface, with a spy on how many times its `urgency`
 *  stream is subscribed upstream (the dedup measurement). */
export function makeEntry(urgency: {
  awaiting: number;
  awaitingIds: string[];
}) {
  let urgencyGetCount = 0;
  const { router, ctx } = implementSurface(entrySurface, {
    cells: { urgency: { store: inMemoryStore(urgency) } },
    collections: {
      terminals: {
        readAll: () => new Map<string, { title: string }>(),
        upsert: () => {},
        remove: () => {},
      },
    },
  });
  const raw = directLink<typeof entrySurface.contract>(router as never);
  // Count subscriptions to `surface.urgency.get` — one per upstream forward.
  // biome-ignore lint/suspicious/noExplicitAny: opaque oRPC client, spied by string
  const link = new Proxy(raw as any, {
    get(target, prop) {
      if (prop !== "surface") return target[prop];
      const surf = target.surface;
      return new Proxy(surf, {
        get(_s, member) {
          if (member !== "urgency") return surf[member];
          const ns = surf[member];
          return new Proxy(ns, {
            get(_n, verb) {
              if (verb !== "get") return ns[verb];
              return (i: unknown, o: unknown) => {
                urgencyGetCount++;
                return ns.get(i, o);
              };
            },
          });
        },
      });
    },
  });
  return {
    link,
    urgencyGetCount: () => urgencyGetCount,
    /** Push a new urgency value through the server-internal ctx writer (the fold
     *  path) so a downstream watcher sees a genuine change — for driving
     *  `watchByEntry`'s raise detection. */
    setUrgency: (u: { awaiting: number; awaitingIds: string[] }) =>
      ctx.cells.urgency.set(u),
  };
}

/** A mock `MapRegistry` backed by a `Map` of key → session|fault. Honors the two
 *  clauses: `members()`/`has()` reflect a change BEFORE `onChange` fires, from
 *  one consistent view. */
export function makeRegistry() {
  const entries = new Map<
    HostKey,
    {
      session: EntrySession<"copying", TestFailure> | null;
      fault?: TestFailure;
    }
  >();
  const listeners = new Set<() => void>();
  const fire = () => {
    for (const l of [...listeners]) l();
  };
  const registry: MapRegistry<HostKey, "copying", TestFailure> = {
    members: () => [...entries.keys()],
    has: (k) => entries.has(k),
    subscribe: (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    resolve: (k) => {
      const e = entries.get(k);
      if (!e)
        return {
          kind: "fault",
          failure: { cause: "unknown", reason: "unknown key" },
        };
      if (e.fault !== undefined) return { kind: "fault", failure: e.fault };
      return e.session as EntrySession<"copying", TestFailure>;
    },
  };
  return {
    registry,
    addSession(
      k: HostKey,
      link: unknown,
      state: EntryConnectionState<"copying", TestFailure>,
    ) {
      entries.set(k, { session: { kind: "session", link, state } });
      fire();
    },
    // PR4: a structural fault carries a schema-valid domain `failure` (the mock's
    // stand-in for the real classifier), never a fabricated catch-all.
    addFault(k: HostKey, failure: TestFailure) {
      entries.set(k, { session: null, fault: failure });
      fire();
    },
    setState(k: HostKey, state: EntryConnectionState<"copying", TestFailure>) {
      const e = entries.get(k);
      if (e?.session) {
        entries.set(k, {
          session: { kind: "session", link: e.session.link, state },
        });
        fire();
      }
    },
    remove(k: HostKey) {
      // CLAUSE 1 ordering: drop membership FIRST, then fire — so the map's
      // stream-forwarders see `!has(k)` on the notification and end their
      // streams TYPED before this reference is dropped (no socket-error frame).
      entries.delete(k);
      fire();
    },
  };
}

export function setup() {
  const map = buildTestMap({
    key: HostKeySchema,
    entry: entrySurface,
    codec: identityCodec,
  });
  const reg = makeRegistry();
  const served = serveSurfaceMap(map, reg.registry);
  // biome-ignore lint/suspicious/noExplicitAny: served router is a runtime-valid oRPC router; the client re-types via map.entry.
  const mapLink = directLink<AnyContractRouter>(served.router as any);
  const client = connectSurfaceMap(map, mapLink);
  return { map, served, client, ...reg };
}

export const A = HostKeySchema.parse("a");
export const B = HostKeySchema.parse("b");
export const C = HostKeySchema.parse("c");
export const D = HostKeySchema.parse("d");

// `clockOffset` accepts `null` (not-yet-measured) as well as a number: readiness is
// link-liveness, so a `connected` state is legal with an unmeasured offset.
export const connected = (
  clockOffset: number | null,
): EntryConnectionState<"copying", TestFailure> => ({
  kind: "connected",
  clockOffset,
});

/** A terminal `failed` connection state carrying a domain `failure` (PR4) — the
 *  arm REQUIRES it, so this helper cannot construct the illegal failed-without-
 *  failure state (see `entryConnectionState.test-d.ts`). */
export const failed = (
  failure: TestFailure,
): EntryConnectionState<"copying", TestFailure> => ({
  kind: "failed",
  failure,
});

/** A `disconnected` connection state — TRANSIENT when `failure` is omitted (the
 *  classifier returned nothing → projects to warming), STANDING when supplied
 *  (a refuse → projects to failed). */
export const disconnected = (
  failure?: TestFailure,
): EntryConnectionState<"copying", TestFailure> =>
  failure === undefined
    ? { kind: "disconnected" }
    : { kind: "disconnected", failure };
