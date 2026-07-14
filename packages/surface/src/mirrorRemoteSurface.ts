/**
 * `mirrorRemoteSurface` — drive a *remote* surface's primitives into local
 * sinks. The consume-side **dual of `implementSurface`**.
 *
 * `implementSurface(surface, deps)` walks a surface spec and wires the *produce*
 * side: each primitive gets a server handler that yields values on demand. This
 * walks the *same* spec and wires the *consume* side: each primitive's frames are
 * subscribed through a live client and pushed into a caller-supplied **sink**.
 * Borrowing the pipes/conduit vocabulary, `implementSurface` builds a Source and
 * `mirrorRemoteSurface` connects it to a `SurfaceSink` and runs it — the sink is
 * the consume-side algebra to `implementSurface`'s produce-side `deps`.
 *
 * This is the "full house" the per-primitive helpers were a brick of: one
 * declarative call mirrors a cell, a collection, a stream, and an event together,
 * instead of a consumer hand-stitching `<coll>.keys`+`<coll>.get`, a separate
 * `<cell>.get` read, and a separate `<stream>.get` loop (the shape that let
 * `fleet.ts`'s version handling drift into a string-compare skew bug). The
 * per-key collection bridge that used to be public `mirrorRemoteCollection` now
 * lives here as the private `mirrorCollection` step.
 *
 * The sink does NOT have to re-serve the surface (that is `projectSurface`'s job —
 * "a server that's a client"). A sink can fold the frames anywhere: the
 * `pulam-tui` fleet board keys every host's terminals into one `(host, id)` Solid
 * store; kolu's R-2 fold is intended to merge each awareness upsert into its own
 * co-owned `terminalMetadata` (a planned/drishti consumer, not yet wired in this
 * repo). So the sink is per-primitive *callbacks*, never a fixed local ctx —
 * interception is the common case, not the exception.
 *
 * Teardown is the load-bearing detail, shared with `projectSurface`: every
 * subscription threads the caller's `signal` into its client call and wraps the
 * iterator with `iterateUntilAborted`, so an abort-time rejection (the publisher
 * rejects pending pulls with `signal.reason` on shutdown) ends the loop cleanly
 * rather than surfacing as an unhandled rejection. The returned `done` promise
 * settles when every subscription has settled — which over one shared link means
 * the link closed (or the caller aborted): the cue a consumer flips to
 * "unreachable" on.
 *
 * A *total* dual mirrors every primitive its producer wires, and `implementSurface`
 * wires PROCEDURES too. Streaming state is PUSH (frames into a sink); a procedure
 * is PULL (a local call runs on the remote and returns), so it can't live in the
 * push-only sink — it comes back as a **forwarding stub** on the return alongside
 * `done`. `mirrorRemoteSurface(remote, client, sink)` thus yields `{ procedures,
 * done }`: the streaming half folded into `sink`, the procedure half a set of
 * stubs that relay `client.surface.<ns>.<verb>` to the remote. Graft those stubs
 * back into an `implementSurface` and `serve ∘ mirror ≈ identity` — the
 * location-transparency the whole remote-terminals epic rests on.
 */

import type { ZodType } from "zod";
import type {
  CollectionDeltasMsg,
  CollectionSpec,
  ProcedureSpec,
  Surface,
  SurfaceSpec,
  SurfaceTypes,
} from "./define";
import { collectionHasDeltas } from "./define";
import type { SurfaceClientLike } from "./project";
import { isAbortReason, iterateUntilAborted } from "./server";

// ── ClientSurfaceMismatchError ──────────────────────────────────────────

/** One name for one invariant: a primitive/procedure the caller wired has no
 *  matching entry on the `client`, so the client is wrong or incompatible. Every
 *  mismatch site — the eager streaming-setup checks (`requireEntry`, the
 *  collection `keys`-verb check) and the lazy per-procedure stub — throws this,
 *  so the same fault reaches a consumer through one shared type regardless of
 *  which channel (`done` vs a stub call) delivers it. The `what` clause names the
 *  specific entry that's missing; the rest of the sentence is fixed here so the
 *  contract lives in one place. */
export class ClientSurfaceMismatchError extends Error {
  constructor(what: string) {
    super(
      `mirrorRemoteSurface: ${what} — wrong or incompatible client (client/surface mismatch).`,
    );
    this.name = "ClientSurfaceMismatchError";
  }
}

// ── SurfaceSink — the consume-side algebra ──────────────────────────────

/** Per-primitive consumers for `mirrorRemoteSurface`, typed off the source
 *  surface's spec `S`. Every entry is optional: a primitive is subscribed iff a
 *  sink is supplied, so a consumer that only wants the `snapshots` collection (the
 *  R-2 fold is intended to) provides just that, and one that wants the whole
 *  surface (the fleet board, today) provides all of them. Omission is deliberate
 *  non-interest, not a
 *  silent fallback — the surface still serves the primitive, this consumer just
 *  doesn't read it.
 *
 *  - `cells.<k>`        — called with each value frame (snapshot then deltas).
 *  - `collections.<k>`  — `{ upsert, remove }`; keys are discovered from the
 *                         collection's `keys` stream and per-key values pumped in,
 *                         exactly the old `mirrorRemoteCollection` contract.
 *  - `streams.<k>`      — `{ input, onFrame }`; `input` is the stream argument
 *                         (often `{}`), `onFrame` sees each frame.
 *  - `events.<k>`       — `{ input, onFrame }`; same shape as a stream, but with
 *                         no snapshot obligation (the Event contract). */
