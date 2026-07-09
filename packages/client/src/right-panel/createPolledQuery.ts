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

import { unenrolledStreamCall } from "@kolu/surface/client";
import {
  type StreamingProcedure,
  type Subscription,
  wireSubscriptionError,
  writeWrappedValue,
} from "@kolu/surface/solid";
import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from "solid-js";
import { createStore } from "solid-js/store";

export interface PolledQueryConfig<Input, PulseInput, Pulse, Result> {
  /** The query input; `null` = idle (no pulse subscription, no query). */
  input: Accessor<Input | null>;
  /** The active host's transport liveness (`() => padiMap.live()`) — gates the
   *  reconnect-window error swallow (a blip while the socket re-subscribes). Replaces
   *  the old whole-client `health().live` (the map has no single per-host client). */
  live: Accessor<boolean>;
  /** The pulse streaming procedure as a FACTORY re-derived at each (re)subscribe —
   *  `() => padiRpcOf(activeHost()).surface.<pulse>.get`. A factory, not a pre-bound proc, so
   *  the live-refresh watcher follows the ACTIVE host: the effect re-runs on a host switch
   *  (via `pulseHost` below) and re-reads `activeHost()`, rebinding the pulse to the new host.
   *  A pre-bound proc pins the pulse to the MOUNT-TIME host forever (the boot-host-capture
   *  hazard — CodeTab mounts once), so a switched-to host's repo silently stops live-updating. */
  pulseProc: () => StreamingProcedure<PulseInput, Pulse>;
  /** The reactive host the pulse follows (`activeHost`). Folded into the effect's
   *  re-subscribe trigger so a BARE host switch (the same `input`/repoPath present on two
   *  hosts) still tears down the old host's pulse and opens the new host's — the common case
   *  (a switch changes the active terminal → `input`) is covered by `input` alone; this closes
   *  the identical-repoPath edge. */
  pulseHost?: Accessor<unknown>;
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

export function createPolledQuery<Input, PulseInput, Pulse, Result>(
  config: PolledQueryConfig<Input, PulseInput, Pulse, Result>,
): Subscription<Result> {
  const {
    input,
    live,
    pulseProc,
    pulseHost,
    pulseInput,
    query,
    onError,
    swallowError,
  } = config;

  const [store, setStore] = createStore<{ v: Result | undefined }>({
    v: undefined,
  });
  const [pending, setPending] = createSignal(true);
  const [error, setError] = createSignal<Error | undefined>();
  // Mirrors `createSubscription`'s typed-end fact: latches true once the PULSE
  // stream (the thing that would ever tell this query to requery again) ends
  // normally — never on abort (an input change / teardown). Without it, this
  // hand-rolled `Subscription` silently dropped the field a real one always
  // populates, and a consumer that checks `.complete?.()` (same as any other
  // stream-backed subscription) would see "not complete" forever even after the
  // pulse genuinely stopped.
  const [complete, setComplete] = createSignal(false);

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
    if (!live()) return;
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
        writeWrappedValue<Result>(setStore, result);
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
    on(
      // Track BOTH the query input and the active host, so the pulse re-subscribes on a
      // host switch even when the input (repoPath) is unchanged across the two hosts.
      () => ({ i: input(), host: pulseHost?.() }),
      ({ i }) => {
        // Reset for the new input: blank + pending until the fresh read lands, and
        // abort any in-flight read from the prior input. `rawStream`'s own
        // onCleanup (registered on this effect's run) tears down the previous
        // pulse subscription before this re-run.
        controller?.abort();
        controller = null;
        setStore("v", undefined);
        setError(undefined);
        setPending(true);
        setComplete(false);
        if (i === null) return;
        // The pulse: an UNENROLLED STREAM_RETRY stream over the active host's link
        // (`padiRpcOf(activeHost()).surface.<pulse>.get`). Each frame requeries; the
        // stream re-subscribes transparently on reconnect (STREAM_RETRY) and re-yields its
        // snapshot frame, so `runQuery` fires per frame INCLUDING each post-reconnect
        // snapshot — the value stream's reconnect-refresh, preserved. It aborts on the next
        // input change (this effect's `onCleanup`). A pulse failure routes into the SAME
        // error/pending signals the requery does (via `surfaceError`), so a persistent
        // watcher failure (inotify ENOSPC) surfaces a real error state, not just a toast.
        // It is UNENROLLED (not the old whole-client `rawStream`) because the map has no
        // single per-host client to fold health into — and kolu ignores that fold anyway.
        const pulseCtl = new AbortController();
        onCleanup(() => pulseCtl.abort());
        void (async () => {
          try {
            for await (const _frame of await unenrolledStreamCall(
              pulseProc(),
              pulseInput(i),
              { signal: pulseCtl.signal },
            )) {
              runQuery(i);
            }
            // Normal completion — the pulse iterable ended on its own (a typed end,
            // e.g. the host/entry left membership), not an abort: an aborted loop
            // never falls through the `for await` to here with `aborted` still
            // false. Mirrors `createSubscription`'s own typed-end handling.
            if (!pulseCtl.signal.aborted) setComplete(true);
          } catch (err) {
            if (!pulseCtl.signal.aborted) surfaceError(err);
          }
        })();
      },
    ),
  );

  const sub = Object.assign(() => store.v, {
    error,
    pending,
    complete,
  }) as Subscription<Result>;

  // Drive `onError` off the self-clearing `error()` EDGE via the shared
  // `@kolu/surface/solid` helper (the exact wiring `createSubscription` itself
  // uses internally) — not a hand-rolled copy — so a transient blip fires once
  // per rising transition and clears with the signal, and this file can't drift
  // from the framework's one edge-wiring implementation.
  if (onError) wireSubscriptionError(sub, onError);

  return sub;
}
