import {
  CONTAINING_TERMINAL_ENV,
  confirmInFleet,
  containingTerminalId,
} from "@kolu/padi/containingTerminal";
import { readTerminalKeys } from "@kolu/padi/read";
import {
  formatHeartbeat,
  formatHeartbeatJson,
  formatStateEvent,
  formatStateEventJson,
  formatWatchActivity,
  formatWatchActivityJson,
  formatWatchEvent,
  formatWatchJson,
  formatWatchRemoval,
  formatWatchRemovalJson,
  shortId,
} from "@kolu/padi/render";
import { resolveTerminalId } from "@kolu/padi-client/terminalId";
import { namesWatchKnobs } from "@kolu/padi/watchSpec";
import type { PadiSurfaceClient } from "@kolu/padi-client/dial";
import type { PadiWatchStatesInput } from "@kolu/padi-client/surface";
import {
  PADI_LINK_CLOSED,
  type WaitState,
} from "@kolu/padi-client/terminalVocab";
import { watchAgentStates, watchTerminals } from "@kolu/padi-client/watch";
import {
  scopeAdmits,
  type WatchScope,
  watchScopeOf,
} from "@kolu/padi-client/watchScope";
import { parseDuration, parseNag } from "@kolu/padi-client/watchDuration";
import { isTerminalId, type TerminalId } from "@kolu/terminal-vocab/schema";
import { type Cause, Effect, Fiber, Queue, type Scope, Stream } from "effect";
import type { Command } from "effect/cli";
import { match } from "ts-pattern";
import type { watchFlags } from "../cli.ts";
import { type Endpoint, withPadi } from "../endpoint.ts";
import { type CliFailure, errorMessage, failure } from "../exit.ts";
import {
  ambiguousTerminal,
  drainToStdout,
  type Parsed,
  resolveTerminalIn,
  waitStateTokens,
  warn,
} from "./shared.ts";

export type WatchArgs = Command.Command.Config.Infer<typeof watchFlags>;

const pumpToStdout = (
  lines: Queue.Dequeue<string, Cause.Done>,
  stop: () => void,
): Effect.Effect<void, CliFailure> =>
  drainToStdout(Stream.fromQueue(lines), "the watch feed", stop);

export function planSupervision(
  args: WatchArgs,
): Parsed<PadiWatchStatesInput | undefined> {
  const input: {
    states?: readonly WaitState[];
    heldForMs?: number;
    nagMs?: number;
    nagCount?: number;
  } = {};
  if (args.states !== undefined) {
    const tokens = waitStateTokens(args.states);
    if (tokens.kind === "error") {
      return { kind: "error", message: `--states ${tokens.message}` };
    }
    input.states = tokens.value;
  }
  if (args.heldFor !== undefined) {
    const parsed = parseDuration(
      "--held-for",
      args.heldFor,
      {
        ms: 0,
        why: "a hold cannot be negative.",
      },
      "reports it as held",
    );
    if (parsed.kind === "error") return parsed;
    input.heldForMs = parsed.value;
  }
  if (args.nag !== undefined) {
    const parsed = parseNag("--nag", args.nag);
    if (parsed.kind === "error") return parsed;
    input.nagMs = parsed.value.ms;
    if (parsed.value.count !== undefined) input.nagCount = parsed.value.count;
  }
  return { kind: "ok", value: namesWatchKnobs(input) ? input : undefined };
}

export function planHeartbeat(args: WatchArgs): Parsed<number | undefined> {
  if (args.heartbeat === undefined) return { kind: "ok", value: undefined };
  const parsed = parseDuration(
    "--heartbeat",
    args.heartbeat,
    {
      ms: 1,
      why: "an interval of zero is a spin, not a fast heartbeat. Pass a real interval (10s), or leave --heartbeat off.",
    },
    "ticks",
  );
  if (parsed.kind === "error") return parsed;
  return { kind: "ok", value: parsed.value };
}

const IGNORE_SELF_UNRESOLVABLE = `--ignore-self: this process is not running inside a kolu terminal (${CONTAINING_TERMINAL_ENV} is unset). Run watch from inside a kolu-owned PTY, or pass --ignore <id>.`;

const ignoreSelfInvalid = (raw: string): string =>
  `--ignore-self: ${CONTAINING_TERMINAL_ENV}=${JSON.stringify(raw)} is not a terminal id.`;

const ignoreSelfNotInFleet = (self: TerminalId): string =>
  `--ignore-self: this padi has never heard of terminal ${shortId(self)} (${CONTAINING_TERMINAL_ENV}) — muting it would mute nobody and report success. You are watching another machine's fleet (--host, or a --socket pointing at a different padi), or a daemon restart has re-keyed the terminals. Pass --ignore <id> naming a terminal this padi owns.`;