export interface SurfaceSink<S extends SurfaceSpec> {
  cells?: {
    [K in keyof SurfaceTypes<S>["cells"] & string]?: (
      value: SurfaceTypes<S>["cells"][K] extends { Value: infer V } ? V : never,
    ) => void;
  };
  collections?: {
    [K in keyof SurfaceTypes<S>["collections"] & string]?: {
      upsert: (
        key: SurfaceTypes<S>["collections"][K] extends { Key: infer Kk }
          ? Kk
          : never,
        value: SurfaceTypes<S>["collections"][K] extends { Value: infer V }
          ? V
          : never,
      ) => void;
      remove: (
        key: SurfaceTypes<S>["collections"][K] extends { Key: infer Kk }
          ? Kk
          : never,
      ) => void;
      /** Keys already held for this collection from a PRIOR spawn (a re-serve's
       *  cross-reconnect cache). On the FIRST `keys` frame of THIS mirror, any of
       *  these absent from the fresh snapshot are pruned via `remove` — so a key
       *  that departed while the link was down is reconciled on reconnect (no
       *  stale ghost row) without clearing survivors (no empty flash). Omit for a
       *  first-connect mirror with nothing carried over (the default). */
      initialKeys?: () => Iterable<
        SurfaceTypes<S>["collections"][K] extends { Key: infer Kk } ? Kk : never
      >;
    };
  };
  streams?: {
    [K in keyof SurfaceTypes<S>["streams"] & string]?: {
      input: SurfaceTypes<S>["streams"][K] extends { Input: infer I }
        ? I
        : never;
      onFrame: (
        frame: SurfaceTypes<S>["streams"][K] extends { Output: infer O }
          ? O
          : never,
      ) => void;
    };
  };
  events?: {
    [K in keyof SurfaceTypes<S>["events"] & string]?: {
      input: SurfaceTypes<S>["events"][K] extends { Input: infer I }
        ? I
        : never;
      onFrame: (
        frame: SurfaceTypes<S>["events"][K] extends { Payload: infer P }
          ? P
          : never,
      ) => void;
    };
  };
}

// ── ProcedureForwarders — the consume-side PULL half of the dual ─────────

/** A forwarding stub for one procedure: a local call that runs on the remote and
 *  returns its result — request/response, nothing copied or subscribed. The shape
 *  matches the surface client's own verb (`client.surface.<ns>.<verb>`), so
 *  re-serving the mirror is a one-line `({ input }) => forward(input)` graft (the
 *  `serve ∘ mirror ≈ identity` the epic rests on). An optional per-call
 *  `{ signal }` threads cancellation through to the underlying client call. */
type ProcedureForwarder<P extends ProcedureSpec<unknown, unknown>> = P extends {
  input: ZodType<infer I>;
  output: ZodType<infer O>;
}
  ? (input: I, opts?: { signal?: AbortSignal }) => Promise<O>
  : P extends { input: ZodType<infer I> }
    ? (input: I, opts?: { signal?: AbortSignal }) => Promise<void>
    : P extends { output: ZodType<infer O> }
      ? (input?: undefined, opts?: { signal?: AbortSignal }) => Promise<O>
      : (input?: undefined, opts?: { signal?: AbortSignal }) => Promise<void>;

/** The consume-side dual of a producer's procedures: one forwarding stub per
 *  `<ns>.<verb>` the source surface wires. A procedure has no standing cost (a
 *  stub is just a typed passthrough), so — unlike the opt-in streaming sinks —
 *  EVERY procedure is forwarded: the field is always present and the dual always
 *  total. `{}` when the surface declares no procedures. */
export type ProcedureForwarders<S extends SurfaceSpec> =
  S["procedures"] extends Record<
    string,
    Record<string, ProcedureSpec<unknown, unknown>>
  >
    ? {
        [NS in keyof S["procedures"] & string]: {
          [V in keyof S["procedures"][NS] & string]: ProcedureForwarder<
            S["procedures"][NS][V]
          >;
        };
      }
    : Record<string, never>;

/** What `mirrorRemoteSurface` returns — the total dual of `implementSurface`'s
 *  `{ router, ctx }`.
 *
 *  - `procedures` — forwarding stubs for EVERY procedure the source wires
 *    (`procedures.<ns>.<verb>(input)` runs on the remote and returns its result).
 *    Available synchronously and bound to the `client` you passed, so a stub stays
 *    live for that client's lifetime. `{}` when the surface has no procedures.
 *  - `done` — settles when every opted-in streaming subscription settles; over one
 *    shared link that means the link closed (or `signal` aborted) — the cue a
 *    consumer flips a host to "unreachable" on. Rejects if a sink throws (a broken
 *    local fold — fail-fast) or setup hits a client/surface mismatch. */
export interface MirroredSurface<S extends SurfaceSpec> {
  procedures: ProcedureForwarders<S>;
  done: Promise<void>;
}

