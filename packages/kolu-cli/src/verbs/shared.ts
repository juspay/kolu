/**
 * What every terminal verb needs and none of them should own a copy of: turning
 * a user-typed id-or-prefix into the one full id it names, and getting bytes
 * onto stdout/stderr under the CLI's output discipline.
 *
 * The pure halves already live one layer down and are NOT re-implemented here —
 * `resolveTerminalId` (the prefix/exact/ambiguous decision) and `shortId` are
 * `@kolu/padi/render`'s, shared with padi-tui. What this module adds is the
 * kolu-CLI-shaped wrapper around them: the sentences a user reads when the id
 * was wrong, which name `kolu ls` as the way to see the live ones.
 */

import { readTerminalKeys } from "@kolu/padi/read";
import { resolveTerminalId, shortId } from "@kolu/padi/render";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { Data, Effect, Stream } from "effect";
import { NodeSink } from "@effect/platform-node";
import type { Connection } from "../endpoint.ts";
import { type CliFailure, failure } from "../exit.ts";

/** Widen a user-typed id-or-prefix to the one full id it names, or fail with the
 *  sentence that says which kind of "no" this was.
 *
 *  `<id>` accepts any unique PREFIX because the 8-char short id `kolu ls` prints
 *  is the form a human actually has in hand, while padi's contract validates a
 *  full uuid — something has to widen one to the other, and doing it here is
 *  also the only place the CLI can be HONEST about a mistyped id. A prefix
 *  handed straight to padi would come back as an opaque schema-decode error
 *  rather than `no terminal matching "3f9"`.
 *
 *  Neither wrong-id case may be a quiet success: a verb that matched nothing and
 *  exited 0 reads, to the driving loop above it, exactly like one that worked.
 *  Ambiguity lists the matches in the short form the user already recognizes, so
 *  adding characters is a glance rather than a second `kolu ls`. */
export function resolveOne(
  query: string,
  ids: readonly TerminalId[],
): Effect.Effect<TerminalId, CliFailure> {
  const result = resolveTerminalId(query, ids);
  if (result.kind === "found") return Effect.succeed(result.id);
  if (result.kind === "none") {
    return Effect.fail(
      failure(
        `no terminal matching "${query}" — \`kolu ls\` shows the live ones.`,
      ),
    );
  }
  return Effect.fail(
    failure(
      `"${query}" matches ${result.matches.length} terminals — type more characters:\n  ${result.matches
        .map(shortId)
        .join("\n  ")}`,
    ),
  );
}

/** Read the live key set and resolve `query` against it — the two steps every
 *  id-taking verb runs before its real call, spelled once. */
export function resolveTerminal(
  conn: Connection,
  query: string,
): Effect.Effect<TerminalId, unknown> {
  return Effect.flatMap(readTerminalKeys(conn.client), (ids) =>
    resolveOne(query, ids),
  );
}

/** stdout died mid-write. Carries node's own error so the two cases below can be
 *  told apart — they are NOT the same event wearing different codes. */
export class StdoutWriteFailed extends Data.TaggedError("StdoutWriteFailed")<{
  readonly cause: unknown;
}> {}

/** Did the consumer hang up (`kolu ls | head -1`), or did the write genuinely
 *  fail (a full disk, a revoked descriptor)? EPIPE means the reader got what it
 *  asked for and left; anything else is a real failure that must be said out
 *  loud rather than folded into the same silent success. */
const isConsumerHangup = (cause: unknown): boolean =>
  (cause as { readonly code?: unknown })?.code === "EPIPE";

/** Write one block to stdout, DRAINING first.
 *
 *  A sink rather than a bare `process.stdout.write` because a large payload
 *  (`--json` over a busy host, a full scrollback) into a pipe must flush before
 *  the process exits, or the tail is silently truncated — the sink waits on
 *  `drain` for us. `endOnDone: false` because this process does not own
 *  `process.stdout`'s lifetime: a sink that ended it would close the shell's own
 *  descriptor. */
const writeStdout = (text: string): Effect.Effect<void, StdoutWriteFailed> =>
  Stream.run(
    Stream.make(text),
    NodeSink.fromWritable<StdoutWriteFailed, string>({
      evaluate: () => process.stdout,
      onError: (cause) => new StdoutWriteFailed({ cause }),
      endOnDone: false,
    }),
  );

/** Write the verb's DATA to stdout, treating a hung-up reader as a complete run.
 *
 *  `what` names the payload for the failure line, so a real write error says
 *  which output was lost rather than a generic "write failed". */
export function writeOut(
  text: string,
  what: string,
): Effect.Effect<void, CliFailure> {
  return Effect.catchTag(writeStdout(text), "StdoutWriteFailed", (err) =>
    isConsumerHangup(err.cause)
      ? // The reader left — that is a complete verb, not an error to report.
        Effect.void
      : Effect.fail(
          failure(
            `could not write ${what} to stdout: ${
              err.cause instanceof Error ? err.cause.message : String(err.cause)
            }`,
          ),
        ),
  );
}

/** stderr is the out-of-band channel — trailers and diagnostics, never the
 *  scriptable payload — so a plain synchronous write is the whole mechanism. A
 *  trailer that fails to reach a closed stderr is not worth failing a verb over.
 */
export function writeErr(text: string): Effect.Effect<void> {
  return Effect.sync(() => {
    process.stderr.write(text);
  });
}
