import { fstatSync, readFileSync } from "node:fs";
import { text as readStdinText } from "node:stream/consumers";
import { shortId } from "@kolu/padi/render";
import {
  type SendContent,
  encodeSend,
  type SendPlan,
  sendShapeRefusal,
  type SendVocabulary,
} from "@kolu/terminal-protocol";
import { Effect } from "effect";
import type { Command } from "effect/cli";
import type { sendFlags } from "../cli.ts";
import { type Endpoint, withPadi } from "../endpoint.ts";
import { blankFlag, type CliFailure, failure, isBlank } from "../exit.ts";
import { resolveTerminal, writeErr, writeJson } from "./shared.ts";

export type SendArgs = Command.Command.Config.Infer<typeof sendFlags>;

export const SUBMIT_FLOW_HELP =
  "  kolu send <id> --file brief.md      # 1. the text\n" +
  "  kolu wait <id> --until idle:300     # 2. observe the TUI settle\n" +
  "  kolu send <id> --key Enter          # 3. submit";

export type SendInput =
  | { readonly kind: "positional" }
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "stdin" }
  | { readonly kind: "none" };

export function sourceIsStream(input: SendInput): boolean {
  switch (input.kind) {
    case "file":
    case "stdin":
      return true;
    case "positional":
    case "none":
      return false;
  }
}

export function sourceLabel(input: SendInput): string {
  switch (input.kind) {
    case "positional":
      return "positional text";
    case "file":
      return `--file ${JSON.stringify(input.path)}`;
    case "stdin":
      return "piped stdin";
    case "none":
      return "no text source";
  }
}

export function resolveSendInput(opts: {
  readonly hasPositional: boolean;
  readonly file: string | undefined;
  readonly stdin: StdinSource;
  readonly hasKeys: boolean;
}): Effect.Effect<SendInput, CliFailure> {
  if (opts.file !== undefined && isBlank(opts.file)) {
    return Effect.fail(
      blankFlag("--file", "the file to read the send text from"),
    );
  }

  const present: SendInput[] = [];
  if (opts.hasPositional) present.push({ kind: "positional" });
  if (opts.file !== undefined) present.push({ kind: "file", path: opts.file });
  if (opts.stdin !== "none") present.push({ kind: "stdin" });
  if (present.length > 1) {
    return Effect.fail(
      failure(
        `${present.map(sourceLabel).join(" and ")} each provide the send text — pass exactly one source, not several.`,
      ),
    );
  }
  const input: SendInput = present[0] ?? { kind: "none" };

  const illegal = sendShapeRefusal(
    { hasText: input.kind !== "none", hasKeys: opts.hasKeys },
    SEND_VOCABULARY,
  );
  if (illegal !== undefined) return Effect.fail(failure(illegal));

  if (input.kind === "none" && !opts.hasKeys) {
    return Effect.fail(
      failure(
        'nothing to send — pass text, use --file <path>, pipe it on stdin, or use --key (e.g. `kolu send <id> "hello"` or `kolu send <id> --key Escape`).',
      ),
    );
  }

  return Effect.succeed(input);
}

export type StdinSource = "fifo" | "file" | "none";

export function stdinSource(): StdinSource {
  try {
    const st = fstatSync(0);
    if (st.isFIFO()) return "fifo";
    if (st.isFile()) return "file";
    return "none";
  } catch {
    return "none";
  }
}

/** Decode a stream payload — a `--file` read or a drained stdin — as UTF-8. Both
 *  stream sources go through the SAME decoder so `kolu send <id> --file brief.md`
 *  and `kolu send <id> < brief.md` put identical bytes on the wire; they are the
 *  same payload by every other rule here (both auto-paste as one block), so they
 *  must not disagree about their first character.
 *
 *  That character is the reason this exists: `TextDecoder` STRIPS a leading UTF-8
 *  BOM, `Buffer.toString("utf8")` keeps it. Stripping is the right call for a
 *  send — the BOM is an encoding preamble, not content, and forwarded verbatim it
 *  lands in the agent's input box as an invisible zero-width character ahead of
 *  the prompt, where it can silently defeat a leading `/command` match. The rest
 *  of the payload is still byte-exact: no shell in the loop, so backticks and
 *  `$( )` reach the wire untouched. */
