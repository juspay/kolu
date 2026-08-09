/**
 * `kolu watch [<id>] [--json]` — FOLLOW the terminals live, until something
 * stops us.
 *
 * Every other verb answers a question and leaves. This one is the only verb
 * that never finishes on its own: it mirrors padi's `terminals` collection and
 * prints a line per change (a terminal appeared, its record moved, it went
 * away) plus the byte-activity transitions (`● busy` / `○ idle`) that say a
 * terminal is doing something RIGHT NOW. That is what makes it the verb a
 * driving agent tails while its sibling works.
 *
 * ## Three endings, and only one of them is a failure
 *
 * A live monitor has to tell "you stopped me" from "I lost the thing I was
 * watching", because a script that treats a dropped link as EOF silently stops
 * reporting and looks exactly like a quiet system:
 *
 *   - **The user stopped us** (Ctrl+C). The run edge — `NodeRuntime.runMain` in
 *     `main.ts` — interrupts the main fiber on SIGINT/SIGTERM, so this verb
 *     installs NO signal handlers of its own (padi-tui had to, because it ran
 *     on a bare `Effect.runPromise`; here the same wiring would be a second,
 *     competing stop path). It only has to make the interrupt REACH the mirror,
 *     which it does by handing `watchTerminals` the `AbortSignal` that
 *     `Effect.tryPromise` derives from fiber interruption (D10/#18: cancellation
 *     IS fiber interruption). Nothing is failed on this path; the exit code is
 *     the run edge's to decide, per the no-`process.exit`-in-a-verb rule.
 *   - **The consumer hung up** (`kolu watch | head -1`). The stdout sink fails
 *     with `StdoutClosed`, which is not an exit-code arm — the caller got what
 *     it asked for — so it aborts the same watch and returns success.
 *   - **The link dropped.** The mirror settled although nobody asked it to.
 *     That is a FAILURE (exit 1) carrying whatever the upstream diagnostic said,
 *     never a clean EOF.
 *
 * The discrimination is structural rather than re-derived after the fact: the
 * mirror can only settle by itself when the link closed, and the hangup arm is
 * the one thing that aborts it locally — so `hangup.signal.aborted` below is the
 * whole test.
 *
 * ## Backpressure, and why lines ride a queue
 *
 * `watchTerminals` hands frames to SYNCHRONOUS callbacks; stdout is a pipe that
 * can refuse to take more. So the handlers only enqueue, and a forked pump
 * drains the queue into a backpressure-aware sink — a slow `| less` applies real
 * backpressure instead of growing an unnamed chain of pending promises. Ending
 * the queue is what FLUSHES it, which gives the two non-interrupt endings a
 * definite "everything printed" point to join on before the verb returns.
 * (On Ctrl+C the run edge interrupts everything, so lines stdout has not yet
 * accepted are dropped: waiting uninterruptibly on a pipe that may never drain
 * is a worse failure mode than losing the tail of a feed the user just stopped.)
 *
 * ## Narrowing, and output discipline
 *
 * `<id>` is a short id or any unique prefix, resolved once against the live key
 * set before the mirror starts. It filters at the EMIT funnel rather than
 * opening a different subscription, because padi's collection is the whole
 * terminals set either way — one mirror, one filter.
 *
 * stdout is the data (`--json` makes it NDJSON, one object per line, so `jq -c`
 * streams it); upstream diagnostics go to stderr as they happen, because on a
 * live feed a problem the user learns about only at exit is a problem reported
 * too late.
 */

import { NodeSink } from "@effect/platform-node";
import { watchTerminals } from "@kolu/padi/dial";
import {
  formatWatchActivity,
  formatWatchActivityJson,
  formatWatchEvent,
  formatWatchJson,
  formatWatchRemoval,
  formatWatchRemovalJson,
} from "@kolu/padi/render";
import {
  type Cause,
  Data,
  Effect,
  Fiber,
  Option,
  Queue,
  type Sink,
  Stream,
} from "effect";
import { type Endpoint, withPadi } from "../endpoint.ts";
import { failure } from "../exit.ts";
import { resolveTerminal } from "./shared.ts";

/** What the command tree parsed for `watch`. */
export interface WatchArgs {
  /** A terminal id or unique prefix to narrow to — absent means every one. */
  readonly id: Option.Option<string>;
  readonly json: boolean;
}

/** The stdout consumer hung up (`kolu watch | head -1`). Deliberately NOT in
 *  `exit.ts`: that module is exclusively the codes a driver branches on, and
 *  this is not a failure at all — the caller got the lines it asked for. The
 *  cause is kept so a non-EPIPE stdout death (a full disk, a revoked descriptor)
 *  stays legible instead of being flattened into "consumer left". */
class StdoutClosed extends Data.TaggedError("StdoutClosed")<{
  readonly cause: unknown;
}> {}

