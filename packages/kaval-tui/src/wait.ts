import { isDeadTransportError, messageOf } from "@kolu/surface/errors";
import {
  isValidTimerMs,
  MAX_TIMER_MS,
  waitOutcomeJson,
  type WaitOutcome as SharedWaitOutcome,
} from "@kolu/surface/wait";
import { Effect, Option, Queue, Stream } from "effect";
import type { PtyTuiClient } from "./connect.ts";

export { isValidTimerMs, MAX_TIMER_MS };

export type WaitCondition =
  | { kind: "idle"; ms: number }
  | { kind: "match"; regex: RegExp };

export type ParsedUntil = WaitCondition | { kind: "error"; message: string };

function parsePositiveWholeMs(raw: string): number | undefined {
  return /^\d+$/.test(raw) ? Number(raw) : undefined;
}

export function parseUntil(spec: string): ParsedUntil {
  const idle = "idle:";
  const match = "match:";
  if (spec.startsWith(idle)) {
    const raw = spec.slice(idle.length);
    const ms = parsePositiveWholeMs(raw);
    if (ms === undefined) {
      return {
        kind: "error",
        message: `--until idle:<ms> needs a positive whole number of milliseconds, got ${JSON.stringify(raw)} (e.g. idle:800).`,
      };
    }
    if (!isValidTimerMs(ms)) {
      return {
        kind: "error",
        message: `--until idle:<ms> must be between 1 and ${MAX_TIMER_MS} (~24.8 days): 0 never settles and a larger window overflows the timer, got ${JSON.stringify(raw)}.`,
      };
    }
    return { kind: "idle", ms };
  }
  if (spec.startsWith(match)) {
    const pattern = spec.slice(match.length);
    if (pattern === "") {
      return {
        kind: "error",
        message:
          "--until match:<regex> needs a non-empty pattern (e.g. match:'DONE').",
      };
    }
    try {
      return { kind: "match", regex: new RegExp(pattern) };
    } catch (err) {
      return {
        kind: "error",
        message: `--until match: invalid regex ${JSON.stringify(pattern)} — ${(err as Error).message}`,
      };
    }
  }
  return {
    kind: "error",
    message: `--until must be idle:<ms> or match:<regex>, got ${JSON.stringify(spec)}.`,
  };
}

type OutputMet =
  | { fired: "idle"; elapsedMs: number }
  | { fired: "match"; elapsedMs: number; matchedLine: string };

export type WaitOutcome = SharedWaitOutcome<OutputMet>;

export function waitResultJson(
  id: string,
  outcome: WaitOutcome,
): Record<string, unknown> {
  return waitOutcomeJson<OutputMet>(id, outcome, (met) =>
    met.fired === "match"
      ? {
          fired: "match",
          elapsedMs: met.elapsedMs,
          matchedLine: met.matchedLine,
        }
      : { fired: "idle", elapsedMs: met.elapsedMs },
  );
}

const MATCH_BUFFER_CAP = 1 << 16;

const OSC_SEQUENCE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const CSI_SEQUENCE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

function cleanLine(s: string): string {
  return s
    .replace(OSC_SEQUENCE, "")
    .replace(CSI_SEQUENCE, "")
    .replace(/\r/g, "")
    .trim();
}

function matchedLineAt(buffer: string, index: number): string {
  const start = buffer.lastIndexOf("\n", Math.max(0, index - 1)) + 1;
  const nl = buffer.indexOf("\n", index);
  const end = nl === -1 ? buffer.length : nl;
  return cleanLine(buffer.slice(start, end));
}

type FeedEvent =
  | { readonly kind: "frame"; readonly msg: { kind: string; data?: string } }
  | { readonly kind: "feed-ended" };

interface FeedErrorSlot {
  record(message: string): void;
  readonly message: string | undefined;
}

function firstFeedError(): FeedErrorSlot {
  let first: string | undefined;
  return {
    record(message: string): void {
      first ??= message;
    },
    get message(): string | undefined {
      return first;
    },
  };
}

const raceToFirstSettle = Effect.raceAllFirst;

const deferVerdictToFeedArm: Effect.Effect<WaitOutcome> = Effect.never;

const IDLE_WINDOW_ELAPSED = { kind: "idle-window" } as const;