export function planIgnoreSelf(
  args: WatchArgs,
  env: { readonly [key: string]: string | undefined } = process.env,
): Parsed<TerminalId | undefined> {
  if (!args.ignoreSelf) return { kind: "ok", value: undefined };
  return match(containingTerminalId(env))
    .returnType<Parsed<TerminalId | undefined>>()
    .with({ kind: "none" }, () => ({
      kind: "error",
      message: IGNORE_SELF_UNRESOLVABLE,
    }))
    .with({ kind: "invalid" }, (self) => ({
      kind: "error",
      message: ignoreSelfInvalid(self.raw),
    }))
    .with({ kind: "ok" }, (self) => ({ kind: "ok", value: self.id }))
    .exhaustive();
}

export function refuseSelfNotInFleet(
  self: TerminalId | undefined,
  live: readonly TerminalId[],
): string | undefined {
  if (self === undefined) return undefined;
  const confirmed = confirmInFleet({ kind: "ok", id: self }, live);
  return confirmed.kind === "stray"
    ? ignoreSelfNotInFleet(confirmed.id)
    : undefined;
}

type IgnoreQueryVerdict =
  | { readonly action: "keep"; readonly id: TerminalId }
  | { readonly action: "drop"; readonly query: string }
  | { readonly action: "fail"; readonly message: string };

const keepStaleFullIdDropUnknownPrefix = (
  query: string,
  live: readonly TerminalId[],
): IgnoreQueryVerdict =>
  match(resolveTerminalId(query, live))
    .with(
      { kind: "found" },
      (result): IgnoreQueryVerdict => ({ action: "keep", id: result.id }),
    )
    .with(
      { kind: "ambiguous" },
      (result): IgnoreQueryVerdict => ({
        action: "fail",
        message: ambiguousTerminal(query, result.matches, "--ignore"),
      }),
    )
    .with(
      { kind: "none" },
      (): IgnoreQueryVerdict =>
        isTerminalId(query)
          ? { action: "keep", id: query }
          : { action: "drop", query },
    )
    .exhaustive();

export function resolveIgnoreQueries(
  queries: readonly string[],
  live: readonly TerminalId[],
): Parsed<{
  readonly ids: readonly TerminalId[];
  readonly dropped: readonly string[];
}> {
  const resolved: TerminalId[] = [];
  const dropped: string[] = [];
  for (const query of queries) {
    const verdict = keepStaleFullIdDropUnknownPrefix(query, live);
    if (verdict.action === "fail") {
      return { kind: "error", message: verdict.message };
    }
    if (verdict.action === "keep") resolved.push(verdict.id);
    else dropped.push(verdict.query);
  }
  return { kind: "ok", value: { ids: resolved, dropped } };
}

export function planWatchScope(
  only: TerminalId | undefined,
  mute: readonly TerminalId[],
): Parsed<WatchScope> {
  const scope = watchScopeOf({
    ...(only === undefined ? {} : { ids: [only] }),
    mute,
  });
  if (scope.kind === "error") {
    return {
      kind: "error",
      message: `${scope.message} Omit the id to watch the rest of the fleet, or drop it from --ignore.`,
    };
  }
  return scope;
}

export interface WatchPlan {
  readonly supervise?: PadiWatchStatesInput;
  readonly self?: TerminalId;
  readonly heartbeatMs?: number;
  readonly ignore: readonly string[];
  readonly id?: string;
  readonly json: boolean;
}

export function preDialPlan(
  args: WatchArgs,
  env: { readonly [key: string]: string | undefined } = process.env,
): Parsed<WatchPlan> {
  const supervise = planSupervision(args);
  if (supervise.kind === "error") return supervise;
  const self = planIgnoreSelf(args, env);
  if (self.kind === "error") return self;
  const heartbeat = planHeartbeat(args);
  if (heartbeat.kind === "error") return heartbeat;
  return {
    kind: "ok",
    value: {
      ...(supervise.value === undefined ? {} : { supervise: supervise.value }),
      ...(self.value === undefined ? {} : { self: self.value }),
      ...(heartbeat.value === undefined
        ? {}
        : { heartbeatMs: heartbeat.value }),
      ignore: args.ignore,
      ...(args.id === undefined ? {} : { id: args.id }),
      json: args.json,
    },
  };
}

export interface WatchTargets {
  readonly only?: TerminalId;
  readonly scope: WatchScope;
  readonly live: readonly TerminalId[];
}

export function admitAndEmit(
  scope: WatchScope,
  json: boolean,
  offer: (line: string) => void,
): (id: TerminalId, asJson: () => string, asHuman: () => string) => void {
  return (id, asJson, asHuman) => {
    if (!scopeAdmits(scope, id)) return;
    offer(json ? asJson() : asHuman());
  };
}