export interface MirrorRemoteSurfaceOptions {
  /** Torn down when aborted — threads into every subscription so the whole
   *  mirror unwinds with no leak (a consumer's dispose, or a parent shutdown). */
  signal?: AbortSignal;
  /** Non-fatal per-primitive errors (a per-key stream blip the mirror keeps
   *  going past). Defaults to a no-op — pass one to surface diagnostics. An
   *  AbortError is always swallowed (it's teardown), never logged. */
  log?: (line: string) => void;
}

// ── The client's per-primitive call shapes (structural) ──────────────────

/** The structural shape of one surface entry's client namespace — `surface.<k>`.
 *  Every concrete `SurfaceClientOf<S>["surface"][k]` is assignable to the subset
 *  used per primitive (the verbs vary by kind). Loosely typed on purpose: the
 *  precise per-key client type is already materialized once at the typed sink, so
 *  re-spelling it here would overflow TS's union budget (see `project.ts`). */
type EntryClient = {
  get: (input: unknown, opts?: { signal?: AbortSignal }) => Promise<unknown>;
  keys?: (
    input: unknown,
    opts?: { signal?: AbortSignal },
  ) => Promise<AsyncIterable<readonly unknown[]>>;
  /** A delta-declaring collection's SINGLE batched snapshot-then-delta stream —
   *  present iff the collection opts into the `deltas` verb. Takes no input
   *  (`undefined`); the whole collection is one stream. */
  deltas?: (
    input: undefined,
    opts?: { signal?: AbortSignal },
  ) => Promise<AsyncIterable<CollectionDeltasMsg<unknown, unknown>>>;
};

/** Resolve the client namespace entry for a primitive a sink opted into, or
 *  throw a client/surface-mismatch error. Only called when a sink IS supplied —
 *  so a missing entry is a wrong/incompatible client (fail-fast), never the
 *  tolerated "no sink = no interest" path. The `get` verb is the floor every
 *  primitive's entry must have; `keys` is checked separately for collections. */
function requireEntry(
  ns: Record<string, EntryClient>,
  key: string,
  kind: string,
): EntryClient {
  const entry = ns[key];
  if (!entry || typeof entry.get !== "function") {
    throw new ClientSurfaceMismatchError(
      `a sink was supplied for ${kind} "${key}" but the client has no such entry`,
    );
  }
  return entry;
}

/** The runtime shape of a forwarding stub — loosely typed; the precise per-verb
 *  type is materialized once at the public `ProcedureForwarders<S>` boundary. */
type ProcedureFn = (
  input?: unknown,
  opts?: { signal?: AbortSignal },
) => Promise<unknown>;

/** Build one forwarding stub per `<ns>.<verb>` procedure the spec declares. A stub
 *  is a thin relay to `client.surface.<ns>.<verb>(input)` — request/response, no
 *  subscription, no teardown — so this runs synchronously and the stubs are usable
 *  immediately. Validation is at CALL time, not build time: a stub for a procedure
 *  the client doesn't expose REJECTS with a loud client/surface mismatch (never a
 *  silent undefined — the no-fallback rule), so a deliberately narrowed client that
 *  omits procedures this consumer never calls is tolerated until one is invoked. */
function buildProcedureForwarders(
  client: SurfaceClientLike,
  spec: SurfaceSpec,
): Record<string, Record<string, ProcedureFn>> {
  const surfaceNs = client.surface as Record<
    string,
    Record<string, ProcedureFn> | undefined
  >;
  const out: Record<string, Record<string, ProcedureFn>> = {};
  for (const [nsKey, procs] of Object.entries(spec.procedures ?? {})) {
    // Capture only THIS namespace's client entry, not the whole `client.surface`,
    // so a stub never pins every other namespace's client alive for its lifetime
    // (the stubs outlive the build). The entry is fixed for the client, so reading
    // it once here is identical to the lazy per-call lookup.
    const nsClient = surfaceNs[nsKey];
    const verbs: Record<string, ProcedureFn> = {};
    for (const verb of Object.keys(procs)) {
      verbs[verb] = async (input, callOpts) => {
        const fn = nsClient?.[verb];
        if (typeof fn !== "function") {
          throw new ClientSurfaceMismatchError(
            `a forwarding stub was built for procedure "${nsKey}.${verb}" but the client has no such entry`,
          );
        }
        return fn(input, callOpts);
      };
    }
    out[nsKey] = verbs;
  }
  return out;
}

// ── mirrorRemoteSurface ──────────────────────────────────────────────────