/** Backpressure-aware stdout, as a SINK — the sink waits on `drain`, so a slow
 *  consumer slows the producer instead of inflating an in-memory backlog.
 *  `endOnDone: false` because this process does not own `process.stdout`'s
 *  lifetime; a sink that ended it would close the shell's own descriptor.
 *
 *  Local rather than `./shared.ts`'s `writeOut`: that one writes ONE block and
 *  returns, which is the wrong shape for a feed. This sink is consumed ONCE, by
 *  the pump below, for the whole life of the watch — and a hangup has to abort
 *  the mirror rather than merely resolve a write, which is why the closed arm is
 *  a callback here instead of a silent success. */
const stdoutSink: Sink.Sink<void, string, never, StdoutClosed> =
  NodeSink.fromWritable<StdoutClosed, string>({
    evaluate: () => process.stdout,
    onError: (cause) => new StdoutClosed({ cause }),
    endOnDone: false,
  });

/** Drain ready-to-print lines into stdout until the queue ENDS, telling the
 *  caller if the consumer hangs up first. */
const pumpToStdout = (
  lines: Queue.Dequeue<string, Cause.Done>,
  onClosed: () => void,
): Effect.Effect<void> =>
  Stream.run(Stream.fromQueue(lines), stdoutSink).pipe(
    Effect.catchTag("StdoutClosed", () => Effect.sync(onClosed)),
  );

/** The line a dropped link fails with when the upstream said nothing more
 *  specific — phrased as the question the user can act on. */
const LINK_CLOSED =
  "the padi link closed — the daemon stopped or the connection dropped. Is `padi` still running?";

export function run(
  endpoint: Endpoint,
  args: WatchArgs,
): Effect.Effect<void, unknown> {
  return withPadi(
    endpoint,
    Effect.fn(function* (conn) {
      const only = Option.isSome(args.id)
        ? yield* resolveTerminal(conn, args.id.value)
        : undefined;

      const lines = yield* Queue.unbounded<string, Cause.Done>();
      const emit = (line: string): void => {
        Queue.offerUnsafe(lines, line);
      };
      /** The first upstream diagnostic, kept as the REASON a link-drop failure
       *  gives. `??=` because the first one is the one that explains the drop;
       *  the ones after it are consequences. */
      let upstreamError: string | undefined;

      // Aborted when the consumer hangs up — the local half of "stop the
      // watch"; the other half is fiber interruption, joined below.
      const hangup = new AbortController();
      const pump = yield* Effect.forkChild(
        pumpToStdout(lines, () => hangup.abort()),
      );

      yield* Effect.catch(
        Effect.tryPromise({
          // `interrupted` is the signal Effect derives from THIS fiber's
          // interruption, so a Ctrl+C at the run edge reaches the mirror
          // without a single `process.on` in this file. Combined with the
          // hangup signal because both mean "stop", and the mirror takes one.
          try: (interrupted) =>
            watchTerminals(
              conn.client,
              {
                onUpsert: (id, value, live) => {
                  if (only !== undefined && id !== only) return;
                  emit(
                    args.json
                      ? `${formatWatchJson(id, value, { live })}\n`
                      : `${formatWatchEvent(id, value, { now: Date.now(), live })}\n`,
                  );
                },
                onRemove: (id) => {
                  if (only !== undefined && id !== only) return;
                  emit(
                    args.json
                      ? `${formatWatchRemovalJson(id)}\n`
                      : `${formatWatchRemoval(id, { now: Date.now() })}\n`,
                  );
                },
                onActivity: (id, live) => {
                  if (only !== undefined && id !== only) return;
                  emit(
                    args.json
                      ? `${formatWatchActivityJson(id, live)}\n`
                      : `${formatWatchActivity(id, live, { now: Date.now() })}\n`,
                  );
                },
              },
              AbortSignal.any([interrupted, hangup.signal]),
              (line) => {
                upstreamError ??= line;
                process.stderr.write(`kolu: ${line}\n`);
              },
            ),
          catch: (err) => err,
        }),
        // A rejection and a self-settle are the same fact — the watch is over —
        // so both land on the one ending below; the rejection just names itself.
        (err) =>
          Effect.sync(() => {
            upstreamError ??= err instanceof Error ? err.message : String(err);
          }),
      );

      // Stop producing and FLUSH what is already queued before leaving: a
      // `watch` that dropped its last lines on the way out is indistinguishable
      // from one that never saw the event.
      yield* Queue.end(lines);
      yield* Fiber.join(pump);

      // The mirror settled and nothing local asked it to — the link dropped.
      if (!hangup.signal.aborted) {
        return yield* Effect.fail(failure(upstreamError ?? LINK_CLOSED));
      }
    }),
  );
}
