/**
 * `serveSurfaceMap` — the SERVER half. A router transform, not a transport
 * change: every entry-member call reads its folded `mapKey`, resolves membership
 * at call time, and FORWARDS to the resolved session's entry-surface link. An
 * unknown key is a typed rejection (one-shot calls) or an immediate typed end
 * (streams); a key that leaves membership mid-stream ends its live subscriptions
 * with a TYPED end BEFORE the session is destroyed (no socket-error frame after
 * a typed end).
 *
 * Membership + status live in ONE published collection (`entries`), driven by
 * the `MapRegistry` — the source-agnostic seam any session source backs (the
 * warm ssh pool, a mock harness). Status is DERIVED from the resolved session's
 * connection state (a projection, never a second writer).
 */

import { collection } from "@kolu/surface";
import type { SurfaceSpec } from "@kolu/surface/define";
import { resolveCellVerbs, resolveCollectionVerbs } from "@kolu/surface/define";
import {
  type CollectionHandlerDeps,
  collectionHandlers,
  inMemoryChannelByName,
} from "@kolu/surface/server";
import { ORPCError } from "@orpc/client";
import { implement } from "@orpc/server";
import type { z } from "zod";
import type { EntryStatus, SurfaceMap } from "./define";

// ── The resolver / membership seam ──────────────────────────────────────

/** A session's connection state — the map DERIVES {@link EntryStatus} from it (a
 *  projection, never a second writer). `copying`/`connecting` project to
 *  `warming`; `connected` carries the serving process's own-clock offset at
 *  hello; `disconnected`/`failed` project to `failed(reason)`. */
export type EntryConnectionState =
  | { kind: "copying" }
  | { kind: "connecting" }
  | { kind: "connected"; clockOffset: number }
  | { kind: "disconnected"; reason: string }
  | { kind: "failed"; reason: string };

/** A resolved, serveable entry. Carries what the map needs to (a) FORWARD calls
 *  (a live entry-surface oRPC client/link to proxy to) and (b) observe status
 *  (the session's connection state). */
export interface EntrySession {
  /** The entry-surface oRPC client/link the map forwards member calls to
   *  (`link.surface.<member>.<verb>(input)`). */
  readonly link: unknown;
  /** The session's current connection state — read fresh on each publish; the
   *  registry re-fires `subscribe` when it changes so `entries` re-projects. */
  readonly state: EntryConnectionState;
}

/** A terminal, no-session entry — a structural fault (no drv for arch, a bogus
 *  host) or the mock harness's failed member. Publishes `failed(reason)`
 *  directly. */
export interface EntryFault {
  readonly failed: string;
}

/** The membership + resolution seam. ONE writer (the pool / the harness).
 *
 *  - CLAUSE 1 (ordering): `onChange` fires only AFTER `members()`/`has()` reflect
 *    the change.
 *  - CLAUSE 2 (snapshot): `members()` and `has()` answer from ONE consistent view.
 *  - Status is DERIVED from the resolved session's state (projection). */
export interface MapRegistry<K> {
  members(): K[];
  subscribe(onChange: () => void): () => void;
  has(key: K): boolean;
  resolve(key: K): EntrySession | EntryFault;
}

function isFault(r: EntrySession | EntryFault): r is EntryFault {
  return "failed" in r;
}

/** Project a session's connection state onto the published {@link EntryStatus}. */
function projectStatus(state: EntryConnectionState): EntryStatus {
  switch (state.kind) {
    case "copying":
    case "connecting":
      return { kind: "warming" };
    case "connected":
      return { kind: "connected", clockOffset: state.clockOffset };
    case "disconnected":
    case "failed":
      return { kind: "failed", reason: state.reason };
  }
}

// ── serveSurfaceMap ─────────────────────────────────────────────────────

/** The verbs an entry member exposes, tagged streaming vs unary — the server's
 *  dual of the contract-side fold walk. */
interface MemberVerb {
  verb: string;
  streaming: boolean;
}

