/**
 * THE client's Effect→UI edge — the one place a business-logic `Effect` becomes
 * running work, and the one row this package owns in the run-edge allowlist
 * (`packages/tests/governance/runEdges.ts`).
 *
 * Everything above it is a DESCRIPTION. A handler in `useTerminalCrud`, a
 * poll query in `hostCodeTab`, a device read in `useRecorder` — each returns an
 * `Effect` its caller composes. Only a DOM event handler, a Solid `createEffect`
 * body, or a module init has nowhere left to compose into, and those are the two
 * functions below.
 *
 * **Why one helper and not ~100 `Effect.runFork`s.** Biome's `noFloatingPromises`
 * goes blind at this boundary: an un-run `Effect` is an inert value, not a
 * Promise, so `crud.handleCreate(cwd)` in statement position is a SILENT NO-OP
 * that both biome and tsc accept (PLAN review #25 / the migration's H1). Naming
 * the edge once means "did you actually run it?" is answered by grep, and the
 * allowlist gains ONE row instead of one per file.
 *
 * **Why the action must be total (`E = never`).** The house style is that a
 * failure is reported next to the logic that produced it
 * (`.claude/rules/toast-conventions.md`: colocated, not centralized), and the
 * repo forbids a caught error collapsing to an empty state. Typing the edge on
 * `Effect<unknown, never>` makes both a COMPILE-TIME fact: a module that forgot
 * its `Effect.catch`/`catchTag` toast cannot reach the edge at all, and a caller
 * that deliberately drops an already-toasted failure has to say so
 * (`Effect.ignore`) exactly where the old code wrote `.catch(() => {})`.
 *
 * A DEFECT is a different animal — an undeclared throw, a bug — and it stays
 * loud here (console + toast) rather than vanishing into an unobserved fiber.
 *
 * **User-gesture windows (H4).** `Effect.runFork` executes on the CALLING stack
 * until the effect first suspends, so an action whose first steps are
 * synchronous still runs inside the browser's user-activation window —
 * `document.execCommand("copy")`, `showSaveFilePicker`, `getDisplayMedia` all
 * keep working. What breaks them is an `Effect.sleep`/`yieldNow`/`tryPromise`
 * BEFORE the browser call, not the fork. Keep gesture-bound work synchronous up
 * to the API call.
 */

import { Cause, Effect, Exit, type Fiber } from "effect";
import { getOwner, onCleanup } from "solid-js";
import { toast } from "solid-sonner";

/** A program that is ready to run at a UI edge: every declared failure has
 *  already been given its policy, so the only thing left that can go wrong is a
 *  defect. */
export type UiAction<A = unknown> = Effect.Effect<A, never>;

/** Normalise a squashed cause to an `Error` — the same rule
 *  `@kolu/surface/run-stream` uses, so a tagged surface error keeps its `_tag`. */
function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/** The ONE `Effect.runFork` in `packages/client`. Both exported edges funnel
 *  through it so the defect policy is stated once. */
function fork<A>(label: string, action: UiAction<A>): Fiber.Fiber<A, never> {
  const fiber = Effect.runFork(action);
  fiber.addObserver((exit) => {
    if (Exit.isSuccess(exit)) return;
    // An interruption is a TEARDOWN (the owner went away, a newer request
    // superseded this one), not a failure — reporting it would turn "the panel
    // closed" into an error toast.
    if (Cause.hasInterruptsOnly(exit.cause)) return;
    // `E` is `never`, so anything here is a DEFECT: an undeclared throw inside
    // an `Effect.sync`, a bug in a combinator, a schema that rejected an input.
    // Surface it at both levels — the console line carries the cause for a
    // developer, the toast tells the user their click did nothing.
    const error = toError(Cause.squash(exit.cause));
    console.error(`[runAction] ${label} died:`, error);
    toast.error(`${label} failed unexpectedly: ${error.message}`);
  });
  return fiber;
}

/** Run a UI action — the edge for a DOM event handler, a command palette
 *  `onSelect`, a keybinding.
 *
 *  Fire-and-forget by design: the click is over, and nothing in the UI is
 *  waiting on the outcome (the action's own toasts and store writes ARE the
 *  outcome). `label` names the action for the defect path only, so it reads as a
 *  user-facing noun phrase — "create terminal", not "handleCreate".
 *
 *  Returns the fiber, which almost every caller ignores. It exists for work
 *  whose lifetime is neither the click nor a reactive owner — the terminal
 *  attach loop, restarted from an xterm write callback where there is no owner
 *  to hang `onCleanup` on, and torn down by a handle the component holds. Reach
 *  for {@link runOwnedAction} whenever an owner IS in scope. */
export function runAction<A>(
  label: string,
  action: UiAction<A>,
): Fiber.Fiber<A, never> {
  return fork(label, action);
}

/** Run a UI action tied to the CURRENT Solid owner: the fiber is interrupted
 *  when the owner disposes.
 *
 *  This is the edge for work launched from a `createEffect` body or a component
 *  body — work whose lifetime is the component's, so that unmounting actually
 *  STOPS it. Interruption runs the effect's finalizers, which is what closes a
 *  wire subscription or a poll loop; there is no `AbortSignal` to thread and
 *  none to forget.
 *
 *  Returns the fiber so a caller that supersedes its own work (a latest-request-
 *  wins controller) can interrupt the previous one itself. Throws outside an
 *  owner: a fiber with no disposal path is a leak, and the fix is to pick
 *  {@link runAction} deliberately rather than to discover the leak later. */
export function runOwnedAction<A>(
  label: string,
  action: UiAction<A>,
): Fiber.Fiber<A, never> {
  if (!getOwner()) {
    throw new Error(
      `runOwnedAction("${label}"): no reactive owner — the fiber would outlive ` +
        "everything that could stop it. Use runAction for a one-shot event edge.",
    );
  }
  const fiber = fork(label, action);
  onCleanup(() => {
    fiber.interruptUnsafe();
  });
  return fiber;
}

/** Run a program and hand back its VALUE as a `Promise` — the edge for the three
 *  seams whose contract is a Promise and is not this package's to change:
 *  Solid's own `createResource` fetcher, `@kolu/ghostty-kit`'s backfill `fetch`
 *  (the kit is deliberately outside Effect), and `@kolu/surface`'s
 *  `pollOnChange`, whose `(signal) => Promise<T>` read seam is DELIBERATELY
 *  Promise-shaped (locked decision 1; the surface wave's `connectPollNode`
 *  records why) so that its non-Effect consumers keep working.
 *
 *  Unlike {@link runAction} the action need NOT be total: those consumers own an
 *  error path (a resource's error state, the kit's `isTerminalGone`/`onError`,
 *  the poll's `swallowError`) and a rejection is how they are told.
 *  `Effect.runPromise` rejects with the SQUASHED failure — the declared
 *  tagged-error instance itself, `_tag` and data intact — which is what keeps
 *  `_tag` narrowing honest at those consumers.
 *
 *  `signal` is the mirror image of the bridge `connectPollNode` builds on the
 *  server side: there an Effect's interruption drives an `AbortController`; here
 *  a caller's `AbortSignal` drives the fiber's interruption, so a superseded
 *  poll frame really does tear its in-flight read down instead of being awaited
 *  by nobody. */
export function runActionPromise<A, E>(
  action: Effect.Effect<A, E>,
  signal?: AbortSignal,
): Promise<A> {
  return Effect.runPromise(
    action,
    signal === undefined ? undefined : { signal },
  );
}
