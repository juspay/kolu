/**
 * SolidJS primitive for consuming streams whose **input parameters** are
 * reactive — i.e., the subscription must tear down and re-establish whenever the
 * input changes, not just when the consuming component unmounts.
 *
 * Use this when the upstream stream depends on an input that the user can
 * change (selected file, active git mode, etc.). For static-input streams
 * use `createSubscription` — cheaper, simpler.
 *
 * Lifecycle: every input change tears the previous subscription down (the effect's
 * RETURNED cleanup, which Solid runs before the next effect run and on disposal),
 * which INTERRUPTS its fiber (the server tears down through the stream's own
 * finalizers), then opens a fresh one. The exposed `Subscription<T>` reads the
 * latest value any subscriber yielded; `pending()` is true between the input
 * change and the first new yield.
 */

import type { Stream } from "effect";
import {
  type Accessor,
  createEffect,
  createSignal,
  createStore,
  getOwner,
  onSettled,
  runWithOwner,
} from "solid-js";
import {
  createUpdatedTracker,
  noLifetimeRefusal,
  type Subscription,
  wireSubscriptionError,
} from "./createSubscription";
import { runStreamScoped } from "../runStream";
import { writeWrappedValue } from "./writeValue";

export interface ReactiveSubscriptionOptions {
  onError?: (err: Error) => void;
}

/** `arrayKey` is the member's DECLARED array identity (see `./writeValue.ts`),
 *  and it is spelled INLINE here rather than as a named type extending
 *  {@link ReactiveSubscriptionOptions}, because the widening has exactly one call
 *  site and a name for it would be a concept nothing else can use.
 *
 *  It stays OFF `ReactiveSubscriptionOptions` — the type `useStream` and
 *  `BoundStream.use` expose to a call site — because the answer belongs to the
 *  member's definition, not to whoever happens to be reading it; `useStream`
 *  threads it from the descriptor, so no `.use()` caller can spell it, override
 *  it, or disagree with another about it. A caller driving a RAW stream through
 *  this primitive has no descriptor to inherit from and is itself the declaration
 *  site, which is why it is spellable at this layer at all. */