/** Mirror `source` through `client` into a local handle — the total dual of
 *  `implementSurface`. Streaming primitives the `sink` opts into are subscribed and
 *  their frames pushed into the matching sink callback; EVERY procedure is returned
 *  as a forwarding stub under `.procedures`. The returned `.done` settles when all
 *  subscriptions settle (link closed / aborted). Callers pass the result of
 *  `surfaceClientRef(source, router)` or any `SurfaceClientOf<S>` for `client`; it
 *  is read structurally here.
 *
 *      const { procedures, done } = mirrorRemoteSurface(terminalWorkspaceSurface, client, {
 *        cells: { version: (v) => setSkew(!isContractVersionCompatible(v.contractVersion, OURS)) },
 *        collections: { snapshots: { upsert, remove } },
 *        streams: { activity: { input: {}, onFrame: (live) => setLive(live) } },
 *      }, { signal, log });
 *      await procedures.terminal.kill({ id });  // forwarded to the remote
 *      await done;                              // resolves when the link closes
 *
 * BREAKING (R7, kolu #1505): this used to return `Promise<void>` (the #1497
 * graduation shape), so the settle was `await mirrorRemoteSurface(...)`. It now
 * returns the plain handle `{ procedures, done }`, so a bare `await
 * mirrorRemoteSurface(...)` no longer waits (await on a non-thenable resolves at
 * once) — the settle is `await mirrorRemoteSurface(...).done`. Discarding the result
 * is NOT type-caught (no TS construct makes `await object` an error, so a rename
 * would not catch it either): a stale `await mirrorRemoteSurface(...)` keeps
 * COMPILING and silently no-ops. This was a LIVE hazard, not hypothetical — drishti
 * `master` still does `await mirrorRemoteSurface(...)` on its streaming sinks (the
 * #1497 shape it adopted in drishti PR #70). So the migration is mechanical, not
 * documentary, and now real: the paired drishti PR #71 (the surface→drishti
 * merge-gate in `.claude/rules/surface.md`) audits that one call site to
 * `await mirrorRemoteSurface(...).done`, pinned to this R7 revision; its FULL CI is
 * GREEN against the new `{ procedures, done }` API — all 18 odu nodes (every lane —
 * nix/typecheck/fmt-check/bun-nix-fresh/home-manager/drv-stability — on both
 * aarch64-darwin and x86_64-linux), exactly the lane set #70 passed for #1497.
 * No back-compat thenable is offered: the fail-fast rule prefers a deliberate
 * per-site migration over a shim that hides the changed contract — and the handle's
 * non-thenable contract is pinned in CI by the "returns a non-thenable handle" test
 * (mirrorRemoteSurface.test.ts), so nobody can quietly re-introduce that shim.
 */
