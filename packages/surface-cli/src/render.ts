/**
 * The OUTPUT DISCIPLINE — what lands on stdout, what lands on stderr, and in
 * what shape.
 *
 *   - **stdout is DATA.** One JSON value for a one-shot read, one compact JSON
 *     line per frame for anything streamed (ndjson). Nothing else ever goes
 *     there: a diagnostic on stdout is a corrupted pipe.
 *   - **stderr is PROSE** — and the one exception proves it: a verb's declared
 *     refusal is JSON on stderr, because it is machine-readable data that is
 *     nonetheless not the verb's answer (`exit.ts`'s `refused`).
 *   - **A TTY gets indentation, a pipe gets compact.** `JSON.stringify(v, null,
 *     2)` is for a human reading a terminal; a pipe is read by a program that
 *     does not care and by a `wc -c` that does. ndjson is compact either way —
 *     a "line" with newlines in it is not a line.
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
 * revoked descriptor) is real and is reported, because a write that vanished is
 * the silent degradation this repo treats as a defect.
 */

import { Effect, Stream } from "effect";
import { Stdio } from "effect";

/** Did the consumer hang up (`… | head -1`), or did the write genuinely fail?
 *  `EPIPE` is the reader leaving; anything else must be said out loud. */
function isConsumerHangup(cause: unknown): boolean {
  const code = (cause as { readonly cause?: { readonly code?: unknown } })
    ?.cause?.code;
  if (code === "EPIPE") return true;
  return (cause as { readonly code?: unknown })?.code === "EPIPE";
}

/** Write one chunk to stdout, treating a hung-up reader as a complete run. */
export function out(text: string): Effect.Effect<void, never, Stdio.Stdio> {
  return Effect.gen(function* () {
    const stdio = yield* Stdio.Stdio;
    yield* Effect.catchCause(
      Stream.run(Stream.make(text), stdio.stdout({ endOnDone: false })),
      (cause) =>
        isConsumerHangup(cause) ? Effect.void : Effect.failCause(cause),
    ).pipe(Effect.orDie);
  });
}

/** Write one prose line to stderr. A trailer that cannot reach a closed stderr
 *  is not worth failing a command over, so this never fails. */
export function err(text: string): Effect.Effect<void, never, Stdio.Stdio> {
  return Effect.gen(function* () {
    const stdio = yield* Stdio.Stdio;
    yield* Effect.ignore(
      Stream.run(Stream.make(text), stdio.stderr({ endOnDone: false })),
    );
  });
}

/** THE one-shot data frame: the value as JSON, indented on a TTY and compact
 *  through a pipe, newline-terminated. */
export function data(value: unknown): Effect.Effect<void, never, Stdio.Stdio> {
  return Effect.gen(function* () {
    const stdio = yield* Stdio.Stdio;
    const tty = yield* stdio.stdoutIsTerminal;
    yield* out(`${json(value, tty)}\n`);
  });
}

/** ONE ndjson line — always compact, whatever stdout is attached to: a frame
 *  that spans lines is not a frame a reader can split on. */
export function frame(value: unknown): Effect.Effect<void, never, Stdio.Stdio> {
  return out(`${json(value, false)}\n`);
}

/** The serialization both writers share. `undefined` (a void procedure's
 *  answer) becomes an explicit `null`, so a successful run is never silent. */
export function json(value: unknown, indent: boolean): string {
  return JSON.stringify(value, null, indent ? 2 : undefined) ?? "null";
}
