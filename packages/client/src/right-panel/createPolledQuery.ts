/**
 * `createPolledQuery` — the CLIENT half of pulse-then-requery.
 *
 * The Code tab used to read fs/git state off `koluSurface`'s value-bearing
 * streams (`app.streams.gitStatus.use(...)` etc.): the server pushed the whole
 * status / diff / file-list / file-content on every change. `padiSurface`
 * splits that in two — a value-bearing PULSE stream that carries only a `{seq}`
 * distinguisher (`subscribeRepoChange` / `subscribeFileChange`), and a
 * request/response PROCEDURE that returns the data (`git.getStatus`,
 * `fs.listAll`, …). This helper stitches them back into the SAME reactive shape
 * a stream `.use(...)` exposed, so the Code tab's consumers change minimally.
 *
 * Behaviour, per the W1.R4 plan (push → pulse-then-requery, UX byte-identical
 * bar imperceptible extra latency):
 *
 *   - subscribe the padi pulse stream keyed off the query input (idle — no
 *     subscription, no query — when the input is `null`, exactly like
 *     `.use(() => cond ? input : null)`);
 *   - REQUERY the procedure on EVERY pulse frame the stream yields. `rawStream`
 *     calls `onItem` per frame with NO reconcile dedup, so this covers the
 *     initial snapshot frame (the first read), each on-disk change, AND the
 *     fresh snapshot frame a `STREAM_RETRY` reconnect re-subscribe yields — even
 *     when its `{seq}` restarts at a value the last frame already had (which a
 *     reconciled `.use()` would silently swallow). That is the value stream's
 *     reconnect-refresh, preserved without a skip-the-first-frame dance;
 *   - a requery updates the value IN PLACE (no blank), so a change never flashes
 *     the tree empty. Only an INPUT change blanks + goes `pending` (the prior
 *     value is no longer authoritative) — the transient the #818 pending-gate
 *     is written against.
 *
 * The returned handle is a `Subscription<Result>` — a callable accessor with
 * `.pending` / `.error` — identical to what `app.streams.X.use(...)` returned,
 * so `q()`, `q.pending()`, `q.error()` all read verbatim downstream.
 */

import type { PadiSurfaceSpec } from "@kolu/padi/surface";
import type {
  StreamingProcedure,
  Subscription,
  SurfaceClient,
} from "@kolu/surface/solid";
import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from "solid-js";
import { createStore, reconcile, type SetStoreFunction } from "solid-js/store";
import { activeBinding, activeHost } from "../binding/bindings";

export interface PolledQueryConfig<Input, PulseInput, Pulse, Result> {
  /** The query input; `null` = idle (no pulse subscription, no query). */
  input: Accessor<Input | null>;
  /** Health-registry label for the pulse subscription. */
  pulseName: string;
  /** Select the raw pulse streaming procedure from the ACTIVE host's padi client
   *  (`(padi) => padiRpc(padi).surface.<pulse>.get`). Re-resolved on every host
   *  switch — the pulse subscription follows the tab to the new host rather than
   *  pinning the mount-time binding (B1/B2, the #1687 stale-binding class). */
  pulse: (
    padi: SurfaceClient<PadiSurfaceSpec>,
  ) => StreamingProcedure<PulseInput, Pulse>;
  /** Derive the pulse key from the query input. Kept separate so the pulse
   *  subscribes to only the change signal it needs (a repo, or a repo+file). */
  pulseInput: (input: Input) => PulseInput;
  /** (Re)invoke the padi procedure on each pulse frame. The `signal` aborts a
   *  superseded in-flight read (input change / a newer pulse). */
  query: (input: Input, signal: AbortSignal) => Promise<Result>;
  /** Surface query (and pulse) failures — matches `.use(..., { onError })`. */
  onError?: (err: Error) => void;
  /** Classify an error as a BENIGN TRANSIENT to swallow (no `error()`, no
   *  `onError`, value left as-is), like the reconnect-window swallow. The old
   *  koluSurface value stream simply stopped yielding when the viewed file was
   *  deleted mid-poll — it never surfaced an error; `BrowseFileDispatcher` passes
   *  a file-gone predicate here so a delete-while-viewing keeps the last content
   *  until the selection changes, instead of flashing an ENOENT panel. */
  swallowError?: (err: Error) => boolean;
}

/** Reconcile-or-assign into the wrapped `{ v }` store — objects/arrays through
 *  `reconcile` for fine-grained reactivity + stable references (the treePaths
 *  memo relies on this), primitives by direct assignment. Mirrors the
 *  framework's private `writeWrappedValue`. */
