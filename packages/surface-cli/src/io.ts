/**
 * The `Stdio` SEAM, both directions — what lands on stdout and in what shape,
 * and the one read of stdin this face makes.
 *
 * Both halves are here because both are the same seam and the same reason for
 * it (below): `--input -` reads its payload through the service every handler
 * already requires, exactly as every write goes out through it.
 *
 * ## The output discipline
 *
 *   - **stdout is DATA.** One JSON value for a one-shot read, one compact JSON
 *     line per frame for anything streamed (ndjson). Nothing else ever goes
 *     there: a diagnostic on stdout is a corrupted pipe.
 *   - **A TTY gets indentation, a pipe gets compact.** `JSON.stringify(v, null,
 *     2)` is for a human reading a terminal; a pipe is read by a program that
 *     does not care and by a `wc -c` that does. ndjson is compact either way —
 *     a "line" with newlines in it is not a line.
 *   - **A caller who did not ask for JSON may get PROSE** — see {@link present}.
 *     `--json` is what decides, and what stdout happens to be attached to
 *     decides nothing: the same command prints the same thing on a terminal, in
 *     a pipe and in a CI log. The branch lives HERE, once, so no caller has to
 *     ask, and changing the rule does not edit the projection.
 *   - **stderr is PROSE**, and it is the run EDGE's, not this module's: a
 *     failure carries the exact text it wants written (`exit.ts`) and the host
 *     writes it once, outside the command. A second stderr writer here would be
 *     a second policy about when a diagnostic is worth failing over. Nothing in
 *     this module serializes for a diagnostic line, either: {@link json} is half
 *     of the stdout contract and is private for that reason.
 *
 * ## Why the `Stdio` service and not `process.stdout`
 *
 * `Command.run` already requires `Stdio` (it is where argv comes from), so the
 * service is present at every handler and costs nothing to reach. It hands back
 * a `Sink`, which is the part that matters: a large payload (`--input` over a
 * busy host, a long scrollback, a live feed into `| less`) must FLUSH before the
 * process exits, or the tail is silently truncated — the sink waits on drain, so
 * a slow consumer slows the producer instead of inflating a backlog. And a
 * library that wrote to `process.stdout` directly could not be tested without
 * capturing a global.
 *
 * ## A hung-up reader is a COMPLETE run
 *
 * `surface watch nodes | head -1` closes the pipe under a live subscription.
 * That is the reader getting exactly what it asked for, not a failure — so an
 * `EPIPE` ends the command at exit 0. Every other write failure (a full disk, a
 * revoked descriptor) is real and DIES, loudly: a write that vanished is the
 * silent degradation this repo treats as a defect, and stdout is the one
 * channel a CLI cannot report the loss of on.
 */

import { messageOf } from "@kolu/surface/errors";
import { Cause, Data, Effect, Stdio, Stream } from "effect";

/** Did the consumer hang up (`… | head -1`), or did the write genuinely fail?
 *
 *  Takes the FAILURE, not the cause it arrived in: `Effect.catchCause` hands
 *  over a `Cause`, whose own shape carries no `code` at all, so a predicate
 *  reading `code` off it matches nothing and the EPIPE arm is dead — every
 *  hung-up reader would die instead of exiting 0. {@link out} unwraps first.
 *
 *  The `code` sits one level in, on the platform error's own `cause`, which is
 *  where Node's `EPIPE` lands after the sink wraps it; the direct reading is
 *  kept beside it for a platform that raises the errno flat.
 *
 *  KNOWN DIVERGENCE, recorded rather than worked around:
 *  `packages/kolu-cli/src/verbs/shared.ts` carries its own copy of this
 *  predicate that reads only the FLAT `code` — so it misses the nested reading,
 *  which is the one Node actually produces. This is the better reading, and it
 *  cannot be shared today: this package must not import an app package, and
 *  `kolu-cli` is deliberately not migrated onto this projection in this PR. The
 *  resolution is kolu-cli adopting THIS predicate when it mounts the projection.
 *  An implicit pair of half-right EPIPE tests is worse than a recorded one. */