function entryMemberVerbs(
  entrySpec: SurfaceSpec,
): Array<[member: string, verbs: MemberVerb[]]> {
  const out: Array<[string, MemberVerb[]]> = [];
  for (const [key, s] of Object.entries(entrySpec.cells ?? {})) {
    out.push([
      key,
      resolveCellVerbs(s).map((verb) => ({ verb, streaming: verb === "get" })),
    ]);
  }
  for (const [key, s] of Object.entries(entrySpec.collections ?? {})) {
    out.push([
      key,
      resolveCollectionVerbs(s).map((verb) => ({
        verb,
        streaming: verb === "keys" || verb === "get" || verb === "deltas",
      })),
    ]);
  }
  for (const key of Object.keys(entrySpec.streams ?? {})) {
    out.push([key, [{ verb: "get", streaming: true }]]);
  }
  for (const key of Object.keys(entrySpec.events ?? {})) {
    out.push([key, [{ verb: "get", streaming: true }]]);
  }
  for (const [ns, procs] of Object.entries(entrySpec.procedures ?? {})) {
    out.push([
      ns,
      Object.keys(procs).map((verb) => ({ verb, streaming: false })),
    ]);
  }
  return out;
}

/** Extract the entry surface's own input from the wire envelope `{ mapKey, input }`
 *  — the EXACT value the consumer passed (object, primitive, or undefined). No
 *  key-stripping heuristic: the key lives in its own `mapKey` field, so an entry
 *  input that itself has a `mapKey` field survives untouched (it rode `input`). */
function unwrapInput(wire: unknown): unknown {
  return (wire as { input?: unknown } | undefined)?.input;
}

/** Resolve `link.surface.<...path>` to its leaf callable. */
function leafAt(
  link: unknown,
  path: readonly string[],
): (input: unknown, opts: unknown) => unknown {
  let node: unknown = (link as { surface: unknown }).surface;
  for (const p of path) node = (node as Record<string, unknown>)[p];
  return node as (input: unknown, opts: unknown) => unknown;
}

export interface ServeSurfaceMapResult {
  /** A finalized top-level oRPC router — hand it straight to `directLink` (or a
   *  wire serve path). Serves `surface.<member>.<verb>` (key-folded, forwarded)
   *  and `surface.entries.{keys,get}` (the membership projection). */
  readonly router: unknown;
  /** Tear down the membership republish subscription. */
  dispose(): void;
}