export function createReactiveSubscription<I, T>(
  inputFn: () => I | null,
  factory: (input: I) => Stream.Stream<T, unknown>,
  options?: ReactiveSubscriptionOptions & { arrayKey?: string },
): Subscription<T> {
  // This primitive's lifetime is the creating OWNER's and has no second
  // spelling: the effect below opens each input's fiber and its RETURNED
  // cleanup interrupts it, so an ownerless call would mint an effect nothing
  // disposes (Solid names it `NO_OWNER_EFFECT` and warns) over a fiber nothing
  // can interrupt — the wire subscription stays open for the life of the page.
  // Refused rather than leaked, like `createSubscription`'s own no-lifetime
  // case — and in those same words, through the one helper shared with
  // `createSubscription`, `useCell`, `useCollection` and `useEvent`.
  // (`client.rawStream` refuses too, in its own words: its advice names the
  // un-enrolled escape hatch this primitive has no equivalent of.) `useStream`
  // and the bound `.use()` hooks reach this primitive and carry the requirement
  // with it; none of them exposes a `signal`, so the advice offers none.
  if (!getOwner())
    throw noLifetimeRefusal({
      name: "createReactiveSubscription",
      acceptsSignal: false,
    });
  const [store, setStore] = createStore<{ v: T | undefined }>({ v: undefined });
  const [error, setError] = createSignal<Error | undefined>();
  const [pending, setPending] = createSignal(true);
  const [complete, setComplete] = createSignal(false);

  // The change-iff-fired half of the Dynamic — the ONE law shared with
  // `createSubscription` via `createUpdatedTracker`. A fresh input opens a fresh
  // subscription, so the tracker is `reset()` with the rest of the state below —
  // the new input's first frame is a value, not a change.
  const tracker = createUpdatedTracker<T>();

  createEffect(
    inputFn,
    (input) => {
      // Reset state on every input change; the prior iterator is being
      // torn down so the previously-yielded value is no longer authoritative —
      // including `complete`: a fresh input opens a fresh iterator, so the
      // PRIOR typed end no longer describes the current one.
      //
      // SETTLED, not inline: a consumer is free to fold this subscription's own
      // INPUT with what it publishes — one computation reading the selected file
      // and `sub()`/`pending()` is the ordinary shape — and such a reader has
      // already answered for the input change by the time this arm writes.
      // Written inline, the arm relays the input into that reader
      // (`EFFECT_RELAY_TEAR`, `warn` by the third change), and its first frame
      // shows the NEW input beside the PRIOR input's value. From `onSettled` the
      // reset lands in a later pass of the SAME flush, carrying no effect origin,
      // so the published state once the flush ends is what it always was: no
      // value, no error, pending, not complete.
      //
      // UNOWNED: under an owner — which an apply arm has — `onSettled` is a
      // tracked effect created and run right there, so the write would carry
      // this arm's own frame (the relay it is deferring) and this effect would
      // grow a child per input change. With no owner it enqueues, which is the
      // deferral. The callback writes signals and returns NOTHING (a returned
      // value reads as a cleanup, which `onSettled` forbids unowned) — which is
      // also why the FIBER is opened below rather than here: the subscription's
      // teardown is this effect's own returned cleanup.
      //
      // The drain is NOT ordered against the fresh fiber: a `Stream` runs
      // synchronously until its first suspension, so a failure at OPEN (and a
      // frame an already-resolved source has ready) lands BEFORE the settle
      // drains. So the reset is what it always meant — "the PRIOR input's facts
      // are no longer authoritative" — and says nothing about a fact THIS run
      // has already published: each leg is skipped when this run produced its
      // replacement. The published state at the end of the flush is master's,
      // case for case, including the failure that opens with the subscription.
      const produced = { frame: false, ended: false, failed: false };
      runWithOwner(null, () =>
        onSettled(() => {
          if (!produced.frame) {
            setStore((s) => {
              s.v = undefined;
            });
            tracker.reset();
          }
          if (!produced.failed) setError(undefined);
          if (!produced.ended) setComplete(false);
          if (!produced.frame && !produced.ended && !produced.failed)
            setPending(true);
        }),
      );
      if (input === null) return;

      // The prior input's fiber was interrupted by the cleanup this effect RETURNED
      // on its previous run — Solid runs it BEFORE re-running the effect — so the two
      // subscriptions never overlap and a stale frame can never land in the fresh
      // state reset above.
      return runStreamScoped<T>(factory(input), {
        // The store write and the `pending` clear happen in one synchronous handler,
        // so they share a flush (matching `createStreamLifecycle`): no consumer
        // observes a frame applied while the view still reads pending.
        onFrame: (item) => {
          produced.frame = true;
          tracker.noteFrame(item);
          writeWrappedValue(setStore, item, options?.arrayKey);
          setPending(false);
          // No clear-on-frame branch for the ERROR: a failure is the fiber's EXIT,
          // so no frame can follow one on the same subscription (see
          // `createSubscription`). Here the error clears when the INPUT changes —
          // the state reset above — which is this primitive's own recovery point.
        },
        // Mirrors `createSubscription`'s typed-end handling: an interruption
        // (a superseding input, an unmount) reports nothing.
        onEnd: () => {
          produced.ended = true;
          // Unconditional: `false` over `false` is a no-op under the signal's default
          // equality, and a read-back here would see the pre-flush value anyway.
          setPending(false);
          setComplete(true);
        },
        onFailure: (err) => {
          produced.failed = true;
          setError(err);
          setPending(false);
        },
      });
    },
    { name: "reactiveSubscriptionInput" },
  );

  const sub = Object.assign((() => store.v) as Accessor<T | undefined>, {
    error,
    pending,
    complete,
    updated: tracker.updated,
    changed: tracker.changed,
  }) as Subscription<T>;

  // Route `onError` through the SAME EDGE effect every other subscription uses, by
  // CALLING it rather than by restating it: driving the callback off the `error()`
  // LEVEL is what keeps the two error channels from disagreeing — the property
  // `client.health()` relies on. Whatever clears `error()` (here, an input change
  // resetting the state) clears the callback's view with it, so a consumer wiring
  // `onError → signal → render` cannot latch on a failure the signal has already
  // dropped (the #1564 latch, the reactive path's copy of it).
  if (options?.onError) wireSubscriptionError(sub, options.onError);

  return sub;
}
