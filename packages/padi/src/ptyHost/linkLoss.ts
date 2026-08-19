/**
 * The self-healing arm of padi's kaval endpoint (juspay/kolu#2182): re-converge
 * when the held connection dies MID-SESSION.
 *
 * ## The defect this closes
 *
 * The endpoint reports `degraded` when the connection it holds closes, and until
 * this module nothing ever re-dialled. In the field padi sat degraded for 52
 * minutes with a perfectly healthy kaval still serving behind the dead socket
 * (the link died on an RPC ping timeout — most likely a padi event-loop stall),
 * `ptyHostClient` threw on every call, and the only recovery the UI offered
 * destroyed every running terminal. Restarting padi BY HAND fixed it in one
 * step, and that is the whole design: padi's boot re-runs `converge`, which
 * ADOPTS the same-build resident kaval (9 PTYs and 8 agents survived the manual
 * restart). This module is that boot step, re-armed as an invariant — the same
 * move `kavalSupervision` made for the probe ("convergence was an event; this
 * makes it an invariant"), one failure mode over.
 *
 * ## Why `degraded`, and only after a `connected`
 *
 * `degraded` is the one state that means "we HELD a connection and lost it",
 * which is exactly what makes re-converging a treatment rather than a hot loop
 * against a daemon that never came up. A dead-on-boot daemon reports `dead` and
 * keeps today's behaviour (the card and its button); the `everConnected` latch
 * says so in one bit.
 *
 * ## What it cannot race
 *
 *   - **Itself.** {@link inFlightHeal} is the in-flight token — presence IS the
 *     flag, the idiom `serializeRestart` uses for the same job one layer down.
 *     An attempt is never started while one is running.
 *   - **A restart.** A user "Restart kaval" and the steady-state supervision
 *     auto-recycle both reach the endpoint through ONE trigger, and that trigger
 *     is wrapped in {@link withRestartClaim}: the claim is taken SYNCHRONOUSLY,
 *     so no heal can start behind it, and it then waits out an attempt already
 *     mid-converge. Both sides check, so the exclusion is total rather than
 *     one-directional — which matters because two spawns at one rendezvous is
 *     the "the new daemon yields to the live gate holder" no-op recycle the
 *     spine fails loudly on.
 *   - **A stale trigger.** The status is re-read at FIRE time, never at arm
 *     time. A link healed by any other path has already reported `connected`,
 *     which cancels the loop and resets the backoff.
 *
 *   The endpoint's own emit-guard (`underRestartHold`) is what makes the second
 *   point cheap: it already repaints a restart's transient `degraded` as
 *   `restarting`, so a restart's own teardown can never look like a link loss.
 *   The claim closes the one instant that guard cannot cover — the trigger
 *   invoked, its `holdRestarting` not yet emitted.
 *
 * ## Timer choice — node timers, not Effect's Clock
 *
 * The ruling `kavalSupervision` wrote down (see its "Timer choice" section), for
 * the same two reasons: (1) the timer must be `unref`'d — a pending heal must
 * never be the thing holding a draining padi open — and Effect 4's default
 * `Clock` sleeps on a plain, REF'd `setTimeout`, so `Effect.sleep` /
 * `Schedule` cannot express this timer without a bespoke Clock service; and (2)
 * it is a CHAINED `setTimeout`, never `setInterval`, so a converge that outlasts
 * its backoff can never overlap the next attempt.
 *
 * ## Why unbounded retries are not the unbounded retry the doctrine forbids
 *
 * Each attempt is bounded — by the endpoint's own dial, handshake and
 * socket-ready deadlines — and the interval is bounded below by the backoff and
 * above by its 30 s ceiling. What is unbounded is only how long padi keeps
 * trying, and the alternative (give up after N) is precisely the permanent
 * `degraded` this exists to end.
 */

import type { EndpointState } from "@kolu/surface-daemon-supervisor";
import { Effect } from "effect";
import { log } from "../log.ts";

/** What one converge + its reconcile settled on — the word the heal's journal
 *  line names. `recycled` is the fail-CLOSED arm: the adoption's reconcile
 *  failed, so the adopted daemon was recycled and the saved session parked. */
export type ConvergeVerdict = "adopted" | "no-survivors" | "recycled";

/** The first wait before a re-converge, and the ceiling the doubling stops at.
 *  Not knobs — there is no override path and no env read: a link that died with
 *  a healthy daemon still behind it is re-dialled within a second, and a link
 *  that stays down is re-dialled twice a minute forever, with one WARN per
 *  attempt either way. */
const BACKOFF_MS = 1_000;
const BACKOFF_CEILING_MS = 30_000;

/** How many restarts currently OWN the endpoint. A counter, not a flag, because
 *  the trigger it guards coalesces riders: several callers can hold the claim
 *  over one restart, and the healer must stand down until the last of them is
 *  done. */
let restartsInFlight = 0;

/** The heal in flight, or `undefined`. A promise rather than a fiber because the
 *  loop is a node timer, not an Effect. It never rejects — the attempt absorbs
 *  its own failure — so waiting on it can only ever be a delay, never a way for
 *  a heal's failure to reach the restart that waited. */
let inFlightHeal: Promise<void> | undefined;

/**
 * Run `restart` as the endpoint's exclusive owner: the healer stands down for
 * its whole duration, and a heal already mid-converge is waited out first.
 *
 * The claim is taken in the SAME synchronous step that installs the finalizer,
 * so it can never be released without having been taken (nor taken by a restart
 * that is described and never run). The wait is bounded by the endpoint's own
 * deadlines, and it happens BEFORE the trigger rather than around it — so the
 * trigger's coalescing is untouched: concurrent callers still ride one restart.
 */
