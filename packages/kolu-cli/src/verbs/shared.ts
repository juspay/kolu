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

import {
  isWaitState,
  type WaitState,
} from "@kolu/terminal-vocab/agentProjection";
import type { PadiSurfaceClient } from "@kolu/padi/dial";
import {
  terminateWatchLine,
  writeFlushedLine as writeFlushed,
} from "@kolu/padi/dial";
import { readTerminalKeys } from "@kolu/padi/read";
import { resolveTerminalId, shortId } from "@kolu/padi/render";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { Data, Effect, type Sink, Stream } from "effect";
// The SUBPATH, not the `@effect/platform-node` barrel — see `main.ts`'s import
// header. Every verb goes through this module, so a barrel here would hand each
// one the HTTP server and cluster transports on the way to a writable stream.
import * as NodeSink from "@effect/platform-node/NodeSink";
import { type CliFailure, errorMessage, failure } from "../exit.ts";

/** How a bucket list is SPELLED on a command line: comma-separated, any-of,
 *  case- and space-insensitive, empty tokens dropped. `undefined` when it names
 *  nothing or names something that is not a bucket.
 *
 *  The tokenizer, not the sentence. What a bucket IS belongs to the shared
 *  vocabulary (`isWaitState`); what a REJECTION reads like belongs to the flag,
 *  because `--until`'s three condition forms and `--states`' bucket list are
 *  different things to be told — which is why this hands back `undefined`
 *  rather than a message. What was left over is this five-line policy, and it
 *  had two copies in one package the moment `--states` landed: `--until` and
 *  `--states` could then silently come to accept different spellings of the
 *  same list.
 *
 *  Returns the tokens (not a Set) so a caller can put them on the wire in the
 *  order the user wrote them. */
export function waitStateTokens(raw: string): readonly WaitState[] | undefined {
  const tokens = raw
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0);
  if (tokens.length === 0 || !tokens.every(isWaitState)) return undefined;
  return tokens;
}

/** A PURE argv parse: the value it decoded, or the sentence that says why it
 *  was refused.
 *
 *  One declaration for every verb that decides something BEFORE it dials —
 *  `kolu wait`'s `--until`, `kolu watch`'s `--states`/`--held-for`/`--nag`. The
 *  shape is the whole point (a rejection is a VALUE here, not a throw, so the
 *  refusal happens before a `--host` has ssh-provisioned a cold box), and one
 *  concept spelled twice in sibling verbs is the copy that drifts. */
export type Parsed<T> =
  | { readonly kind: "ok"; readonly value: T }
  | { readonly kind: "error"; readonly message: string };

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
function resolveOne(
  query: string,
  ids: readonly TerminalId[],
  flag: string | undefined,
): Effect.Effect<TerminalId, CliFailure> {
  // The ONE thing that varies between the verb's SUBJECT id and an id passed as
  // one of two arguments: whether the sentence names the flag it came from. A
  // message label is not volatility — decomposing around it is what produced a
  // second copy of this whole algorithm in `create.ts` (`--parent`), carrying a
  // prefix.
  const where = flag === undefined ? "" : `${flag}: `;
  const result = resolveTerminalId(query, ids);
  if (result.kind === "found") return Effect.succeed(result.id);
  if (result.kind === "none") {
    return Effect.fail(
      failure(
        `${where}no terminal matching "${query}" — \`kolu ls\` shows the live ones.`,
      ),
    );
  }
  return Effect.fail(
    failure(
      `${where}"${query}" matches ${result.matches.length} terminals — type more characters:\n  ${result.matches
        .map(shortId)
        .join("\n  ")}`,
    ),
  );
}

/** Read the live key set and resolve `query` against it — the two steps every
 *  id-taking verb runs before its real call, spelled once. The pure half
 *  ({@link resolveOne}) has no caller outside this module, so it stays private:
 *  a verb resolves through this pair or not at all.
 *
 *  It asks for a `client`, never the whole `Connection`: the other fact a
 *  `Connection` carries (`localCwd`) belongs to `create` alone, and a resolve
 *  that could not read it cannot come to depend on it. Spelled as the field
 *  rather than as the type so the requirement is the narrowest thing that works
 *  — the same parameter its twin `readTerminalKeys` takes — while a caller still
 *  passes the `conn` it already has in hand.
 *
 *  `flag` names the option the id came from, for the case where it is one of
 *  two arguments rather than the verb's subject (`kolu create --parent 3f9`);
 *  omit it for the subject. `create` used to own a whole second copy of the
 *  read-resolve-branch algorithm to carry that one prefix. */