export function mirrorRemoteSurface<S extends SurfaceSpec>(
  source: Surface<S>,
  client: SurfaceClientLike,
  sink: SurfaceSink<S>,
  opts: MirrorRemoteSurfaceOptions = {},
): MirroredSurface<S> {
  const { signal } = opts;
  const log = opts.log ?? (() => {});
  const ns = client.surface as Record<string, EntryClient>;
  const spec = source.spec;
  // The PULL half of the dual: a forwarding stub per procedure. Built up front —
  // stubs are stateless relays, usable immediately and independent of whether the
  // streaming setup below succeeds.
  const procedures = buildProcedureForwarders(client, spec) as
    // The runtime build is loose (string-keyed); the precise per-verb type is
    // pinned once here at the public boundary.
    ProcedureForwarders<S>;
  // Setup is two passes so it's all-or-nothing: pass 1 VALIDATES every opted-in
  // primitive (the only step that can throw a client/surface mismatch) and stages
  // a `start` closure; pass 2 runs the closures to begin subscriptions. Nothing is
  // subscribed until validation has fully succeeded — so a mismatch on a later
  // primitive can't leave an earlier primitive's long-lived task running (and
  // mutating the sink) after the caller already observed the rejection.
  const starts: Array<() => Promise<void>> = [];

  // View the precisely-typed sink through loose per-kind maps inside the body —
  // the public `SurfaceSink<S>` type already paid for the precision at the call
  // site; here we only need "is there a sink for this key, and call it".
  type CellSink = (value: unknown) => void;
  type CollSink = {
    upsert: (key: unknown, value: unknown) => void;
    remove: (key: unknown) => void;
    initialKeys?: () => Iterable<unknown>;
  };
  type FlowSink = { input: unknown; onFrame: (frame: unknown) => void };
  const cellSinks = sink.cells as
    | Record<string, CellSink | undefined>
    | undefined;
  const collSinks = sink.collections as
    | Record<string, CollSink | undefined>
    | undefined;
  const streamSinks = sink.streams as
    | Record<string, FlowSink | undefined>
    | undefined;
  const eventSinks = sink.events as
    | Record<string, FlowSink | undefined>
    | undefined;

  // Omitting a sink is deliberate non-interest — that primitive is skipped. But
  // SUPPLYING a sink means the caller expects that primitive on the wire, so a
  // missing client entry (or a missing required verb) is a client/surface
  // mismatch, not an absence to tolerate: the no-fallback rule says it crashes
  // loudly here, never degrades to silently-no-data while the caller still reads
  // `connected`. `requireEntry` enforces that — `continue` only when there is no
  // sink at all.

  // PASS 1 — validate every opted-in primitive and stage its `start` closure.
  // `requireEntry` (and the collection `keys` check) can throw synchronously on a
  // client/surface mismatch. That is a programming error, but the contract is
  // "all streaming failures are `done` rejections" — and a caller may fire `done`
  // `void`-style (the daemon does), where a sync throw would crash inline rather
  // than surface as a rejection it can flip a host on. So validation runs inside a
  // try and any throw becomes a rejected `done` — crucially, BEFORE any `start`
  // closure has run, so no subscription is left orphaned by the throw.
  try {
    // Cells: a cell's `get` yields snapshot-then-deltas with no input — just a
    // single-input stream whose argument is `{}`. So a cell sink reuses the stream
    // subscribe loop verbatim.
    for (const key of Object.keys(spec.cells ?? {})) {
      const onValue = cellSinks?.[key];
      if (!onValue) continue;
      const entry = requireEntry(ns, key, "cell");
      starts.push(() =>
        subscribeStream(entry, {}, onValue, signal, log, `${key} cell`),
      );
    }

    // Collections split by DECLARED protocol (SR5 — one protocol across the wire):
    // a collection that opts into the `deltas` verb is mirrored through its SINGLE
    // batched snapshot-then-delta stream; one WITHOUT it keeps the per-key
    // `keys`+`get` fan-out. The choice is read from the SPEC (`collectionHasDeltas`),
    // never probed on the link — an oRPC wire client is a lazy proxy whose every
    // property is a truthy callable, so a `entry.deltas`-truthiness probe would route
    // EVERY collection into a `deltas` call the server may never have registered (the
    // same doctrine `surfaceClient`'s `.use()` and `walkSurface` decide by).
    for (const key of Object.keys(spec.collections ?? {})) {
      const colSink = collSinks?.[key];
      if (!colSink) continue;
      const entry = ns[key];
      // `key` comes from `Object.keys(spec.collections)`, so — the loop only runs
      // when `spec.collections` is present — the spec for this key is present too.
      const collSpec = spec.collections?.[key] as CollectionSpec;
      if (collectionHasDeltas(collSpec)) {
        // Delta protocol: one stream carries snapshot-then-deltas for the whole
        // collection. SUPPLYING a sink means the caller expects that stream, never a
        // silent fall back to the per-key path. This structural check catches a
        // client whose namespace object literally lacks `deltas` (a plain-object /
        // test client, or one built from a DIFFERENT surface family). A real oRPC
        // WIRE client is a lazy proxy on which every property is a callable, so a
        // route the server never registered can't be caught here — it surfaces
        // instead as the subscribe rejection `mirrorCollectionDeltas` handles per the
        // mirror's upstream-error contract (the SAME limit the per-key `requireEntry`
        // path has). Routing is spec-driven — server and client share ONE surface
        // spec, so a declared-deltas collection IS served with deltas; a genuine
        // absence is a version skew, not a normal case.
        if (!entry || typeof entry.deltas !== "function") {
          throw new ClientSurfaceMismatchError(
            `a sink was supplied for collection "${key}" (declares the "deltas" verb) but the client has no "deltas" verb`,
          );
        }
        const deltasFn = entry.deltas;
        starts.push(() =>
          mirrorCollectionDeltas({
            label: `${key} collection`,
            log,
            signal,
            deltas: deltasFn(undefined, { signal }),
            onUpsert: colSink.upsert,
            onRemove: colSink.remove,
            initialKeys: colSink.initialKeys,
          }),
        );
        continue;
      }
      // Per-key protocol: discover keys from the `keys` stream, hold a per-key value
      // stream open for each present key, and remove departed keys.
      const perKeyEntry = requireEntry(ns, key, "collection");
      // A collection MUST expose `keys` — a `get`-only entry can't be a collection.
      if (!perKeyEntry.keys) {
        throw new ClientSurfaceMismatchError(
          `client entry "${key}" is missing the "keys" verb — it cannot serve the "${key}" collection`,
        );
      }
      const keysFn = perKeyEntry.keys;
      starts.push(() =>
        mirrorCollection({
          label: `${key} collection`,
          log,
          signal,
          keys: keysFn({}, { signal }),
          get: (k, s) =>
            perKeyEntry.get({ key: k }, { signal: s }) as Promise<
              AsyncIterable<unknown>
            >,
          onUpsert: colSink.upsert,
          onRemove: colSink.remove,
          initialKeys: colSink.initialKeys,
        }),
      );
    }

    // Streams + events: subscribe `get(input)` and push each frame. The two kinds
    // share a wire shape; the Event/Stream distinction (snapshot obligation) is the
    // server's, and the consume side treats both as "a frame arrived".
    for (const key of Object.keys(spec.streams ?? {})) {
      const s = streamSinks?.[key];
      if (!s) continue;
      const entry = requireEntry(ns, key, "stream");
      starts.push(() =>
        subscribeStream(
          entry,
          s.input,
          s.onFrame,
          signal,
          log,
          `${key} stream`,
        ),
      );
    }
    for (const key of Object.keys(spec.events ?? {})) {
      const e = eventSinks?.[key];
      if (!e) continue;
      const entry = requireEntry(ns, key, "event");
      starts.push(() =>
        subscribeStream(entry, e.input, e.onFrame, signal, log, `${key} event`),
      );
    }
  } catch (err) {
    // A setup mismatch caught before any subscription started (no `start` closure
    // has run yet) — nothing to unwind. The procedure forwarders are independent of
    // the streaming setup, so they're still returned; the failure surfaces on `done`.
    return { procedures, done: Promise.reject(err) };
  }

  // PASS 2 — validation passed, so start every staged subscription.
  const tasks = starts.map((start) => start());

  // `done` settles when every subscription has settled. Over one shared link that
  // means the link closed (or `signal` aborted) — the cue a consumer flips a host to
  // "unreachable" on. `allSettled`, not `all`: one primitive's *upstream* stream
  // error must not reject the whole mirror (it's already logged), and teardown is
  // uniform. But a *sink* failure is NOT an upstream blip — it's a bug in the
  // caller's local fold, and the no-fallback rule (`caught-error-must-not-
  // collapse-to-empty`) says it must surface, not be logged and swallowed: a task
  // tags such a rejection with `SinkError`, and the first one rethrows here so
  // `done` rejects rather than quietly resolving on a broken fold.
  const done = Promise.allSettled(tasks).then((results) => {
    for (const r of results) {
      if (r.status === "rejected" && r.reason instanceof SinkError) {
        throw r.reason.cause;
      }
    }
  });
  return { procedures, done };
}

