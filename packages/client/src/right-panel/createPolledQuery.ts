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
 *     the tree empty. Only an (INPUT-VALUE, HOST) pair change blanks + goes
 *     `pending` (the prior value is no longer authoritative) — the transient the
 *     #818 pending-gate is written against; a bare host switch on the same
 *     input value blanks too (see `pulseHost` above). This is ENFORCED (not
 *     convention): the re-subscribe effect keys on a value-deduped
 *     (input, host) key, so a fresh-reference-but-equal-value input on the same
 *     host never blanks (a #1714-class trap, armed since #1652, closed here).
 *
 * The returned handle is a `Subscription<Result>` — a callable accessor with
 * `.pending` / `.error` — identical to what `app.streams.X.use(...)` returned,
 * so `q()`, `q.pending()`, `q.error()` all read verbatim downstream.
 *
 * The blank-on-host-switch above is the STANDALONE behavior (`active` defaults to
 * always-on). For the Code tab, `hostCodeTab` instead builds ONE instance per host
 * inside its `scopedByEntry` owner and wires the `active` gate, so a host switch
 * PAUSES the leaving host's query (value held) and RESUMES the arriving host's from its
 * retained value with no blank — padi W9's instant switch-back, by ownership. See the
 * `active` config field.
 */

import type { Effect } from "effect";
import { pollOnChange } from "@kolu/surface/poll-on-change";
import {
  type StreamingProcedure,
  type Subscription,
  wireSubscriptionError,
  writeWrappedValue,
} from "@kolu/surface/solid";
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
} from "solid-js";
import { createStore } from "solid-js/store";
import { runActionPromise } from "../runAction";

export interface PolledQueryConfig<Input, PulseInput, Pulse, Result> {
  /** The query input; `null` = idle (no pulse subscription, no query). */
  input: Accessor<Input | null>;
  /** The active host's transport liveness (`() => padiMap.live()`) — gates the
   *  reconnect-window error swallow (a blip while the socket re-subscribes). Replaces
   *  the old whole-client `health().live` (the map has no single per-host client). */
  live: Accessor<boolean>;
  /** The pulse streaming procedure as a FACTORY re-derived at each (re)subscribe —
   *  `() => activePadiStreams.<pulse>.unenrolled`. A factory, not a pre-bound proc, so
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
  /** (Re)invoke the padi procedure on each pulse frame — a DESCRIPTION, so a
   *  superseded read is torn down by interrupting its fiber rather than by a
   *  signal the caller had to remember to thread. `pollOnChange`'s own read seam
   *  stays `(signal) => Promise<T>` (locked decision 1 — it has non-Effect
   *  consumers), so the bridge is here, at one call site: the pulse's
   *  `AbortSignal` drives the run's interruption. */
  query: (input: Input) => Effect.Effect<Result, unknown>;
  /** Surface query (and pulse) failures — matches `.use(..., { onError })`. */
  onError?: (err: Error) => void;
  /** Classify an error as a BENIGN TRANSIENT to swallow (no `error()`, no
   *  `onError`, value left as-is), like the reconnect-window swallow. The old
   *  koluSurface value stream simply stopped yielding when the viewed file was
   *  deleted mid-poll — it never surfaced an error; `BrowseFileDispatcher` passes
   *  a file-gone predicate here so a delete-while-viewing keeps the last content
   *  until the selection changes, instead of flashing an ENOENT panel. */
  swallowError?: (err: Error) => boolean;
  /** Whether this query is the SHOWN one — its polling gate. Defaults to always-on
   *  (`() => true`), the standalone behavior. While `false` the query PAUSES: the pulse
   *  is torn down (no background polling) and the last value + `pending` are FROZEN. On
   *  re-activation it RESUMES: an unchanged input keeps the held value (no blank) and
   *  the pulse refreshes it; a changed input blanks + re-queries like any new input.
   *  A key change WHILE active is unaffected (the `#1714` value-keyed blank is unchanged).
   *  `hostCodeTab` wires this to `ctx.isActive` for per-host switch-back by ownership —
   *  see its header for the why. */
  active?: Accessor<boolean>;
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
    active = () => true,
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

  // The input key the value currently in `store.v` corresponds to — `null` while
  // blank. The resume decision reads it: on re-activation, an unchanged key means the
  // held value is still the answer (keep it, refresh), a changed key means a new query
  // (blank). One value per instance (NOT a cache/LRU) — the instance IS a single host's
  // query, so it only ever holds that host's one current value.
  let shownKey: string | null = null;

  /** Reset to the empty/loading state: no value, `pending`, no shown key. The idle
   *  input and the changed-query paths below share it. */
  function blank(): void {
    setStore("v", undefined);
    setPending(true);
    shownKey = null;
  }

  // The requery-per-pulse-frame loop (subscribe pulse → requery → emit, with
  // abort-supersede) is the framework-free `pollOnChange` core in `@kolu/surface`;
  // this file keeps only the Solid ergonomics that wrap it — the reconciled store
  // write, the `pending`/`error` signals, `shownKey`, and the #818/#1714 guard.
  // The core's in-flight requery is torn down through the pulse `signal` below
  // (aborted by the effect's `onCleanup` on every re-run and on owner dispose).

