/**
 * The per-subscription LIVENESS registry — what every fenced subscription in
 * this runtime has actually received, and when (kolu#2101 J2).
 *
 * The production incident this exists for: a woken tab whose socket, watchdog
 * and header dot were all healthy while EVERY fenced subscription in it was
 * parked forever on a re-dial the protocol swallowed (`socketRedialLaws.test.ts`
 * law 2). J1 kills that class at the link. This module is the other half — the
 * EYES: without it, "this subscription last heard from the server before the
 * wire's current socket even opened" is a fact no client-side surface can state,
 * and diagnosing the park took server-log archaeology plus screenshot forensics.
 * A subscription's own `pending()`/`error()` (`solid/health.ts`) cannot say it
 * either: a parked stream is neither pending (its first frame landed, long ago)
 * nor erroring (nothing failed — that is the whole disease).
 *
 * **Why MODULE-scoped, and not per-client.** `client.health()` is per-client on
 * purpose: it is a FACT a component binds and paints. This is a FORENSIC record,
 * and the question it answers ("which subscription in this tab is stale?") spans
 * every client in the runtime — kolu alone holds a root surface client, a
 * surface-app client, and one keyed-map client per host, plus the deliberately
 * un-enrolled raw streams (the terminal attach) that belong to no client at all.
 * A per-client registry would have to be threaded to a diagnostic surface from
 * ~15 places and would still miss the un-enrolled ones. The scope is the
 * RUNTIME, so the registry is too. It is read-only to consumers, and a test
 * resets it ({@link resetSubscriptionLiveness}) rather than reaching into it.
 *
 * **Wall clock, deliberately.** `Date.now()`, matching `WireDiagnostics`'s dial
 * history: these timestamps are read BESIDE a server log, and a monotonic
 * reading cannot be compared to one. (Both are read by a human, never used to
 * schedule anything, so the clock's non-monotonicity buys nothing here.)
 *
 * **Bounded.** Live records are bounded by the subscriptions the app actually
 * holds. ENDED ones are kept only {@link ENDED_RETENTION} deep — enough to see
 * the handful that died around an incident, never a leak in a tab left open for
 * a week.
 */

import { Cause, Exit } from "effect";

/** The label a subscription registers under when its call site passed none.
 *  A registered-but-unlabelled subscription is deliberately VISIBLE: a
 *  diagnostic that silently omitted it would report a clean table while the
 *  parked stream sat outside it. Seeing `(unlabeled)` in a snapshot is a
 *  coverage gap to close, and that is the point. */
export const UNLABELED_SUBSCRIPTION = "(unlabeled)";

/** How many ENDED/FAILED subscription records the registry keeps, oldest
 *  dropped first. Twenty covers the churn around one incident (a host switch, a
 *  pane closing, a re-key) without growing without bound. */
export const ENDED_RETENTION = 20;

/** How much of a failure's message is kept. A record is read in a copy-pasted
 *  snapshot, so a multi-kilobyte stack would bury the table it belongs to. */
const ERROR_TEXT_LIMIT = 200;

/** One fenced subscription's liveness, as the client itself observed it. */
export interface SubscriptionLiveness {
  /** The call site's {@link StreamFenceOptions.label}, or
   *  {@link UNLABELED_SUBSCRIPTION}. Not unique: two hosts legitimately hold a
   *  subscription of the same name, and each gets its own record. */
  readonly label: string;
  /** When the fenced stream STARTED running (not when its value was built). */
  readonly subscribedAt: number;
  /** When the last frame was delivered to the consumer, across every attempt.
   *  `undefined` ⇒ this subscription has never yielded — the cold-park shape. */
  readonly lastFrameAt: number | undefined;
  /** Frames delivered across every attempt of this subscription. */
  readonly framesReceived: number;
  /** Retryable failures the fence absorbed — each one re-subscribed. */
  readonly retries: number;
  /** `live` while the fenced stream is still running; `ended` once it completed
   *  or was interrupted (the consumer unsubscribed, its owner disposed);
   *  `failed` when it ended on a failure the fence refused to retry. */
  readonly state: "live" | "ended" | "failed";
  /** When the stream stopped running. `undefined` while `live`. */
  readonly endedAt: number | undefined;
  /** The last failure this subscription saw — retryable or terminal — trimmed
   *  to {@link ERROR_TEXT_LIMIT}. `undefined` ⇒ it has never failed. */
  readonly lastError: string | undefined;
}

