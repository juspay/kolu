import { StringDecoder } from "node:string_decoder";
import {
  isDeadTransportError,
  isSurfaceStdioTransportClosed,
} from "@kolu/surface/errors";
import { firstFrameOrUndefined } from "@kolu/surface/first-frame";
import { createTerminalResponseStripper } from "@kolu/terminal-protocol";
import { Data, Deferred, Effect, Fiber, Queue, Stream } from "effect";
import type { PtyTuiClient } from "./connect.ts";
import { createEscapeScanner } from "./escape.ts";

export interface AttachTty {
  input: NodeJS.ReadableStream;
  write(data: string): Effect.Effect<void>;
  size(): { cols: number; rows: number };
  onResize(cb: () => void): () => void;
  setRawMode(on: boolean): void;
}

export type AttachOutcome =
  | { kind: "not-found" }
  | { kind: "detached" }
  | { kind: "exited"; exitCode: number }
  | { kind: "error"; message: string };

export function helpText(escapeChar: string): string {
  const e = escapeChar;
  return (
    `\r\nkaval-tui escapes (recognised at line start only):\r\n` +
    `  ${e}.  detach — the daemon keeps the terminal\r\n` +
    `  ${e}${e}  send a literal ${e}\r\n` +
    `  ${e}?  this help\r\n`
  );
}

function describeError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (isSurfaceStdioTransportClosed(err) && err.death === "keepAliveUnanswered")
    return `the daemon may still be running and merely too busy (${message}) — re-run \`kaval-tui attach\`.`;
  if (
    isDeadTransportError(err) ||
    /transport is closed|ECONNRESET|EPIPE|socket/i.test(message)
  ) {
    return `the daemon went away mid-attach (${message}) — re-run \`kaval-tui attach\` once it's back.`;
  }
  return message;
}

function readExitCode(
  client: PtyTuiClient,
  id: string,
): Effect.Effect<number | undefined, unknown> {
  return Effect.map(
    firstFrameOrUndefined(client.surface.exit.get({ id })),
    (frame) => (frame as { exitCode?: number } | undefined)?.exitCode,
  );
}

export interface AttachOptions {
  escape?: string;
  tty: AttachTty;
}

type WireOp =
  | { readonly kind: "write"; readonly data: string }
  | { readonly kind: "resize"; readonly cols: number; readonly rows: number }
  | { readonly kind: "notice"; readonly text: string }
  | { readonly kind: "stop" };

class DroppedForLagging extends Data.TaggedError("DroppedForLagging")<{
  readonly id: string;
}> {}

class SnapshotContractViolation extends Data.TaggedError(
  "SnapshotContractViolation",
)<{ readonly message: string }> {}

type AttemptEnd =
  | { readonly kind: "re-attach" }
  | { readonly kind: "outcome"; readonly outcome: AttachOutcome };