  // The input's VALUE identity — a canonical primitive key over (input, host).
  // `on` fires its callback on every INVALIDATION of its tracked source, not on a
  // value change; the pre-fix deps `() => ({ i: input(), host })` returned a fresh
  // object each eval, so ANY incidental invalidation of `input`'s dependencies
  // (e.g. an upstream metadata reference tick) re-ran the blank + pulse
  // re-subscribe below even when repoPath/host were unchanged — the header's
  // "Only an INPUT change blanks" was unenforced convention (armed since #1652).
  // Keying the effect on this value-deduped memo enforces that contract: a
  // fresh-reference-but-equal-value input re-issues NOTHING, and the effect runs
  // only when the input VALUE or host actually changed. This is the consumer's
  // own reset semantics ("blank iff MY input changed"), NOT a second dedup gate on
  // the producer. The carried `i` rides along so the body keeps the live input
  // object for `pulseInput(i)` / `runQuery(i)`.
  const inputState = createMemo(
    () => {
      const i = input();
      const host = pulseHost?.();
      return { i, key: i === null ? null : JSON.stringify([i, host ?? null]) };
    },
    undefined,
    { equals: (a, b) => a.key === b.key },
  );

  createEffect(
    on([active, inputState], ([isActive, { i, key }]) => {
      // The previous run's `onCleanup` (pulse abort) has already run. While PAUSED
      // (this host is not the shown one), the pulse is torn down — no background
      // polling — and the held value + `pending` + `shownKey` are FROZEN for a later
      // resume. Do NOT blank; a switch-BACK must find the value here.
      // (The effect still re-runs when the ACTIVE host's `input` ticks while we are
      // paused, since `input` reads shared state; each such run is this same no-op.)
      if (!isActive) {
        // The previous run's pulse `onCleanup` (below) has already fired, aborting its
        // `pollOnChange` signal — which tears down BOTH the pulse AND any in-flight
        // requery the core dispatched. That matters: a requery already dispatched would
        // otherwise land AFTER the switch and write THIS now-background host's retained
        // store off the NOW-active host's reactive reads (e.g. `BrowseFileDispatcher`'s
        // binary branch builds its URL from `activeHost()` AFTER its `filePreviewTag`
        // await — a cross-host mix). The held value + `pending` + `shownKey` stay frozen
        // for the switch-BACK, so no blank and no late write. Nothing to do but hold.
        return;
      }

      // ACTIVE. The resume/blank decision is "does `store.v` already hold THIS key?".
      // (The previous run's pulse `onCleanup` already aborted its `pollOnChange` — pulse
      // + in-flight requery — so a stale read can't land over this run.)
      setError(undefined);
      setComplete(false);
      if (i === null) {
        // Idle input: no pulse, no query. (`key` is null exactly when `i` is.)
        blank();
        return;
      }
      // `key` is non-null exactly when `i` is (both derive from `input()` in
      // `inputState`), so past the guard above it is the canonical string to compare
      // against `shownKey` and stamp this run's value under.
      const activeKey = key as string;
      // A changed query BLANKS — a real input change while active, the first activation,
      // or the query changed while paused — going `pending` until the fresh read lands
      // (the `#1714` active-path behavior, unchanged). An UNCHANGED key is the switch-BACK
      // case: fall through with the held value kept (no blank, not `pending`), refreshed by
      // the pulse below on its first frame (the immediate refresh on activation).
      if (activeKey !== shownKey) blank();
      // The pulse: an UNENROLLED STREAM_RETRY stream over the active host's link
      // (`activePadiStreams.<pulse>.unenrolled`). Each frame requeries; the
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
      // The framework-free `pollOnChange` core owns the loop (subscribe pulse →
      // requery per frame → abort-supersede → emit); this file supplies the query
      // and the Solid landing. The `pulseCtl` signal owns the whole poll's lifetime
      // — the effect's `onCleanup` aborts it on every re-run and on owner dispose,
      // tearing down the pulse AND the in-flight requery.
      pollOnChange<PulseInput, Pulse, Result>({
        pulse: pulseProc(),
        pulseInput: pulseInput(i),
        // THE bridge: the core hands a signal, the read is an Effect, and
        // `runActionPromise` makes the one drive the other — a superseded frame
        // really interrupts its in-flight read (running its finalizers) instead
        // of leaving a promise nobody awaits. Mirror image of the surface side's
        // `connectPollNode`, where an Effect's interruption drives a controller.
        query: (signal) => runActionPromise(query(i), signal),
        onResult: (result) => {
          // A requery updates the value IN PLACE (reconciled — no blank), stamps the
          // shown key, and clears `pending`/`error` on a fresh landing.
          writeWrappedValue<Result>(setStore, result);
          shownKey = activeKey;
          if (pending()) setPending(false);
          if (error()) setError(undefined);
        },
        onError: (err) => surfaceError(err),
        // Normal completion — the pulse ended on its own (a typed end, e.g. the
        // host/entry left membership). Mirrors `createSubscription`'s typed-end.
        onComplete: () => setComplete(true),
        signal: pulseCtl.signal,
      });
    }),
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