/** A failure raised by a caller-supplied sink callback (`onFrame` / `upsert` /
 *  `remove`), as opposed to an upstream stream/iterator error. Tagged so the
 *  top-level fold can tell the two apart: an upstream blip settles (logged), a
 *  sink failure rejects the whole mirror (fail-fast — a broken local fold must
 *  surface, never collapse to a quietly-resolved mirror). The original error is
 *  carried on the standard `Error.cause` (the ES2022 options bag), NOT a
 *  redeclared field — a redeclared `cause` member would trip `noImplicitOverride`
 *  in any consumer that typechecks this source under that flag (drishti does). */
class SinkError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "SinkError";
  }
}

/** Seed a collection's carry-over key set from a caller-supplied `initialKeys`
 *  sink callback. A throw here — or from the iterable it returns — is a broken
 *  LOCAL fold (a bad sink), NOT an upstream blip, so it is tagged {@link SinkError}
 *  and rethrown: the mirror REJECTS (fail-fast), never a silent collapse to
 *  "nothing carried over". Named once so both collection bridges (`mirrorCollection`
 *  and `mirrorCollectionDeltas`) share the one sink-fold contract. */
function seedCarryOver<K>(initialKeys?: () => Iterable<K>): Set<K> {
  try {
    return new Set<K>(initialKeys?.() ?? []);
  } catch (sinkErr) {
    throw new SinkError(sinkErr);
  }
}

/** Subscribe a single `get(input)` stream and push each frame into `onFrame`,
 *  swallowing abort-time rejections (teardown) and logging any other UPSTREAM
 *  error. The shared loop behind cell, stream, and event sinks. A throw from
 *  `onFrame` (the caller's local fold) is NOT an upstream blip: it's wrapped in a
 *  `SinkError` and rethrown so the mirror rejects (fail-fast) rather than logging
 *  and swallowing a broken fold. */
async function subscribeStream(
  entry: EntryClient,
  input: unknown,
  onFrame: (frame: unknown) => void,
  signal: AbortSignal | undefined,
  log: (line: string) => void,
  label: string,
): Promise<void> {
  let iterable: AsyncIterable<unknown>;
  try {
    iterable = (await entry.get(input, { signal })) as AsyncIterable<unknown>;
  } catch (err) {
    if (isAbortReason(err, signal)) return;
    log(`${label}: ${(err as Error).message}`);
    return;
  }
  for await (const frame of guardUpstream(
    iterateUntilAborted(iterable, signal),
    log,
    label,
  )) {
    // Outside the upstream guard: a throw here is the sink's, not the stream's.
    try {
      onFrame(frame);
    } catch (err) {
      throw new SinkError(err);
    }
  }
}

/** Wrap an upstream async iterable so a non-abort iteration error is logged and
 *  ends the loop (the upstream-blip contract) instead of propagating — keeping
 *  upstream failures distinct from the sink failures the caller throws past it. */
async function* guardUpstream<T>(
  source: AsyncGenerator<T>,
  log: (line: string) => void,
  label: string,
): AsyncGenerator<T> {
  try {
    yield* source;
  } catch (err) {
    log(`${label}: ${(err as Error).message}`);
  }
}

/** The DELTAS protocol bridge — the private engine behind a `collections` sink
 *  for a collection that DECLARES the `deltas` verb (SR5 — one protocol across the
 *  wire). Consumes the collection's SINGLE batched snapshot-then-delta stream and
 *  folds each frame into the SAME `{ onUpsert, onRemove }` sink the per-key
 *  {@link mirrorCollection} feeds — so a re-serve's fold, a fleet board, or any
 *  consumer is oblivious to which protocol carried the collection.
 *
 *  - a `snapshot` frame (the first frame of every (re)subscribe) upserts every
 *    entry, then RECONCILES: any key present before this snapshot — carried over
 *    from a prior spawn via `initialKeys`, or held from this stream's own earlier
 *    deltas — that the snapshot does NOT re-assert has departed, and is removed
 *    (no ghost row; survivors are re-upserted, no empty flash). One deltas stream
 *    yields exactly one snapshot (its first frame), so this fires once per spawn.
 *  - a `delta` frame applies its `upserts` then its `removes` incrementally.
 *
 *  A throw from a sink callback (`onUpsert`/`onRemove`) or from `initialKeys` is a
 *  broken local fold, not an upstream blip: it is wrapped in a {@link SinkError}
 *  and rethrown so the mirror's `done` REJECTS (fail-fast), the identical contract
 *  the per-key path holds. Upstream (stream) errors and abort are handled by
 *  {@link guardUpstream}/{@link iterateUntilAborted} exactly as the shared
 *  {@link subscribeStream} loop does. */