export function runAttach(
  client: PtyTuiClient,
  id: string,
  opts: AttachOptions,
): Effect.Effect<AttachOutcome, unknown> {
  const { tty } = opts;
  const escapeChar = opts.escape ?? "~";
  return Effect.scoped(
    Effect.gen(function* () {
      const scanner = createEscapeScanner(escapeChar);
      const stripper = createTerminalResponseStripper();
      const decoder = new StringDecoder("utf8");

      const detachRequested = yield* Deferred.make<void>();
      const wireFailed = yield* Deferred.make<void>();
      let transportError: unknown;

      const wire = yield* Queue.unbounded<WireOp>();
      const enqueue = (op: WireOp): void => {
        Queue.offerUnsafe(wire, op);
      };

      const wireWriter = yield* Effect.forkChild(
        Effect.gen(function* () {
          for (;;) {
            const op = yield* Queue.take(wire);
            if (op.kind === "stop") return;
            if (op.kind === "notice") {
              yield* tty.write(op.text);
              continue;
            }
            yield* Effect.catch(
              op.kind === "write"
                ? client.surface.terminal.write({ id, data: op.data })
                : client.surface.terminal.resize({
                    id,
                    cols: op.cols,
                    rows: op.rows,
                  }),
              (err) =>
                Effect.sync(() => {
                  transportError ??= err;
                  Deferred.doneUnsafe(wireFailed, Effect.void);
                }),
            );
          }
        }),
      );

      const drainWire: Effect.Effect<AttachOutcome> = Effect.map(
        Effect.andThen(
          Effect.sync(() => enqueue({ kind: "stop" })),
          Fiber.join(wireWriter),
        ),
        (): AttachOutcome =>
          transportError !== undefined
            ? { kind: "error", message: describeError(transportError) }
            : { kind: "detached" },
      );

      const detach = (): void => {
        Deferred.doneUnsafe(detachRequested, Effect.void);
      };

      const onStdin = (chunk: Buffer): void => {
        for (const ev of scanner.feed(stripper.push(chunk))) {
          if (ev.kind === "forward") {
            const data = decoder.write(ev.data);
            if (data !== "") enqueue({ kind: "write", data });
          } else if (ev.kind === "help") {
            enqueue({ kind: "notice", text: helpText(escapeChar) });
          } else {
            detach();
          }
        }
      };

      const onStdinEnd = (): void => detach();

      yield* Effect.acquireRelease(
        Effect.sync(() => {
          const offResize = tty.onResize(() => {
            const { cols, rows } = tty.size();
            enqueue({ kind: "resize", cols, rows });
          });
          tty.setRawMode(true);
          tty.input.on("data", onStdin);
          tty.input.on("end", onStdinEnd);
          return offResize;
        }),
        (offResize) =>
          Effect.sync(() => {
            tty.input.off("data", onStdin);
            tty.input.off("end", onStdinEnd);
            offResize();
            tty.setRawMode(false);
          }),
      );

      let attachedOnce = false;

      const resolveGone: Effect.Effect<AttachOutcome, unknown> = Effect.suspend(
        () =>
          attachedOnce
            ? Effect.map(
                readExitCode(client, id),
                (exitCode): AttachOutcome =>
                  exitCode === undefined
                    ? {
                        kind: "error",
                        message: `attach(${id}): exit stream ended before yielding an exit code (kaval contract violation)`,
                      }
                    : { kind: "exited", exitCode },
              )
            : Effect.succeed({ kind: "not-found" } as AttachOutcome),
      );

      const consumeAttach = (
        pid: number,
      ): Effect.Effect<AttemptEnd, unknown> => {
        let sawSnapshot = false;
        return Effect.matchEffect(
          Stream.runForEach(
            client.surface.terminalAttach.get({ id, resizeTo: tty.size() }),
            (msg: { kind: string; data?: string }) =>
              Effect.gen(function* () {
                if (!sawSnapshot) {
                  if (msg.kind !== "snapshot") {
                    return yield* Effect.fail(
                      new SnapshotContractViolation({
                        message: `attach(${id}): expected a snapshot first frame, got "${msg.kind}"`,
                      }),
                    );
                  }
                  sawSnapshot = true;
                  const snapshot = msg.data ?? "";
                  const lines =
                    snapshot === "" ? 0 : snapshot.split("\n").length;
                  yield* tty.write(
                    `↻ snapshot restored — ${lines} line${lines === 1 ? "" : "s"} · PTY pid ${pid}${attachedOnce ? " unchanged" : ""}\r\n`,
                  );
                  yield* tty.write("\x1b[H\x1b[2J");
                  yield* tty.write(snapshot);
                  attachedOnce = true;
                  return;
                }
                if (msg.kind === "overflow") {
                  return yield* Effect.fail(new DroppedForLagging({ id }));
                }
                if (msg.kind === "resized") return;
                yield* tty.write(msg.data ?? "");
              }),
          ),
          {
            onSuccess: (): Effect.Effect<AttemptEnd> =>
              Effect.succeed({ kind: "re-attach" }),
            onFailure: (err): Effect.Effect<AttemptEnd, unknown> => {
              if (err instanceof DroppedForLagging) {
                return Effect.succeed({ kind: "re-attach" });
              }
              if (err instanceof SnapshotContractViolation) {
                return Effect.succeed({
                  kind: "outcome",
                  outcome: { kind: "error", message: err.message },
                });
              }
              return Effect.succeed({
                kind: "outcome",
                outcome: {
                  kind: "error",
                  message: describeError(transportError ?? err),
                },
              });
            },
          },
        );
      };

      const attachAttempt: Effect.Effect<AttemptEnd, unknown> = Effect.gen(
        function* () {
          const listed = yield* Effect.catch(
            client.surface.terminal.list({}),
            (err) =>
              Effect.succeed({
                failure: describeError(err),
                entries: [] as { id: string; pid: number }[],
              }),
          );
          if ("failure" in listed) {
            return {
              kind: "outcome",
              outcome: { kind: "error", message: listed.failure },
            } as AttemptEnd;
          }
          const entry = listed.entries.find((e) => e.id === id);
          if (entry === undefined) {
            return {
              kind: "outcome",
              outcome: yield* resolveGone,
            } as AttemptEnd;
          }
          return yield* consumeAttach(entry.pid);
        },
      );

      const settleAttach: Effect.Effect<AttachOutcome, unknown> = Effect.gen(
        function* () {
          for (;;) {
            if (yield* Deferred.isDone(detachRequested))
              return yield* drainWire;

            const end = yield* Effect.raceAllFirst<
              Effect.Effect<AttemptEnd | "detached" | "wire-failed", unknown>
            >([
              attachAttempt,
              Effect.as(Deferred.await(detachRequested), "detached" as const),
              Effect.as(Deferred.await(wireFailed), "wire-failed" as const),
            ]);

            if (end === "detached") return yield* drainWire;
            if (end === "wire-failed") {
              return {
                kind: "error",
                message: describeError(transportError),
              };
            }
            if (yield* Deferred.isDone(detachRequested))
              return yield* drainWire;
            if (end.kind === "outcome") return end.outcome;
            yield* Effect.sleep(150);
          }
        },
      );

      return yield* settleAttach;
    }),
  );
}