export function awaitOutputCondition(
  client: PtyTuiClient,
  opts: {
    id: string;
    condition: WaitCondition;
    timeoutMs?: number;
    stop?: Effect.Effect<void>;
  },
): Effect.Effect<WaitOutcome, unknown> {
  const { id, condition } = opts;
  return Effect.scoped(
    Effect.gen(function* () {
      const started = Date.now();
      const elapsed = (): number => Date.now() - started;
      const feedError = firstFeedError();

      const feedEvents = yield* Queue.unbounded<FeedEvent>();
      yield* Effect.forkChild(
        Stream.runForEach(
          client.surface.terminalAttach.get({ id }),
          (msg: { kind: string; data?: string }) =>
            Effect.sync(() => {
              Queue.offerUnsafe(feedEvents, { kind: "frame", msg });
            }),
        ).pipe(
          Effect.catchCause((cause) =>
            Effect.sync(() => {
              feedError.record(messageOf(cause));
            }),
          ),
          Effect.andThen(
            Effect.sync(() => {
              Queue.offerUnsafe(feedEvents, { kind: "feed-ended" });
            }),
          ),
        ),
      );

      const isStillListed: Effect.Effect<boolean, unknown> = Effect.catch(
        Effect.map(client.surface.terminal.list({}), (listed) =>
          listed.entries.some((e) => e.id === id),
        ),
        (err) => {
          if (isDeadTransportError(err)) return Effect.fail(err);
          feedError.record(messageOf(err));
          return Effect.succeed(true);
        },
      );

      const goneOrClosedByInventory: Effect.Effect<WaitOutcome, unknown> =
        Effect.map(
          isStillListed,
          (stillListed): WaitOutcome =>
            stillListed
              ? {
                  kind: "closed",
                  error:
                    feedError.message ??
                    `the daemon ended ${id}'s output feed while its PTY was still live (a slow-consumer drop) — re-run \`kaval-tui wait\`.`,
                }
              : { kind: "gone", elapsedMs: elapsed() },
        );

      const conditionArm: Effect.Effect<WaitOutcome, unknown> = Effect.gen(
        function* () {
          let buffer = "";
          let idleWindowArmed = false;
          for (;;) {
            const event =
              condition.kind === "idle" && idleWindowArmed
                ? yield* Effect.timeoutOrElse(Queue.take(feedEvents), {
                    duration: condition.ms,
                    orElse: () => Effect.succeed(IDLE_WINDOW_ELAPSED),
                  })
                : yield* Queue.take(feedEvents);

            if (event.kind === "idle-window") {
              return { kind: "met", fired: "idle", elapsedMs: elapsed() };
            }
            if (event.kind === "feed-ended") {
              return yield* goneOrClosedByInventory;
            }
            idleWindowArmed = true;
            if (condition.kind === "idle") continue;
            if (event.msg.kind !== "delta") continue;
            buffer += event.msg.data ?? "";
            const m = condition.regex.exec(buffer);
            if (m !== null) {
              return {
                kind: "met",
                fired: "match",
                elapsedMs: elapsed(),
                matchedLine: matchedLineAt(buffer, m.index),
              };
            }
            if (buffer.length > MATCH_BUFFER_CAP) {
              buffer = buffer.slice(-MATCH_BUFFER_CAP);
            }
          }
        },
      );

      const exitArm: Effect.Effect<WaitOutcome, never> = Effect.catchCause(
        Effect.flatMap(
          Stream.runHead(client.surface.exit.get({ id })),
          (head): Effect.Effect<WaitOutcome> =>
            Option.isSome(head)
              ? Effect.succeed({ kind: "gone", elapsedMs: elapsed() })
              : deferVerdictToFeedArm,
        ),
        () => deferVerdictToFeedArm,
      );

      const timeoutArm: Effect.Effect<WaitOutcome> | undefined =
        opts.timeoutMs === undefined
          ? undefined
          : Effect.map(
              Effect.sleep(opts.timeoutMs),
              (): WaitOutcome => ({ kind: "timeout", elapsedMs: elapsed() }),
            );

      const stopArm: Effect.Effect<WaitOutcome> | undefined =
        opts.stop === undefined
          ? undefined
          : Effect.as(opts.stop, { kind: "interrupted" } as WaitOutcome);

      const arms: Effect.Effect<WaitOutcome, unknown>[] = [
        conditionArm,
        exitArm,
        timeoutArm,
        stopArm,
      ].filter((arm) => arm !== undefined);

      return yield* raceToFirstSettle(arms);
    }),
  );
}