export function resolveWatchTargets(
  client: PadiSurfaceClient,
  plan: WatchPlan,
): Effect.Effect<WatchTargets, unknown> {
  return Effect.gen(function* () {
    const live =
      plan.id !== undefined || plan.ignore.length > 0 || plan.self !== undefined
        ? yield* readTerminalKeys(client)
        : [];
    const strayed = refuseSelfNotInFleet(plan.self, live);
    if (strayed !== undefined) return yield* Effect.fail(failure(strayed));
    const only =
      plan.id === undefined
        ? undefined
        : yield* resolveTerminalIn(plan.id, live);
    const listed = resolveIgnoreQueries(plan.ignore, live);
    if (listed.kind === "error") {
      return yield* Effect.fail(failure(listed.message));
    }
    for (const query of listed.value.dropped) {
      warn(
        `--ignore ${JSON.stringify(query)} matched no terminal — not muting anything for it`,
      );
    }
    const scope = planWatchScope(only, [
      ...listed.value.ids,
      ...(plan.self === undefined ? [] : [plan.self]),
    ]);
    if (scope.kind === "error") {
      return yield* Effect.fail(failure(scope.message));
    }
    return {
      ...(only === undefined ? {} : { only }),
      scope: scope.value,
      live,
    };
  });
}

type WatchEnding =
  | { readonly kind: "consumer-left" }
  | { readonly kind: "mirror-rejected"; readonly message: string }
  | { readonly kind: "link-closed" };

const endingOf = (
  rejection: string | undefined,
  consumerLeft: boolean,
): WatchEnding => {
  if (consumerLeft) return { kind: "consumer-left" };
  return rejection === undefined
    ? { kind: "link-closed" }
    : { kind: "mirror-rejected", message: rejection };
};

const heartbeatPulse = (
  plan: WatchPlan,
  offer: (line: string) => void,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    const heartbeatMs = plan.heartbeatMs;
    if (heartbeatMs === undefined) return;
    const pulse = (): void => {
      offer(
        plan.json
          ? formatHeartbeatJson(Date.now())
          : formatHeartbeat(Date.now()),
      );
    };
    pulse();
    yield* Effect.acquireRelease(
      Effect.sync(() => setInterval(pulse, heartbeatMs).unref()),
      (timer) => Effect.sync(() => clearInterval(timer)),
    );
  });

export function run(
  endpoint: Endpoint,
  args: WatchArgs,
): Effect.Effect<void, unknown> {
  const planned = preDialPlan(args);
  if (planned.kind === "error") return Effect.fail(failure(planned.message));
  const plan = planned.value;

  return withPadi(endpoint, (conn) =>
    Effect.scoped(
      Effect.gen(function* () {
        const { only, scope, live } = yield* resolveWatchTargets(
          conn.client,
          plan,
        );

        const lines = yield* Queue.unbounded<string, Cause.Done>();
        const offer = (line: string): void => {
          Queue.offerUnsafe(lines, `${line}\n`);
        };
        const emitFor = admitAndEmit(scope, plan.json, offer);

        const stopped = new AbortController();
        const pump = yield* Effect.forkChild(
          pumpToStdout(lines, () => stopped.abort()),
        );

        const ending = yield* Effect.scoped(
          Effect.gen(function* () {
            yield* heartbeatPulse(plan, offer);

            const rejection = yield* Effect.catch(
              Effect.map(
                Effect.tryPromise({
                  try: (interrupted) => {
                    const signal = AbortSignal.any([
                      interrupted,
                      stopped.signal,
                    ]);
                    return plan.supervise === undefined
                      ? watchTerminals(conn.client, {
                          handlers: {
                            onUpsert: (id, value, live) =>
                              emitFor(
                                id,
                                () => formatWatchJson(id, value, { live }),
                                () =>
                                  formatWatchEvent(id, value, {
                                    now: Date.now(),
                                    live,
                                  }),
                              ),
                            onRemove: (id) =>
                              emitFor(
                                id,
                                () => formatWatchRemovalJson(id),
                                () =>
                                  formatWatchRemoval(id, { now: Date.now() }),
                              ),
                            onActivity: (id, live) =>
                              emitFor(
                                id,
                                () => formatWatchActivityJson(id, live),
                                () =>
                                  formatWatchActivity(id, live, {
                                    now: Date.now(),
                                  }),
                              ),
                          },
                          signal,
                          log: warn,
                          initialKeys: () => live,
                        })
                      : watchAgentStates(
                          conn.client,
                          {
                            ...plan.supervise,
                            ...(only === undefined ? {} : { id: only }),
                            ...(scope.mute === undefined
                              ? {}
                              : { ignoreIds: [...scope.mute] }),
                          },
                          (batch) => {
                            for (const event of batch) {
                              emitFor(
                                event.id,
                                () => formatStateEventJson(event),
                                () => formatStateEvent(event),
                              );
                            }
                          },
                          signal,
                          warn,
                        );
                  },
                  catch: (err) => err,
                }),
                (): string | undefined => undefined,
              ),
              (err) => Effect.succeed(errorMessage(err)),
            );

            return endingOf(rejection, stopped.signal.aborted);
          }),
        );

        yield* Queue.end(lines);
        yield* Fiber.join(pump);

        if (ending.kind === "consumer-left") return;
        return yield* Effect.fail(
          failure(
            ending.kind === "mirror-rejected"
              ? ending.message
              : PADI_LINK_CLOSED,
          ),
        );
      }),
    ),
  );
}
