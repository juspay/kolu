/**
 * The `Stdio` SEAM, both directions — what lands on stdout and in what shape,
 * and the one read of stdin this face makes.
 *
 * Both halves are here because both are the same seam and the same reason for
 * it (below): `--json -` reads its payload through the service every handler
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
 *   - **A human on a terminal may get PROSE**, and a pipe never does — see
 *     {@link present}. The branch lives HERE, once, so no caller has to ask what
 *     stdout is attached to and changing the rule does not edit the projection.
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
 * a `Sink`, which is the part that matters: a large payload (`--json` over a
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
import { Cause, Effect, Result, Stdio, Stream } from "effect";
import { EXIT, SurfaceCliFailure } from "./exit";

/** Did the consumer hang up (`… | head -1`), or did the write genuinely fail?
 *
 *  Takes the FAILURE, not the cause it arrived in: `Effect.catchCause` hands
 *  over a `Cause`, whose own shape carries no `code` at all, so a predicate
 *  reading `code` off it matches nothing and the EPIPE arm is dead — every
 *  hung-up reader would die instead of exiting 0. {@link out} unwraps first.
 *
 *  The `code` sits one level in, on the platform error's own `cause`, which is
 *  where Node's `EPIPE` lands after the sink wraps it; the direct reading is
 *  kept beside it for a platform that raises the errno flat. */
function isConsumerHangup(failure: unknown): boolean {
  const nested = (failure as { readonly cause?: { readonly code?: unknown } })
    ?.cause?.code;
  if (nested === "EPIPE") return true;
  return (failure as { readonly code?: unknown })?.code === "EPIPE";
}

/** Write one chunk to stdout, treating a hung-up reader as a complete run. */
export function out(text: string): Effect.Effect<void, never, Stdio.Stdio> {
  return Effect.gen(function* () {
    const stdio = yield* Stdio.Stdio;
    yield* Effect.catchCause(
      Stream.run(Stream.make(text), stdio.stdout({ endOnDone: false })),
      (cause) => {
        const failure = Cause.findError(cause);
        return Result.isSuccess(failure) && isConsumerHangup(failure.success)
          ? Effect.void
          : Effect.failCause(cause);
      },
    ).pipe(Effect.orDie);
  });
}

/** THE one-shot data frame: the value as JSON, indented on a TTY and compact
 *  through a pipe, newline-terminated. */
export function data(value: unknown): Effect.Effect<void, never, Stdio.Stdio> {
  return Effect.gen(function* () {
    const tty = yield* (yield* Stdio.Stdio).stdoutIsTerminal;
    yield* out(`${json(value, tty)}\n`);
  });
}

/** ONE ndjson line — always compact, whatever stdout is attached to: a frame
 *  that spans lines is not a frame a reader can split on. */
export function frame(value: unknown): Effect.Effect<void, never, Stdio.Stdio> {
  return out(`${json(value, false)}\n`);
}

/** Prose for a HUMAN on a terminal, the JSON data through a pipe — the one
 *  place "a pipe always gets JSON" is decided, so no caller has to ask what
 *  stdout is attached to.
 *
 *  That is why there is no flag to force JSON: a script never has to remember
 *  one, `--json` on a verb keeps its single meaning (the whole input), and a
 *  human who wants the JSON pipes it. A caller with no renderer to offer passes
 *  none and always gets the data frame. */
export function present(
  value: unknown,
  render?: (value: unknown) => string,
): Effect.Effect<void, never, Stdio.Stdio> {
  return Effect.gen(function* () {
    if (render === undefined) return yield* data(value);
    const tty = yield* (yield* Stdio.Stdio).stdoutIsTerminal;
    if (!tty) return yield* data(value);
    const text = render(value);
    yield* out(text.endsWith("\n") ? text : `${text}\n`);
  });
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

/** The whole of stdin, as text — what `--json -` means.
 *
 *  Read through the `Stdio` service rather than off fd 0, for the same reason
 *  everything above WRITES through it: `Command.run` already requires it, so a
 *  handler that reads its own stdin stays inside the Effect that bounds it (a
 *  Ctrl-C mid-read interrupts the read) and a test can hand it a stream instead
 *  of a global descriptor.
 *
 *  A read that FAILS is not an empty payload. Collapsing the two reported "that
 *  is not JSON" for a descriptor that was never readable — blaming a payload
 *  nobody supplied — so the failure keeps its own words. */
export const readStdin: Effect.Effect<string, SurfaceCliFailure, Stdio.Stdio> =
  Effect.gen(function* () {
    const stdio = yield* Stdio.Stdio;
    return yield* Effect.catch(
      Stream.decodeText(stdio.stdin).pipe(Stream.mkString),
      (cause) =>
        Effect.fail(
          new SurfaceCliFailure({
            stderr: `could not read stdin for --json -: ${messageOf(cause)}\n`,
            code: EXIT.usage,
          }),
        ),
    );
  });