function isConsumerHangup(failure: unknown): boolean {
  const nested = (failure as { readonly cause?: { readonly code?: unknown } })
    ?.cause?.code;
  if (nested === "EPIPE") return true;
  return (failure as { readonly code?: unknown })?.code === "EPIPE";
}

/** ONE run of ONE sink — the shape every write in this module takes.
 *
 *  Asking `Stdio` for a sink is not free: `@effect/platform-node-shared` builds
 *  a fresh Sink/Channel, registers and then deregisters an `error` listener on
 *  `process.stdout`, and spins up a pull loop — per sink. A `--follow` that took
 *  a new one PER LINE spent 7.4 µs of the 8.7 µs it cost to write a frame on the
 *  sink it immediately threw away; one sink for the whole subscription costs
 *  1.0 µs, which is 7× the throughput on a live feed. Nothing about the contract
 *  moves: the sink still waits on DRAIN (so a slow consumer slows the producer
 *  rather than inflating a backlog), interrupting the run still tears it down,
 *  and the hang-up rule below is still asked once — all three are properties of
 *  the RUN, never of a line.
 *
 *  A failed WRITE dies (see the header); the SOURCE's own failure is the far
 *  side answering and has to reach the caller's classifier as a typed failure.
 *  One run puts both in one `Cause`, so the source's is wrapped on the way in
 *  and unwrapped on the way out.
 *
 *  The wrap is necessary and not sufficient: a `--follow` whose reader hangs up
 *  can end with BOTH — the sink's `EPIPE` and the member's own refusal — in that
 *  one cause, so the whole cause is asked in PRIORITY ORDER rather than by
 *  taking the first failure it happens to hold. Reading the first one made the
 *  arm a function of cause ORDER: `EPIPE` first meant exit 0 and the verb's
 *  declared error gone from both channels.
 *
 *  The order is the rule, and it is unconditional. The SOURCE's failure wins: a
 *  reader that hung up got exactly what it asked for and has nothing further
 *  coming, while a verb that refused has an answer the caller must still see —
 *  so the run reports the refusal and the hang-up is what it always was, not a
 *  failure. Only when nothing but the hang-up is in the cause is the run
 *  complete at exit 0. */
function toStdout<E>(
  chunks: Stream.Stream<string, E>,
): Effect.Effect<void, E, Stdio.Stdio> {
  return Effect.gen(function* () {
    const stdio = yield* Stdio.Stdio;
    return yield* Effect.catchCause(
      Stream.run(
        Stream.mapError(chunks, (error) => new Upstream(error)),
        stdio.stdout({ endOnDone: false }),
      ),
      (cause) => {
        // EVERY failure in the cause, not the first one: one run can end with
        // the sink's hang-up AND the source's refusal, and which of the two
        // `Cause.findError` returns is a fact about how the causes were
        // combined, not about the run.
        const failures = cause.reasons
          .filter(Cause.isFailReason)
          .map((reason) => reason.error);
        const upstream = failures.find(
          (failure): failure is Upstream => failure instanceof Upstream,
        );
        if (upstream !== undefined) return Effect.fail(upstream.error as E);
        if (failures.some(isConsumerHangup)) return Effect.void;
        return Effect.orDie(Effect.failCause(cause));
      },
    );
  });
}

/** The SOURCE stream's own failure, carried across the run so it is not mistaken
 *  for a write that vanished — see {@link toStdout}. A plain carrier and not a
 *  tagged error: it exists for the length of one `Stream.run` and is unwrapped
 *  before anything else can see it. */
class Upstream {
  constructor(readonly error: unknown) {}
}

/** Write one chunk to stdout, treating a hung-up reader as a complete run. */
export function out(text: string): Effect.Effect<void, never, Stdio.Stdio> {
  return toStdout(Stream.make(text));
}

/** THE one-shot data frame: the value as JSON, indented on a TTY and compact
 *  through a pipe, newline-terminated. */
export function data(value: unknown): Effect.Effect<void, never, Stdio.Stdio> {
  return Effect.gen(function* () {
    const tty = yield* (yield* Stdio.Stdio).stdoutIsTerminal;
    yield* out(`${json(value, tty)}\n`);
  });
}