export function withRestartClaim<A, E>(
  restart: Effect.Effect<A, E>,
): Effect.Effect<A, E> {
  return Effect.suspend(() => {
    restartsInFlight += 1;
    const pending = inFlightHeal;
    return Effect.gen(function* () {
      if (pending !== undefined) yield* Effect.promise(() => pending);
      return yield* restart;
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          restartsInFlight -= 1;
        }),
      ),
    );
  });
}

/** The healer's one seam onto the endpoint: every status it publishes. */
export interface LinkLossHealer {
  /** Fold one published status into the loop. TOTAL and cheap by contract: the
   *  endpoint's `onStatus` is SYNCHRONOUS (it is called from the transport's own
   *  `onClose`), so this may only arm a timer — the converge happens on that
   *  timer, off the emit's stack. */
  observe(state: EndpointState): void;
}

export function startLinkLossHealer(deps: {
  /** Re-converge the endpoint and run the SAME post-converge hooks the boot runs
   *  (adopt-reconcile, its fail-closed recycle, or the no-survivor park). A
   *  VALUE, not a thunk — an Effect is already the description of work not yet
   *  done — and re-run per attempt. */
  readonly reconverge: Effect.Effect<ConvergeVerdict, unknown>;
  /** Stamp the PROVEN recovery so the client toasts it once — the same signal
   *  `startKavalSupervision`'s `onRecovered` stamps. Injected, so this module
   *  never reaches into the status store. */
  readonly onRecovered?: () => void;
  /** First-wait override, in ms — a TEST seam (like `startKavalSupervision`'s
   *  `pollMs`); production omits it. */
  readonly backoffMs?: number;
}): LinkLossHealer {
  const firstMs = deps.backoffMs ?? BACKOFF_MS;
  /** The last state the endpoint published. Read it through {@link published},
   *  never off a narrowed local: it moves under every `await` below, and
   *  re-reading it at fire time is exactly why a stale trigger cannot act. */
  let state: EndpointState | undefined;
  const published = (): EndpointState | undefined => state;
  /** Have we ever held a connection? Latched for the process: a link lost once
   *  is a link that can be lost again, and the next loss is this same incident
   *  class. */
  let everConnected = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;
  let waitMs = firstMs;

  const cancel = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    attempt = 0;
    waitMs = firstMs;
  };

  const arm = (): void => {
    // One pending attempt at a time, and none while one runs — a running attempt
    // re-arms itself if it fails.
    if (timer !== undefined || inFlightHeal !== undefined) return;
    const backoffMs = waitMs;
    waitMs = Math.min(waitMs * 2, BACKOFF_CEILING_MS);
    timer = setTimeout(() => {
      timer = undefined;
      void tick(backoffMs);
    }, backoffMs);
    timer.unref?.();
  };

  /** ONE re-converge. Never rejects: the loop owns the retry, so a failed
   *  attempt is a logged fact it folds in — never an escaping rejection, and
   *  never one a waiting restart could inherit.
   *
   *  It is told WHICH attempt it is rather than reading the counter: a converge
   *  that succeeds publishes `connected` from inside itself, which resets the
   *  counter before the line below is written. */
  const runAttempt = async (attemptNo: number): Promise<boolean> => {
    try {
      const verdict = await Effect.runPromise(deps.reconverge);
      log.info(
        { attempt: attemptNo, verdict },
        `kaval link restored by re-converge — ${verdict}`,
      );
      // Sticky on a `connected` status only (the store drops it otherwise), so a
      // heal that somehow left the endpoint down announces nothing.
      deps.onRecovered?.();
      return true;
    } catch (err) {
      log.error(
        { err, attempt: attemptNo },
        "kaval re-converge attempt failed — the link is still down; retrying after the next backoff",
      );
      return false;
    }
  };

  const tick = async (backoffMs: number): Promise<void> => {
    // Fire-time re-reads, ordered by what each protects: our own attempt owns the
    // chain (it re-arms itself), a restart owns the ENDPOINT (so reschedule
    // behind it), and a status that is no longer `degraded` means the link healed
    // — or died terminally — by some other path.
    if (inFlightHeal !== undefined) return;
    if (restartsInFlight > 0) {
      arm();
      return;
    }
    if (published() !== "degraded") return;
    attempt += 1;
    const attemptNo = attempt;
    log.warn(
      { attempt: attemptNo, backoffMs },
      `kaval link lost mid-session — re-converging (attempt ${attemptNo}, backoff ${backoffMs}ms)`,
    );
    const heal = runAttempt(attemptNo);
    // The token is published before anything can observe its absence: the call
    // above runs synchronously up to its own first suspension, and this
    // assignment is the next statement on that same stack.
    inFlightHeal = heal.then(() => {});
    let healed: boolean;
    try {
      healed = await heal;
    } finally {
      inFlightHeal = undefined;
    }
    // A converge that succeeds emits `connected`, so `observe` has already
    // cancelled this loop and reset the backoff. Anything else — a failed
    // attempt, or a "success" that left the endpoint down — is still a link to
    // heal.
    if (!healed || published() !== "connected") arm();
  };

  return {
    observe: (next: EndpointState): void => {
      state = next;
      if (next === "connected") {
        everConnected = true;
        cancel();
        return;
      }
      // `dead` / `incompatible` are boot-time or terminal verdicts this loop does
      // not treat, and `restarting` / `connecting` are somebody else's in-flight
      // transition. Only a LOST connection is ours.
      if (next !== "degraded") return;
      if (!everConnected) return;
      arm();
    },
  };
}