const decodeUtf8 = (bytes: Uint8Array): string =>
  new TextDecoder().decode(bytes);

function readSendText(
  input: SendInput,
  textArgs: readonly string[],
): Effect.Effect<string, CliFailure> {
  switch (input.kind) {
    case "positional":
      return Effect.succeed(textArgs.join(" "));
    case "stdin":
      return Effect.tryPromise({
        try: () => readStdinText(process.stdin),
        catch: (err) =>
          failure(
            `could not read the send text from stdin: ${err instanceof Error ? err.message : String(err)}`,
          ),
      });
    case "file":
      return Effect.try({
        try: () => decodeUtf8(readFileSync(input.path)),
        catch: (err) => {
          const e = err as NodeJS.ErrnoException;
          return failure(
            `--file ${JSON.stringify(input.path)}: ${e.code === "ENOENT" ? "no such file" : e.message}`,
          );
        },
      });
    case "none":
      return Effect.succeed("");
  }
}

const SEND_VOCABULARY: SendVocabulary = {
  keyName: "--key",
  submitRitual: SUBMIT_FLOW_HELP,
};

export function planSend(
  content: SendContent,
): Effect.Effect<SendPlan, CliFailure> {
  const encoded = encodeSend(content, SEND_VOCABULARY);
  return encoded.kind === "plan"
    ? Effect.succeed(encoded.plan)
    : Effect.fail(failure(encoded.message));
}

export function formatSend(result: {
  readonly id: string;
  readonly bytes: number;
  readonly paste: boolean;
  readonly keys: readonly string[];
}): string {
  const base = `sent ${result.bytes} byte${result.bytes === 1 ? "" : "s"} to ${shortId(result.id)}`;
  const pasteMark = result.paste ? " · pasted" : "";
  const keysMark =
    result.keys.length > 0 ? ` · keys: ${result.keys.join(", ")}` : "";
  return `${base}${pasteMark}${keysMark}`;
}

export const SEND_WRITE_DEADLINE_MS = 8_000;

export function executeSendPlan<E>(
  plan: SendPlan,
  write: (data: string) => Effect.Effect<void, E>,
  target: string,
): Effect.Effect<void, E | CliFailure> {
  return Effect.timeoutOrElse(write(plan.write), {
    duration: SEND_WRITE_DEADLINE_MS,
    orElse: () =>
      Effect.fail(
        failure(
          `write to terminal ${target} stalled — no acknowledgement within ${SEND_WRITE_DEADLINE_MS}ms. The terminal is not draining its input (a program that has stopped reading stdin?). Aborting rather than hanging.`,
        ),
      ),
  });
}

export function run(
  endpoint: Endpoint,
  args: SendArgs,
): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    const input = yield* resolveSendInput({
      hasPositional: args.text.length > 0,
      file: args.file,
      stdin: stdinSource(),
      hasKeys: args.key.length > 0,
    });

    const text = yield* readSendText(input, args.text);

    const plan = yield* input.kind === "none"
      ? planSend({ kind: "keys", names: args.key })
      : planSend({
          kind: "text",
          text,
          sourceLabel: sourceLabel(input),
          paste: args.paste,
          fromStream: sourceIsStream(input),
        });

    yield* withPadi(endpoint, (conn) =>
      Effect.gen(function* () {
        const id = yield* resolveTerminal(conn, args.id);
        yield* executeSendPlan(
          plan,
          (data) => conn.client.surface.lifecycle.sendInput({ id, data }),
          shortId(id),
        );

        const result = {
          id,
          bytes: plan.bytes,
          paste: plan.paste,
          keys: args.key,
        };
        if (args.json) return yield* writeJson(result, "the send result");
        yield* writeErr(`— ${formatSend(result)}\n`);
      }),
    );
  });
}