async function mirrorCollectionDeltas<K, V>(opts: {
  label: string;
  log: (line: string) => void;
  signal: AbortSignal | undefined;
  deltas: Promise<AsyncIterable<CollectionDeltasMsg<K, V>>>;
  onUpsert: (key: K, value: V) => void;
  onRemove: (key: K) => void;
  /** Keys a prior spawn left in the caller's cross-reconnect cache. The FIRST
   *  snapshot reconciles them: any absent from it departed while the link was down
   *  and is removed; survivors are untouched. Omit on a first connect. */
  initialKeys?: () => Iterable<K>;
}): Promise<void> {
  // The keys currently mirrored — seeded with the carry-over cache so the first
  // snapshot prunes keys that departed while the link was down (#1661 candidate 1,
  // the deltas twin). See {@link seedCarryOver} for the sink-fold contract.
  let present = seedCarryOver(opts.initialKeys);
  let iterable: AsyncIterable<CollectionDeltasMsg<K, V>>;
  try {
    iterable = await opts.deltas;
  } catch (err) {
    if (isAbortReason(err, opts.signal)) return;
    opts.log(`${opts.label}: ${(err as Error).message}`);
    return;
  }
  for await (const msg of guardUpstream(
    iterateUntilAborted(iterable, opts.signal),
    opts.log,
    opts.label,
  )) {
    // Outside the upstream guard: a throw applying the frame to the sink is the
    // caller's broken fold, not the stream's — wrap it so the mirror rejects.
    try {
      if (msg.kind === "snapshot") {
        const next = new Set<K>();
        for (const [k, v] of msg.entries) {
          next.add(k);
          opts.onUpsert(k, v);
        }
        // Reconcile: a key present before this snapshot that it does not re-assert
        // has departed (carry-over pruning + a mid-life resubscribe never occurs on
        // one stream, so this is the fresh-spawn reconcile).
        for (const k of present) if (!next.has(k)) opts.onRemove(k);
        present = next;
      } else {
        for (const [k, v] of msg.upserts) {
          present.add(k);
          opts.onUpsert(k, v);
        }
        // `onRemove` fires only for a key we actually hold — a remove of an absent
        // key (a stale/duplicate delta after an internal stream retry re-leads with a
        // snapshot) is a true no-op, never a spurious departure re-emitted to the
        // sink. Matches the per-key path's `if (next.has(key)) continue` discipline.
        for (const k of msg.removes) {
          if (present.delete(k)) opts.onRemove(k);
        }
      }
    } catch (sinkErr) {
      throw new SinkError(sinkErr);
    }
  }
}

/** Generic per-key `Collection<K,V>` bridge — the private engine behind a
 *  `collections` sink (formerly the public `@kolu/surface-remote`
 *  `mirrorRemoteCollection`).
 *
 *  Subscribes to the collection's `keys` stream and, for each present key, opens
 *  a per-key `get(key)` stream whose every value flows to `onUpsert`. When a key
 *  leaves the `keys` snapshot its per-key stream is aborted and `onRemove` fires.
 *  Per-key streams stay open for the key's lifetime, so deltas flow without
 *  re-subscribing. Right for small N (4–32 keys); for bulk/high-churn a single
 *  discriminated-union snapshot stream (a `streams` sink) is the better fit — see
 *  the `remote-process-monitor` example, whose `cpuCores` uses this path and
 *  whose `processesSnapshot` uses a bulk stream. */
