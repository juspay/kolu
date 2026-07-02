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

export interface PolledQueryConfig<Input, PulseInput, Pulse, Result> {
  /** The query input; `null` = idle (no pulse subscription, no query). */
  input: Accessor<Input | null>;
  /** The padi surface client (`padi` from `wire.ts`) — its `.rawStream` drives
   *  the pulse subscription and enrols it into padi's `health()`. */
  client: SurfaceClient<PadiSurfaceSpec>;
  /** Health-registry label for the pulse subscription. */
  pulseName: string;
  /** The raw pulse streaming procedure — `padiRpc(padi).surface.<pulse>.get`. */
  pulseProc: StreamingProcedure<PulseInput, Pulse>;
  /** Derive the pulse key from the query input. Kept separate so the pulse
   *  subscribes to only the change signal it needs (a repo, or a repo+file). */
  pulseInput: (input: Input) => PulseInput;
  /** (Re)invoke the padi procedure on each pulse frame. The `signal` aborts a
   *  superseded in-flight read (input change / a newer pulse). */
  query: (input: Input, signal: AbortSignal) => Promise<Result>;
  /** Surface query (and pulse) failures — matches `.use(..., { onError })`. */
  onError?: (err: Error) => void;
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
  const { input, client, pulseName, pulseProc, pulseInput, query, onError } =
    config;

  const [store, setStore] = createStore<{ v: Result | undefined }>({
    v: undefined,
  });
  const [pending, setPending] = createSignal(true);
  const [error, setError] = createSignal<Error | undefined>();

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
        // A query in flight when the socket drops rejects. The value stream this
        // replaces rode STREAM_RETRY, which SWALLOWED that reconnect blip (no
        // error ever surfaced). Match it: while the transport is not live, treat
        // a query failure as a transient reconnect-window artifact, not a real
        // error — the pulse re-fires `{seq:0}` on reconnect and requeries, so a
        // genuine (persistent) failure re-surfaces on the next LIVE read. Only
        // surfacing errors while live keeps a spurious toast from flashing on
        // reconnect (byte-identical to the old always-STREAM behaviour).
        if (!client.health().live) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        if (pending()) setPending(false);
      }
    })();
  }
  onCleanup(() => controller?.abort());

  createEffect(
    on(input, (i) => {
      // Reset for the new input: blank + pending until the fresh read lands, and
      // abort any in-flight read from the prior input. `rawStream`'s own
      // onCleanup (registered on this effect's run) tears down the previous
      // pulse subscription before this re-run.
      controller?.abort();
      controller = null;
      setStore("v", undefined);
      setError(undefined);
      setPending(true);
      if (i === null) return;
      // `rawStream` runs inside this effect's reactive owner (required) and
      // auto-disposes on the next input change; `onItem` fires per pulse frame,
      // each one a requery of the padi procedure.
      const pulseSource = client.rawStream(
        pulseName,
        pulseProc,
        pulseInput(i),
        {
          onItem: () => runQuery(i),
        },
      );
      // A pulse (watcher-install) failure surfaces through the same `onError` a
      // stream drop did; scoped to this run so it re-arms per input.
      if (onError) {
        createEffect(
          on(
            () => pulseSource.error(),
            (err) => {
              if (err) onError(err);
            },
          ),
        );
      }
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
