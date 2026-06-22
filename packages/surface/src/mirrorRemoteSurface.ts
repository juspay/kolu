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
 * `arivu-tui` fleet board keys every host's terminals into one `(host, id)` Solid
 * store; kolu's R-2 fold is intended to merge each awareness upsert into its own
 * co-owned `terminalMetadata` (a planned/drishti consumer, not yet wired in this
 * repo). So the sink is per-primitive *callbacks*, never a fixed local ctx —
 * interception is the common case, not the exception.
 *
 * Teardown is the load-bearing detail, shared with `projectSurface`: every
 * subscription threads the caller's `signal` into its client call and wraps the
 * iterator with `iterateUntilAborted`, so an abort-time rejection (the publisher
 * rejects pending pulls with `signal.reason` on shutdown) ends the loop cleanly
 * rather than surfacing as an unhandled rejection. `mirrorRemoteSurface` resolves
 * when every subscription has settled — which over one shared link means the link
 * closed (or the caller aborted): the cue a consumer flips to "unreachable" on.
 */

import type { Surface, SurfaceSpec, SurfaceTypes } from "./define";
import type { SurfaceClientLike } from "./project";
import { isAbortReason, iterateUntilAborted } from "./server";

// ── SurfaceSink — the consume-side algebra ──────────────────────────────

/** Per-primitive consumers for `mirrorRemoteSurface`, typed off the source
 *  surface's spec `S`. Every entry is optional: a primitive is subscribed iff a
 *  sink is supplied, so a consumer that only wants the `awareness` collection (the
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
    throw new Error(
      `mirrorRemoteSurface: a sink was supplied for ${kind} "${key}" but the client has no such entry — wrong or incompatible client (client/surface mismatch).`,
    );
  }
  return entry;
}

// ── mirrorRemoteSurface ──────────────────────────────────────────────────

/** Mirror every primitive of `source` that `sink` opts into, by subscribing
 *  through `client` and pushing frames into the matching sink callback. Resolves
 *  when all subscriptions settle (link closed / aborted). Callers pass the result
 *  of `surfaceClientRef(source, router)` or any `SurfaceClientOf<S>` for `client`;
 *  it is read structurally here.
 *
 *      await mirrorRemoteSurface(terminalWorkspaceSurface, client, {
 *        cells: { version: (v) => setSkew(!isContractVersionCompatible(v.contractVersion, OURS)) },
 *        collections: { awareness: { upsert, remove } },
 *        streams: { activity: { input: {}, onFrame: (live) => setLive(live) } },
 *      }, { signal, log });
 */
export function mirrorRemoteSurface<S extends SurfaceSpec>(
  source: Surface<S>,
  client: SurfaceClientLike,
  sink: SurfaceSink<S>,
  opts: MirrorRemoteSurfaceOptions = {},
): Promise<void> {
  const { signal } = opts;
  const log = opts.log ?? (() => {});
  const ns = client.surface as Record<string, EntryClient>;
  const spec = source.spec;
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
  // "returns `Promise<void>`, all failures are rejections" — and a caller may fire
  // it `void`-style (the daemon does), where a sync throw would crash inline
  // rather than surface as a rejection it can flip a host on. So validation runs
  // inside a try and any throw becomes a rejected promise — crucially, BEFORE any
  // `start` closure has run, so no subscription is left orphaned by the throw.
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

    // Collections: discover keys from the `keys` stream, hold a per-key value
    // stream open for each present key, and remove departed keys.
    for (const key of Object.keys(spec.collections ?? {})) {
      const colSink = collSinks?.[key];
      if (!colSink) continue;
      const entry = requireEntry(ns, key, "collection");
      // A collection MUST expose `keys` — a `get`-only entry can't be a collection.
      if (!entry.keys) {
        throw new Error(
          `mirrorRemoteSurface: client entry "${key}" is missing the "keys" verb — it cannot serve the "${key}" collection (client/surface mismatch).`,
        );
      }
      const keysFn = entry.keys;
      starts.push(() =>
        mirrorCollection({
          label: `${key} collection`,
          log,
          signal,
          keys: keysFn({}, { signal }),
          get: (k, s) =>
            entry.get({ key: k }, { signal: s }) as Promise<
              AsyncIterable<unknown>
            >,
          onUpsert: colSink.upsert,
          onRemove: colSink.remove,
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
    // has run yet) — nothing to unwind, just reject.
    return Promise.reject(err);
  }

  // PASS 2 — validation passed, so start every staged subscription.
  const tasks = starts.map((start) => start());

  // Resolve when every subscription has settled. Over one shared link that means
  // the link closed (or `signal` aborted) — the cue a consumer flips a host to
  // "unreachable" on. `allSettled`, not `all`: one primitive's *upstream* stream
  // error must not reject the whole mirror (it's already logged), and teardown is
  // uniform. But a *sink* failure is NOT an upstream blip — it's a bug in the
  // caller's local fold, and the no-fallback rule (`caught-error-must-not-
  // collapse-to-empty`) says it must surface, not be logged and swallowed: a task
  // tags such a rejection with `SinkError`, and the first one rethrows here so the
  // mirror rejects rather than quietly resolving on a broken fold.
  return Promise.allSettled(tasks).then((results) => {
    for (const r of results) {
      if (r.status === "rejected" && r.reason instanceof SinkError) {
        throw r.reason.cause;
      }
    }
  });
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

/** Generic per-key `Collection<K,V>` bridge — the private engine behind a
 *  `collections` sink (formerly the public `@kolu/surface-nix-host`
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
}): Promise<void> {
  const open = new Map<K, AbortController>();
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
          void (async () => {
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
          })();
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
    for (const ctl of open.values()) ctl.abort(abortReason());
  }
}
