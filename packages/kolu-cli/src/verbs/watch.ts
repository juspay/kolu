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
 * ## Four endings, and two of them are failures
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
 *   - **The consumer hung up** (`kolu watch | head -1`). The stdout sink dies
 *     with EPIPE, which is not an exit-code arm — the caller got the lines it
 *     asked for — so it stops the same watch and returns success.
 *   - **stdout genuinely died** (a full disk, a revoked descriptor). It stops
 *     the watch identically, because nothing can be delivered now — but it is a
 *     FAILURE (exit 1) that NAMES node's own error, never a silent success: a
 *     `watch` that lost its output and exited 0 is indistinguishable, to the
 *     loop above it, from one that had nothing to report. The
 *     EPIPE-vs-everything-else decision and the sentence it prints are
 *     `./shared.ts`'s `writeOut` ones — the same question asked of a streaming
 *     sink instead of a one-shot write.
 *   - **The link dropped.** The mirror settled although nobody asked it to.
 *     That is a FAILURE (exit 1) carrying the mirror's own rejection message —
 *     or {@link LINK_CLOSED} when it merely settled — never a clean EOF.
 *
 * The discrimination stays structural rather than re-derived after the fact. The
 * mirror can only settle by itself when the link closed, and the two stdout
 * deaths are the only things that abort it locally — so `stopped.signal.aborted`,
 * read at the instant the mirror ended, separates "we ended it" from "it ended
 * us". WHICH stdout death it was rides the pump's own error channel, which
 * `Fiber.join` surfaces before that test is ever reached.
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
 * streams it); upstream narration goes to stderr as it happens, because on a
 * live feed a problem the user learns about only at exit is a problem reported
 * too late. It is narration only, though — it never gets to speak for the
 * ending; see `rejection` below.
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
import { type Cause, Effect, Fiber, Queue, type Sink, Stream } from "effect";
import type { Command } from "effect/unstable/cli";
// `import type` — fully erased, so this does NOT re-enter the command tree at
// runtime and the per-face dynamic-import fence is untouched.
import type { watchFlags } from "../cli.ts";
import { type Endpoint, withPadi } from "../endpoint.ts";
import { type CliFailure, failure } from "../exit.ts";
import { resolveTerminal, StdoutWriteFailed } from "./shared.ts";

/** What the command tree parsed for `watch` — DERIVED from `watchFlags` in
 *  `cli.ts`. `id` is a terminal id or unique prefix to narrow to; `undefined`
 *  means every one. */
export type WatchArgs = Command.Command.Config.Infer<typeof watchFlags>;

/** Backpressure-aware stdout, as a SINK — the sink waits on `drain`, so a slow
 *  consumer slows the producer instead of inflating an in-memory backlog.
 *  `endOnDone: false` because this process does not own `process.stdout`'s
 *  lifetime; a sink that ended it would close the shell's own descriptor.
 *
 *  Local rather than `./shared.ts`'s `writeOut`: that one writes ONE block and
 *  returns, which is the wrong shape for a feed. This sink is consumed ONCE, by
 *  the pump below, for the whole life of the watch — and a dead stdout has to
 *  stop the mirror rather than merely resolve a write, which is why the death
 *  arm reaches a callback here. The ERROR it carries is `./shared.ts`'s own
 *  {@link StdoutWriteFailed}: the two writers differ in shape, not in what can
 *  go wrong with a descriptor, so they name it once. */
const stdoutSink: Sink.Sink<void, string, never, StdoutWriteFailed> =
  NodeSink.fromWritable<StdoutWriteFailed, string>({
    evaluate: () => process.stdout,
    onError: (cause) => new StdoutWriteFailed({ cause }),
    endOnDone: false,
  });

/** Did the consumer hang up (`kolu watch | head -1`), or did the write genuinely
 *  fail (a full disk, a revoked descriptor)? EPIPE means the reader got the lines
 *  it asked for and left; anything else is a real failure that must be said out
 *  loud rather than folded into the same silent success. The streaming twin of
 *  the decision `./shared.ts`'s `writeOut` makes for a one-shot write — the same
 *  test and the same sentence, because a user must not have to learn two
 *  spellings of "kolu could not write to stdout". */