/** The framework-internal writer one fenced subscription holds for its lifetime.
 *  Minted by {@link registerSubscription}; only `fenceStream` calls it. */
export interface SubscriptionProbe {
  /** One frame reached the consumer. */
  frame(): void;
  /** A retryable failure — the fence is about to re-subscribe. */
  retry(error: unknown): void;
  /** The fenced stream stopped running, for any reason. */
  finish(exit: Exit.Exit<unknown, unknown>): void;
}

type MutableRecord = {
  -readonly [K in keyof SubscriptionLiveness]: SubscriptionLiveness[K];
};

/** Insertion-ordered, so the read below is subscribe-order without a sort. */
const records = new Map<number, MutableRecord>();
/** The ids of ended records, oldest first — the eviction queue. */
const endedIds: number[] = [];
let nextId = 0;

function errorText(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : ((error as { message?: unknown })?.message ?? String(error));
  const text = typeof message === "string" ? message : String(message);
  return text.length > ERROR_TEXT_LIMIT
    ? `${text.slice(0, ERROR_TEXT_LIMIT)}…`
    : text;
}

/** Register a subscription that is STARTING now. Framework-internal — the only
 *  caller is `fenceStream`, which is the one place every subscription in the
 *  system funnels through (`unenrolledStreamCall`, and so every `.use()` hook,
 *  applies it), so registration is TOTAL by construction rather than by every
 *  call site remembering. */
export function registerSubscription(
  label: string | undefined,
): SubscriptionProbe {
  const id = nextId++;
  const record: MutableRecord = {
    label: label ?? UNLABELED_SUBSCRIPTION,
    subscribedAt: Date.now(),
    lastFrameAt: undefined,
    framesReceived: 0,
    retries: 0,
    state: "live",
    endedAt: undefined,
    lastError: undefined,
  };
  records.set(id, record);
  return {
    frame: () => {
      record.framesReceived += 1;
      record.lastFrameAt = Date.now();
    },
    retry: (error) => {
      record.retries += 1;
      record.lastError = errorText(error);
    },
    finish: (exit) => {
      if (record.state !== "live") return;
      record.endedAt = Date.now();
      if (Exit.isSuccess(exit)) {
        record.state = "ended";
      } else if (Cause.hasInterrupts(exit.cause)) {
        // An interrupt IS the unsubscribe (`createSubscription`'s scoped fiber
        // being torn down by its owner), which is an ordinary end, not a fault.
        record.state = "ended";
      } else {
        record.state = "failed";
        record.lastError = errorText(Cause.squash(exit.cause));
      }
      endedIds.push(id);
      while (endedIds.length > ENDED_RETENTION) {
        const evicted = endedIds.shift();
        if (evicted !== undefined) records.delete(evicted);
      }
    },
  };
}

/** Every subscription this runtime currently holds, plus the last
 *  {@link ENDED_RETENTION} it has finished with — in SUBSCRIBE order, which is
 *  what makes "this one was opened before the wire's current socket" readable
 *  straight off the table.
 *
 *  A plain synchronous read of already-held state: no reactivity, no wire, no
 *  clock beyond `Date.now()`. A diagnostic that had to ASK the server whether a
 *  subscription was alive would be useless in exactly the case it exists for —
 *  a wire that is lying. */
export function subscriptionLiveness(): readonly SubscriptionLiveness[] {
  return [...records.values()].map((record) => ({ ...record }));
}

/** Drop every record. For TESTS only — the registry is module-scoped, so a suite
 *  that did not reset it would read another test's subscriptions. */
export function resetSubscriptionLiveness(): void {
  records.clear();
  endedIds.length = 0;
  nextId = 0;
}
