import * as NodeSink from "@effect/platform-node/NodeSink";
import { readTerminalKeys } from "@kolu/padi/read";
import { shortId } from "@kolu/padi/render";
import { resolveTerminalId } from "@kolu/padi-client/terminalId";
import type { PadiSurfaceClient } from "@kolu/padi-client/dial";
import type { Parsed } from "@kolu/padi-client/watchDuration";
import { isConsumerHangup } from "@kolu/surface-cli";
import {
  isWaitState,
  WAIT_STATES,
  type WaitState,
} from "@kolu/terminal-vocab/agentProjection";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { Data, Effect, type Sink, Stream } from "effect";
import { type CliFailure, errorMessage, failure } from "../exit.ts";

export function waitStateTokens(raw: string): Parsed<readonly WaitState[]> {
  const tokens = raw
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0);
  if (tokens.length === 0 || !tokens.every(isWaitState)) {
    return {
      kind: "error",
      message: `${JSON.stringify(raw)} is not a list of agent buckets. Pick from ${WAIT_STATES.join(", ")}, comma-separated (any-of).`,
    };
  }
  return { kind: "ok", value: tokens };
}

export type { Parsed };

export function resolveTerminalIn(
  query: string,
  ids: readonly TerminalId[],
  opts: { readonly flag?: string } = {},
): Effect.Effect<TerminalId, CliFailure> {
  const flag = opts.flag;
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
  return Effect.fail(failure(ambiguousTerminal(query, result.matches, flag)));
}

export function ambiguousTerminal(
  query: string,
  matches: readonly TerminalId[],
  flag?: string,
): string {
  const where = flag === undefined ? "" : `${flag}: `;
  return `${where}"${query}" matches ${matches.length} terminals — type more characters:\n  ${matches
    .map(shortId)
    .join("\n  ")}`;
}

export function resolveTerminal(
  conn: { readonly client: PadiSurfaceClient },
  query: string,
  opts: { readonly flag?: string } = {},
): Effect.Effect<TerminalId, unknown> {
  return Effect.flatMap(readTerminalKeys(conn.client), (ids) =>
    resolveTerminalIn(query, ids, opts),
  );
}

export class StdoutWriteFailed extends Data.TaggedError("StdoutWriteFailed")<{
  readonly cause: unknown;
}> {}

export { isConsumerHangup };

export const stdoutSink: Sink.Sink<
  void,
  string | Uint8Array,
  never,
  StdoutWriteFailed
> = NodeSink.fromWritable<StdoutWriteFailed, string | Uint8Array>({
  evaluate: () => process.stdout,
  onError: (cause) => new StdoutWriteFailed({ cause }),
  endOnDone: false,
});

const stdoutLost = (what: string, cause: unknown): CliFailure =>
  failure(`could not write ${what} to stdout: ${errorMessage(cause)}`);

export function drainToStdout(
  source: Stream.Stream<string | Uint8Array>,
  what: string,
  onLost?: () => void,
): Effect.Effect<void, CliFailure> {
  const drain: Effect.Effect<void, StdoutWriteFailed> = Stream.run(
    source,
    stdoutSink,
  );
  return Effect.catchTag(drain, "StdoutWriteFailed", (err) =>
    Effect.flatMap(
      Effect.sync(() => onLost?.()),
      () =>
        isConsumerHangup(err.cause)
          ? Effect.void
          : Effect.fail(stdoutLost(what, err.cause)),
    ),
  );
}

export function writeOut(
  payload: string | Uint8Array,
  what: string,
): Effect.Effect<void, CliFailure> {
  return drainToStdout(Stream.make(payload), what);
}

export const writeOutBlock = (
  text: string,
  what: string,
): Effect.Effect<void, CliFailure> =>
  writeOut(text.endsWith("\n") ? text : `${text}\n`, what);

export const writeJson = (
  value: unknown,
  what: string,
): Effect.Effect<void, CliFailure> =>
  writeOut(`${JSON.stringify(value, null, 2)}\n`, what);

export function writeErr(text: string): Effect.Effect<void> {
  return Effect.sync(() => {
    writeErrSync(text);
  });
}

export const writeErrSync = (text: string): void => {
  process.stderr.write(text);
};

export const warn = (message: string): void => {
  writeErrSync(`kolu: ${message}\n`);
};