/** A whole SUBSCRIPTION as ndjson — one compact line per frame, and one sink for
 *  the run (see {@link toStdout}). Always compact, whatever stdout is attached
 *  to: a frame that spans lines is not a frame a reader can split on.
 *
 *  The stream comes HERE rather than the line going to the caller, because both
 *  halves of this belong to the module that owns the stdout contract: {@link
 *  json} is half of that contract and stays private, and the hang-up rule is
 *  about the RUN — `surface watch nodes | head -1` closes the pipe under a live
 *  feed, which is the reader getting exactly what it asked for. */
export function frames<E>(
  stream: Stream.Stream<unknown, E>,
): Effect.Effect<void, E, Stdio.Stdio> {
  return toStdout(Stream.map(stream, (value) => `${json(value, false)}\n`));
}

/** The author's PROSE, or the JSON answer whole — decided by the caller's
 *  `--json` and by nothing else.
 *
 *  It used to be decided by `stdoutIsTerminal`: prose to a terminal, data
 *  through a pipe. That made the output shape a fact about what the process
 *  happened to be attached to rather than about what was asked for — the same
 *  command printed two different things under `| tee`, under `script(1)`, and in
 *  a CI log, and neither shape could be asked for on purpose. The flag decides
 *  now (human, 2026-08-23), which is one rule a person can hold and a script can
 *  rely on. A caller with no renderer to offer passes none and always gets the
 *  data frame, `--json` or not — there is no summary to withhold.
 *
 *  What a TERMINAL still decides is inside {@link data} and is only ever
 *  INDENTATION: how a JSON answer is spaced, never which answer it is. */
export function present(
  value: unknown,
  render?: (value: unknown) => string,
  asJson = false,
): Effect.Effect<void, never, Stdio.Stdio> {
  if (render === undefined || asJson) return data(value);
  const text = render(value);
  return out(text.endsWith("\n") ? text : `${text}\n`);
}

/** The serialization every writer here shares. `undefined` (a void procedure's
 *  answer) becomes an explicit `null`, so a successful run is never silent.
 *
 *  PRIVATE: it is half of the stdout contract, not a general utility — a
 *  diagnostic line that borrowed it would be a second reader of a rule this
 *  module states as its own. */
function json(value: unknown, indent: boolean): string {
  return JSON.stringify(value, null, indent ? 2 : undefined) ?? "null";
}

// ── The one read ─────────────────────────────────────────────────────────

/** The whole of stdin, as text — what `--input -` means.
 *
 *  Read through the `Stdio` service rather than off fd 0, for the same reason
 *  everything above WRITES through it: `Command.run` already requires it, so a
 *  handler that reads its own stdin stays inside the Effect that bounds it (a
 *  Ctrl-C mid-read interrupts the read) and a test can hand it a stream instead
 *  of a global descriptor.
 *
 *  A read that FAILS is not an empty payload. Collapsing the two reported "that
 *  is not JSON" for a descriptor that was never readable — blaming a payload
 *  nobody supplied — so the failure keeps its own words.
 *
 *  It fails with a {@link StdinUnreadable} rather than with a worded failure,
 *  because THIS module does not know the binary's name and every diagnostic this
 *  face writes wears it. A module that built the sentence anyway produced the one
 *  line in the whole face with no `demo: ` in front of it. The caller, which has
 *  the name, words it. */
export const readStdin: Effect.Effect<string, StdinUnreadable, Stdio.Stdio> =
  Effect.gen(function* () {
    const stdio = yield* Stdio.Stdio;
    return yield* Effect.catch(
      Stream.decodeText(stdio.stdin).pipe(Stream.mkString),
      (cause) => Effect.fail(new StdinUnreadable({ why: messageOf(cause) })),
    );
  });

/** Stdin could not be read at all — a revoked descriptor, not an empty payload.
 *
 *  A VALUE, carrying only `why`: the sentence in front of it is the binary's
 *  name, which this module has no way to know (see {@link readStdin}). */
export class StdinUnreadable extends Data.TaggedError("StdinUnreadable")<{
  readonly why: string;
}> {}