function writeValue<T>(
  setStore: SetStoreFunction<{ v: T | undefined }>,
  next: T,
): void {
  if (next !== null && typeof next === "object") {
    setStore(
      "v",
      reconcile(next as Record<string, unknown>) as unknown as T | undefined,
    );
  } else {
    setStore("v", next);
  }
}

export function createPolledQuery<Input, PulseInput, Pulse, Result>(
  config: PolledQueryConfig<Input, PulseInput, Pulse, Result>,
): Subscription<Result> {
  const { input, pulseName, pulse, pulseInput, query, onError, swallowError } =
    config;

  const [store, setStore] = createStore<{ v: Result | undefined }>({
    v: undefined,
  });
  const [pending, setPending] = createSignal(true);
  const [error, setError] = createSignal<Error | undefined>();

  /** The ONE error sink for BOTH channels — the requery AND the pulse stream.
   *  Routing the pulse (watcher-install) failure here, not to a separate
   *  `onError`-only path, is the fix for the disjoint-channels bug: a persistent
   *  watcher failure (inotify ENOSPC) now sets `error()` + clears `pending()` so
   *  the Code tab shows a real error and un-sticks a pre-first-frame "Loading…",
   *  exactly as the old value stream did — the 4s toast alone left stale state
   *  forever. The two guards below are the two benign-transient carve-outs; a
   *  survivor sets `error()`, whose rising EDGE drives the single `onError`
   *  below, so the panel and the toast can never disagree. */
  function surfaceError(raw: unknown): void {
    const err = raw instanceof Error ? raw : new Error(String(raw));
    // Reconnect-window blip: `rawStream`'s STREAM_RETRY re-subscribes and the
    // pulse re-fires `{seq:0}`, so a genuine persistent failure re-surfaces on
    // the next LIVE read — swallow here to keep a spurious flash off reconnect.
    // Read the ACTIVE binding's health (the pulse rides the active host's client).
    if (!activeBinding().clients.padi.health().live) return;
    // Caller-classified benign transient (e.g. the viewed file was deleted).
    if (swallowError?.(err)) return;
    setError(err);
    if (pending()) setPending(false);
  }

  let controller: AbortController | null = null;
  function runQuery(i: Input): void {
    controller?.abort();
    const ctl = new AbortController();
    controller = ctl;
    void (async () => {
      try {
        const result = await query(i, ctl.signal);
        if (ctl.signal.aborted) return;
        writeValue<Result>(setStore, result);
        if (pending()) setPending(false);
        if (error()) setError(undefined);
      } catch (err) {
        if (ctl.signal.aborted) return;
        surfaceError(err);
      }
    })();
  }
  onCleanup(() => controller?.abort());

  createEffect(
    // Keyed on `input` AND `activeHost` (W4): a host switch re-runs this effect,
    // disposing the old host's pulse subscription and re-opening it against the
    // new host's client — the pulse follows the tab instead of pinning the
    // mount-time binding (B1/B2). A switch blanks + goes pending like an input
    // change, then the new host's first pulse frame requeries — correct.
    on([input, activeHost], ([i]) => {
      // Reset for the new input/host: blank + pending until the fresh read lands,
      // and abort any in-flight read from the prior input. `rawStream`'s own
      // onCleanup (registered on this effect's run) tears down the previous
      // pulse subscription before this re-run.
      controller?.abort();
      controller = null;
      setStore("v", undefined);
      setError(undefined);
      setPending(true);
      if (i === null) return;
      // Resolve the pulse client + procedure from the ACTIVE binding (never a
      // captured mount-time reference). `rawStream` runs inside this effect's
      // reactive owner (required) and auto-disposes on the next input/host change;
      // `onItem` fires per pulse frame, each one a requery of the padi procedure.
      const padi = activeBinding().clients.padi;
      const pulseSource = padi.rawStream(
        pulseName,
        pulse(padi),
        pulseInput(i),
        {
          onItem: () => runQuery(i),
        },
      );
      // A pulse (watcher-install) failure routes into the SAME error/pending
      // signals the requery does (via `surfaceError`) — NOT a bespoke
      // `onError`-only path — so a persistent watcher failure surfaces a real
      // error state, not just a transient toast over stale data. Scoped to this
      // run so it re-arms per input.
      createEffect(
        on(
          () => pulseSource.error(),
          (err) => {
            if (err) surfaceError(err);
          },
        ),
      );
    }),
  );

  const sub = Object.assign(() => store.v, {
    error,
    pending,
  }) as Subscription<Result>;

  // Drive `onError` off the self-clearing `error()` EDGE (as `createSubscription`
  // does), so a transient blip fires once per rising transition and clears with
  // the signal — the two error channels can't disagree.
  if (onError) {
    createEffect(
      on(
        () => sub.error(),
        (err) => {
          if (err) onError(err);
        },
      ),
    );
  }

  return sub;
}