async function mirrorCollection<K, V>(opts: {
  label: string;
  log: (line: string) => void;
  signal: AbortSignal | undefined;
  keys: Promise<AsyncIterable<readonly K[]>>;
  get: (key: K, signal: AbortSignal) => Promise<AsyncIterable<V>>;
  onUpsert: (key: K, value: V) => void;
  onRemove: (key: K) => void;
  /** Keys a prior spawn left in the caller's cross-reconnect cache. On the FIRST
   *  `keys` frame, any absent from the fresh snapshot are removed (they departed
   *  while the link was down); survivors are untouched. Omit on a first connect. */
  initialKeys?: () => Iterable<K>;
}): Promise<void> {
  const open = new Map<K, AbortController>();
  // Keys carried over from a prior spawn (a re-serve's persistent cache). The FIRST
  // fresh `keys` frame reconciles them: any not re-asserted departed while the link
  // was down and must be pruned (a fresh mirror's `open` map starts empty, so the
  // departure sweep below — which only removes keys THIS spawn opened — can't catch
  // them). Reconciling on the fresh snapshot keeps survivors (no empty flash) and
  // drops ghosts (no stale row).
  // The carry-over seed runs synchronously at spawn, before the `rejectSink`
  // channel exists; a throw is a broken local fold, so {@link seedCarryOver} tags it
  // a `SinkError` and rethrows — the async `mirrorCollection` returns a rejected
  // promise, `Promise.allSettled` in the caller sees it, and `done` REJECTS: the
  // same fail-fast contract as a throwing `onUpsert`/`onRemove`.
  const carriedOver = seedCarryOver(opts.initialKeys);
  let reconciledCarryOver = false;
  // Thread the parent signal's reason into every per-key abort (with a fallback
  // for a mid-stream key departure, when the parent has NOT aborted) so the
  // per-key publisher rejects its pending pull with *this* reason — and the
  // whole file decides "is this the expected teardown rejection?" with the one
  // `isAbortReason` predicate the server layer advertises, instead of a weaker
  // string-compare that only matched because the reason was never set.
  const abortReason = (): unknown =>
    opts.signal?.reason ?? new DOMException("aborted", "AbortError");
  // A sink callback (`onUpsert`/`onRemove`) that throws is the caller's broken
  // fold, not an upstream blip — it must surface (fail-fast), not be logged and
  // swallowed. But the per-key value pumps run detached (fire-and-forget), so a
  // throw inside one can't reach this promise on its own; we route the FIRST sink
  // failure through `rejectSink`, race it against the keys loop, and rethrow it as
  // a `SinkError` so the top-level fold rejects the whole mirror.
  let rejectSink!: (err: unknown) => void;
  const sinkFailed = new Promise<never>((_, reject) => {
    rejectSink = reject;
  });
  // Don't crash on an unobserved rejection if the keys loop wins the race first.
  sinkFailed.catch(() => {});
  // OWN the per-key value pumps (#1719). Each pump runs detached so a sink throw
  // routes through `rejectSink` rather than this promise — but "detached" must NOT
  // mean "abandoned": every pump is tracked here and AWAITED in the `finally` below
  // before `mirrorCollection` (and thus the mirror's `done`) resolves. Without this,
  // `done` could resolve — and `pumpRemoteSurface` advance to the next spawn — while a
  // pump's `.next()` was still parked against the closing peer, so the pull rejected
  // with no awaiter left and floated (the padi reconnect flake). Each pump's own
  // `try/catch` still settles it (it never rejects THIS promise), so tracking is pure
  // ownership: the settle is observed, never awaited-into-a-throw.
  const pumps = new Set<Promise<void>>();
  const track = (pump: Promise<void>): void => {
    pumps.add(pump);
    void pump.finally(() => pumps.delete(pump));
  };
  const keysLoop = (async (): Promise<void> => {
    try {
      for await (const keys of iterateUntilAborted(
        await opts.keys,
        opts.signal,
      )) {
        const next = new Set(keys);
        for (const key of next) {
          if (open.has(key)) continue;
          const ctl = new AbortController();
          open.set(key, ctl);
          track(
            (async () => {
              try {
                const stream = await opts.get(key, ctl.signal);
                for await (const value of stream) {
                  if (ctl.signal.aborted) break;
                  // The sink call is OUTSIDE the upstream try below: a throw here is
                  // the caller's, surfaced via `rejectSink`, not logged as a blip.
                  try {
                    opts.onUpsert(key, value);
                  } catch (sinkErr) {
                    rejectSink(new SinkError(sinkErr));
                    return;
                  }
                }
              } catch (err) {
                if (!isAbortReason(err, ctl.signal)) {
                  opts.log(
                    `${opts.label}: per-key stream error for ${String(key)}: ${(err as Error).message}`,
                  );
                }
              }
            })(),
          );
        }
        for (const [key, ctl] of [...open]) {
          if (next.has(key)) continue;
          ctl.abort(abortReason());
          open.delete(key);
          try {
            opts.onRemove(key);
          } catch (sinkErr) {
            // The SAME sink-failure channel as onUpsert above: route through
            // `rejectSink` and stop the loop, so there's one "sink threw → fail
            // the mirror" path, not a second `throw`/re-throw spelling. Returning
            // ends the keys loop exactly as the old `throw` did; `sinkFailed`
            // then wins the race and the top-level fold rethrows the cause.
            rejectSink(new SinkError(sinkErr));
            return;
          }
        }
        // First fresh snapshot of THIS spawn: reconcile the carry-over cache once.
        // A carried-over key the snapshot does NOT re-assert departed during the
        // link outage — prune it through `onRemove` (the wrapped publish path) so
        // an already-subscribed downstream sees the departure, not just a silent
        // cache mutation. Fires once (later frames belong to the departure sweep
        // above), and only for keys THIS spawn didn't re-open.
        if (!reconciledCarryOver) {
          reconciledCarryOver = true;
          for (const key of carriedOver) {
            if (next.has(key)) continue;
            try {
              opts.onRemove(key);
            } catch (sinkErr) {
              rejectSink(new SinkError(sinkErr));
              return;
            }
          }
        }
      }
    } catch (err) {
      // Only upstream (keys-stream) failures reach here now — every sink failure
      // goes through `rejectSink` above, so there's no `SinkError` to re-throw.
      if (!isAbortReason(err, opts.signal)) {
        opts.log(`${opts.label}: keys stream error: ${(err as Error).message}`);
      }
    }
  })();
  try {
    await Promise.race([keysLoop, sinkFailed]);
  } finally {
    // Abort every open pump's ctl FIRST — so a still-parked pull rejects with
    // `ctl.signal.reason` (the `isAbortReason` swallow), not an orpc AbortError —
    // THEN await the tracked pumps so `mirrorCollection` does not resolve while any
    // pump is still settling (#1719 ownership; the settle is observed regardless of
    // whether the peer or this `finally` closed first). `allSettled` because each
    // pump owns its own outcome via its internal try/catch — a pump never rejects
    // this promise; we only wait for it to FINISH.
    for (const ctl of open.values()) ctl.abort(abortReason());
    await Promise.allSettled([...pumps]);
  }
}