export function resolveTerminal(
  conn: { readonly client: PadiSurfaceClient },
  query: string,
  opts: { readonly flag?: string } = {},
): Effect.Effect<TerminalId, unknown> {
  return Effect.flatMap(readTerminalKeys(conn.client), (ids) =>
    resolveOne(query, ids, opts.flag),
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
 *  loud rather than folded into the same silent success.
 *
 *  EXPORTED, and so is {@link stdoutSink} and {@link stdoutLost} beside it: a
 *  one-shot block and a live feed differ in SHAPE, not in what can go wrong with
 *  a descriptor, so `watch.ts` plugs the same three values into a streaming
 *  consumption. It used to say exactly that in a comment while writing them out
 *  a second time — and a comment asserting two things are the same is a
 *  convention, not a constraint. */
export const isConsumerHangup = (cause: unknown): boolean =>
  (cause as { readonly code?: unknown })?.code === "EPIPE";

/** Backpressure-aware stdout, as a SINK.
 *
 *  A sink rather than a bare `process.stdout.write` because a large payload
 *  (`--json` over a busy host, a full scrollback, a live feed into `| less`)
 *  must flush before the process exits, or the tail is silently truncated — the
 *  sink waits on `drain` for us, so a slow consumer slows the producer instead
 *  of inflating an in-memory backlog. `endOnDone: false` because this process
 *  does not own `process.stdout`'s lifetime: a sink that ended it would close
 *  the shell's own descriptor. */
export const stdoutSink: Sink.Sink<void, string, never, StdoutWriteFailed> =
  NodeSink.fromWritable<StdoutWriteFailed, string>({
    evaluate: () => process.stdout,
    onError: (cause) => new StdoutWriteFailed({ cause }),
    endOnDone: false,
  });

export { terminateWatchLine };

export const writeFlushedLine = (
  writable: NodeJS.WritableStream,
  payload: string,
): Effect.Effect<void, StdoutWriteFailed> =>
  writeFlushed(writable, payload, (cause) => new StdoutWriteFailed({ cause }));

export const writeStdoutLine = (
  payload: string,
): Effect.Effect<void, StdoutWriteFailed> =>
  writeFlushedLine(process.stdout, payload);

/** The ONE sentence for a stdout that genuinely died. `what` names the payload,
 *  so a real write error says which output was lost rather than a generic
 *  "write failed" — a user must not have to learn two spellings of "kolu could
 *  not write to stdout". */
export const stdoutLost = (what: string, cause: unknown): CliFailure =>
  failure(`could not write ${what} to stdout: ${errorMessage(cause)}`);

/** Write the verb's DATA to stdout, treating a hung-up reader as a complete run. */
export function writeOut(
  text: string,
  what: string,
): Effect.Effect<void, CliFailure> {
  const write: Effect.Effect<void, StdoutWriteFailed> = Stream.run(
    Stream.make(text),
    stdoutSink,
  );
  return Effect.catchTag(write, "StdoutWriteFailed", (err) =>
    isConsumerHangup(err.cause)
      ? // The reader left — that is a complete verb, not an error to report.
        Effect.void
      : Effect.fail(stdoutLost(what, err.cause)),
  );
}

/** Write one block with exactly ONE trailing newline — the rule for a text
 *  payload that may or may not already end in one (a screen, a scrollback
 *  page). Both verbs that print blocks had their own identical copy of this and
 *  each docstring called it "this verb's"; it belongs to neither. */
export const writeOutBlock = (
  text: string,
  what: string,
): Effect.Effect<void, CliFailure> =>
  writeOut(text.endsWith("\n") ? text : `${text}\n`, what);

/** THE `--json` frame: one pretty-printed object, newline-terminated, drained.
 *
 *  A constant doing what a comment used to do. Four `--json` arms each spelled
 *  `JSON.stringify(x, null, 2)` + `"\n"`, and one of them documented the
 *  coupling in prose ("2-space indented like the other verbs' frames"). If the
 *  frame ever gains a key or stops pretty-printing, that was four edits with
 *  nothing to fail if one was missed. */
export const writeJson = (
  value: unknown,
  what: string,
): Effect.Effect<void, CliFailure> =>
  writeOut(`${JSON.stringify(value, null, 2)}\n`, what);

/** stderr is the out-of-band channel — trailers and diagnostics, never the
 *  scriptable payload — so a plain synchronous write is the whole mechanism. A
 *  trailer that fails to reach a closed stderr is not worth failing a verb over.
 */
export function writeErr(text: string): Effect.Effect<void> {
  return Effect.sync(() => {
    writeErrSync(text);
  });
}

/** The same write for a SYNCHRONOUS caller — a mirror's `log` callback, which
 *  cannot yield an Effect. Exported so the one stderr writer in the verb layer
 *  stays one; `watch.ts` used to reach `process.stderr.write` directly and
 *  re-spell the `kolu: ` prefix inline. (`main.ts` still writes raw, and that is
 *  correct: it is the run edge, outside the verb layer, and must not depend on
 *  `verbs/`.) */
export const writeErrSync = (text: string): void => {
  process.stderr.write(text);
};