const isConsumerHangup = (cause: unknown): boolean =>
  (cause as { readonly code?: unknown })?.code === "EPIPE";

/** Drain ready-to-print lines into stdout until the queue ENDS, or until stdout
 *  dies under us.
 *
 *  Either death STOPS the watch — `stop` aborts the mirror, because a feed with
 *  nowhere to go is not a feed — and only the REPORT differs: a hangup is a
 *  complete run (success), and anything else fails on this effect's error
 *  channel, naming node's own message. The caller joins this fiber, which is
 *  where that failure becomes the verb's. */
const pumpToStdout = (
  lines: Queue.Dequeue<string, Cause.Done>,
  stop: () => void,
): Effect.Effect<void, CliFailure> => {
  const drain: Effect.Effect<void, StdoutWriteFailed> = Stream.run(
    Stream.fromQueue(lines),
    stdoutSink,
  );
  return Effect.catchTag(drain, "StdoutWriteFailed", (err) =>
    Effect.flatMap(Effect.sync(stop), () =>
      isConsumerHangup(err.cause)
        ? // The reader left — that is a complete watch, not an error to report.
          Effect.void
        : Effect.fail(
            failure(
              `could not write the watch feed to stdout: ${
                err.cause instanceof Error
                  ? err.cause.message
                  : String(err.cause)
              }`,
            ),
          ),
    ),
  );
};

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
      const only =
        args.id === undefined
          ? undefined
          : yield* resolveTerminal(conn, args.id);

      const lines = yield* Queue.unbounded<string, Cause.Done>();
      const emit = (line: string): void => {
        Queue.offerUnsafe(lines, line);
      };
      /** Why the mirror REJECTED, if it did — the only thing upstream ever says
       *  that genuinely names a failure. The `log` lines below are chatter by
       *  contract (`MirrorRemoteSurfaceOptions.log`: "routine narration a
       *  consumer may filter freely — a link ending, a reconnect"), so latching
       *  the first of THOSE would report an ordinary narration line as the
       *  reason the watch died. They still reach stderr as they happen; they
       *  just don't get to speak for the ending. */
      let rejection: string | undefined;

      // Aborted when stdout dies under us — the local half of "stop the watch";
      // the other half is fiber interruption. Whether that death was a hangup or
      // a real write failure rides the pump's error channel, joined below.
      const stopped = new AbortController();
      const pump = yield* Effect.forkChild(
        pumpToStdout(lines, () => stopped.abort()),
      );

      yield* Effect.catch(
        Effect.tryPromise({
          // `interrupted` is the signal Effect derives from THIS fiber's
          // interruption, so a Ctrl+C at the run edge reaches the mirror
          // without a single `process.on` in this file. Combined with the
          // stdout-death signal because both mean "stop", and the mirror takes
          // one.
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
              AbortSignal.any([interrupted, stopped.signal]),
              (line) => {
                process.stderr.write(`kolu: ${line}\n`);
              },
            ),
          catch: (err) => err,
        }),
        // A rejection and a self-settle are the same fact — the watch is over —
        // so both land on the one ending below; the rejection just names itself.
        (err) =>
          Effect.sync(() => {
            rejection = err instanceof Error ? err.message : String(err);
          }),
      );

      // Read the discrimination HERE, at the instant the mirror ended, not after
      // the flush: a stdout death always precedes the settle it causes (it is
      // what aborts the mirror), so this is exactly "nobody local asked" — and a
      // reader that hangs up during the final flush can no longer erase a link
      // drop that had already happened.
      const selfSettled = !stopped.signal.aborted;

      // Stop producing and FLUSH what is already queued before leaving: a
      // `watch` that dropped its last lines on the way out is indistinguishable
      // from one that never saw the event.
      yield* Queue.end(lines);
      // A dead-stdout failure is the pump's, and this join is where it becomes
      // the verb's — before the link test below, because "I could not print what
      // I saw" outranks "the feed ended" as the thing that went wrong.
      yield* Fiber.join(pump);

      // The mirror settled and nothing local asked it to — the link dropped.
      if (selfSettled) {
        return yield* Effect.fail(failure(rejection ?? LINK_CLOSED));
      }
    }),
  );
}