/** Serve a `SurfaceMap` over a `MapRegistry`. */
export function serveSurfaceMap<KS extends z.ZodType, ES extends SurfaceSpec>(
  map: SurfaceMap<KS, ES>,
  registry: MapRegistry<z.infer<KS>>,
): ServeSurfaceMapResult {
  type K = z.infer<KS>;
  const keySchema = map.keySchema;
  const has = (k: K) => registry.has(k);
  const resolve = (k: K) => registry.resolve(k);
  const members = () => registry.members();

  const statusOf = (mapKey: K): EntryStatus => {
    const r = resolve(mapKey);
    return isFault(r)
      ? { kind: "failed", reason: r.failed }
      : projectStatus(r.state);
  };

  // ── Forward one streaming member call, ending TYPED on membership loss ──
  //
  // Race the upstream iterator against a "removed" signal. On removal the map
  // RETURNS (a typed end downstream) and then closes the upstream via
  // `it.return()` — so the client sees a graceful completion, never the
  // socket-error frame a mid-flight session teardown would raise. A real
  // upstream error still propagates.
  async function* forwardStream(
    mapKey: K,
    session: EntrySession,
    path: readonly string[],
    input: unknown,
  ): AsyncGenerator<unknown> {
    const leaf = leafAt(session.link, path);
    // Install the removal watcher BEFORE the dial await. The real pool removes
    // destroy→delete→notify, so a removal that lands WHILE the dial is in flight must be
    // observed here — otherwise the `has()` gate (upstream in makeStreamHandler) and this
    // watcher straddle the await and neither catches it, and a delta/fail-through member's
    // dial rejects into a raw stub error the client can't retry. `ended` resolves the
    // instant `mapKey` leaves membership, on the dial OR in the loop.
    let onEnd!: () => void;
    const ended = new Promise<void>((res) => {
      onEnd = res;
    });
    const unsub = registry.subscribe(() => {
      if (!has(mapKey)) onEnd();
    });
    try {
      let upstream: AsyncIterable<unknown>;
      try {
        upstream = (await leaf(input, {})) as AsyncIterable<unknown>;
      } catch (e) {
        // The dial itself rejected. If `mapKey` was removed while dialing, that is the
        // session-destroy fallout → typed end; a genuine dial fault (still a member)
        // propagates.
        if (!has(mapKey)) return;
        throw e;
      }
      // Removed while the (resolved) dial was in flight → typed end before the loop.
      if (!has(mapKey)) return;
      const it = upstream[Symbol.asyncIterator]();
      try {
        while (true) {
          const step = await Promise.race([
            it.next().then(
              (r) => ({ kind: "item" as const, r }),
              (e) => ({ kind: "error" as const, e }),
            ),
            ended.then(() => ({ kind: "end" as const })),
          ]);
          if (step.kind === "end") return; // removed mid-stream → typed end
          if (step.kind === "error") {
            // An upstream rejection is the session-destroy fallout, NOT a real fault, when
            // the key has left membership: end TYPED so a delta member never delivers a
            // raw stub ORPCError. A genuine error (still a member) propagates.
            if (!has(mapKey)) return;
            throw step.e;
          }
          if (step.r.done) return; // upstream ended → typed end
          yield step.r.value;
        }
      } finally {
        await it.return?.().catch(() => {});
      }
    } finally {
      unsub();
    }
  }

  const parseMapKey = (input: unknown): K =>
    keySchema.parse((input as { mapKey?: unknown } | undefined)?.mapKey) as K;

  const makeStreamHandler = (path: readonly string[]) =>
    async function* (opts: { input?: unknown }): AsyncGenerator<unknown> {
      const mapKey = parseMapKey(opts.input);
      if (!has(mapKey)) return; // absent at subscribe → immediate typed end
      const resolved = resolve(mapKey);
      if (isFault(resolved)) return; // terminal fault → typed end
      yield* forwardStream(mapKey, resolved, path, unwrapInput(opts.input));
    };

  const makeUnaryHandler =
    (path: readonly string[]) =>
    async (opts: {
      input?: unknown;
      signal?: AbortSignal;
    }): Promise<unknown> => {
      const mapKey = parseMapKey(opts.input);
      if (!has(mapKey)) {
        // A one-shot call cannot end gracefully — reject typed.
        throw new ORPCError("MAP_KEY_UNKNOWN", {
          message: `surface-map: key "${String(mapKey)}" is not a member`,
        });
      }
      const resolved = resolve(mapKey);
      if (isFault(resolved)) {
        throw new ORPCError("MAP_ENTRY_FAILED", { message: resolved.failed });
      }
      const leaf = leafAt(resolved.link, path);
      return await leaf(
        unwrapInput(opts.input),
        opts.signal ? { signal: opts.signal } : {},
      );
    };

  // ── Build the router ─────────────────────────────────────────────────
  // biome-ignore lint/suspicious/noExplicitAny: oRPC's implement chain is too dynamic for our runtime walk; the folded contract carries call-site safety.
  const t = implement(map.contract as any) as any;
  const inner: Record<string, Record<string, unknown>> = {};

  for (const [member, verbs] of entryMemberVerbs(map.entry.spec)) {
    inner[member] = {};
    for (const { verb, streaming } of verbs) {
      const path = [member, verb] as const;
      inner[member][verb] = t.surface[member][verb].handler(
        streaming ? makeStreamHandler(path) : makeUnaryHandler(path),
      );
    }
  }

  // ── The `entries` membership collection ──────────────────────────────
  const channel = inMemoryChannelByName();
  const keysBus = channel<K[]>("entries:keys");
  const perKeyBus = (k: K) => channel<EntryStatus>(`entries:${String(k)}`);

  const entriesDeps: CollectionHandlerDeps<K, EntryStatus> = {
    readAll: () =>
      new Map(members().map((k) => [k, statusOf(k)] as [K, EntryStatus])),
    readOne: (k) => (has(k) ? statusOf(k) : undefined),
    upsert: () => {}, // read-only on the wire; the registry is the sole writer
    remove: () => {},
    perKeyBus,
    keysBus,
  };
  const entriesDescriptor = collection<"entries", K, EntryStatus>({
    name: "entries",
    keySchema: map.entriesSpec.keySchema as z.ZodType<K>,
    schema: map.entriesSpec.schema,
  });
  const entriesHandlers = collectionHandlers(entriesDescriptor, entriesDeps);
  inner.entries = {
    keys: t.surface.entries.keys.handler(entriesHandlers.keys),
    get: t.surface.entries.get.handler(entriesHandlers.get),
  };

  // One writer publishes membership + status together — fire on every registry
  // change (add/remove membership AND per-session status transitions).
  const unsubRepublish = registry.subscribe(() => {
    const ks = members();
    keysBus.publish(ks);
    for (const k of ks) perKeyBus(k).publish(statusOf(k));
  });

  // Same shape `implementSurface` returns: a `{ surface: <router> }` fragment.
  // `directLink`/`createRouterClient` walks it directly (`.surface.<member>.<verb>`),
  // and it spreads into a host `t.router({ ...fragment })` for a wire serve path.
  const router = { surface: t.router(inner) };

  return {
    router,
    dispose: () => {
      unsubRepublish();
    },
  };
}
