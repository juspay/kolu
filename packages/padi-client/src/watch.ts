import { unenrolledStreamCall } from "@kolu/surface/client";
import { isDeadTransportError, messageOf } from "@kolu/surface/errors";
import { mirrorRemoteSurface } from "@kolu/surface/mirror";
import {
  isValidTimerMs,
  MAX_TIMER_MS,
  runWait,
  type WaitCtx,
  type WaitOutcome,
} from "@kolu/surface/wait";
import { agentBucket } from "@kolu/terminal-vocab/agentProjection";
import type { AgentInfo, TerminalId } from "@kolu/terminal-vocab/schema";
import { Effect, Schema, Stream } from "effect";
import type { PadiSurfaceClient } from "./dial.ts";
import {
  isTerminalNotActive,
  isTerminalNotFound,
  isWatchSubscriptionNotFound,
  TerminalNotActive,
} from "./errors.ts";
import {
  type PadiRoster,
  type PadiStateEvent,
  type PadiTerminal,
  type PadiWatchEvent,
  type PadiWatchStatesInput,
  padiSurface,
  rosterHolds,
  ScreenTextTailSchema,
} from "./surface.ts";
import { activeAgent } from "./terminalVocab.ts";

function iterateUntilAborted<T>(
  stream: Stream.Stream<T, unknown>,
  signal: AbortSignal,
): AsyncIterable<T> {
  const iter = Stream.toAsyncIterable(stream)[Symbol.asyncIterator]();
  const close = (): void => {
    void iter.return?.();
  };
  if (signal.aborted) close();
  else signal.addEventListener("abort", close, { once: true });
  return { [Symbol.asyncIterator]: () => iter };
}

export function matchingActiveAgent(
  v: PadiTerminal,
  targets: ReadonlySet<string>,
): AgentInfo | null {
  const agent = activeAgent(v);
  return agent !== null && targets.has(agentBucket(agent.state)) ? agent : null;
}

async function dormantStateOf(
  client: PadiSurfaceClient,
  id: TerminalId,
  signal: AbortSignal,
): Promise<"sleeping" | "parked" | undefined> {
  for await (const record of iterateUntilAborted(
    client.surface.terminals.get({ key: id }),
    signal,
  )) {
    const state = record?.state;
    return state === "sleeping" || state === "parked" ? state : undefined;
  }
  return undefined;
}

export interface WatchHandlers {
  onUpsert: (id: TerminalId, value: PadiTerminal, live: boolean) => void;
  onRemove: (id: TerminalId) => void;
  onActivity?: (id: TerminalId, live: boolean) => void;
}

export async function watchTerminals(
  client: PadiSurfaceClient,
  opts: {
    handlers: WatchHandlers;
    signal?: AbortSignal;
    log?: (line: string) => void;
    initialKeys?: () => Iterable<TerminalId>;
  },
): Promise<void> {
  const { handlers, signal, log, initialKeys } = opts;
  const live = new Set<TerminalId>();
  const wantsActivity = handlers.onActivity !== undefined;
  await mirrorRemoteSurface(
    padiSurface,
    client,
    {
      collections: {
        terminals: {
          upsert: (id, value) => {
            try {
              handlers.onUpsert(id, value, live.has(id));
            } catch (err) {
              log?.(`terminals upsert handler failed: ${messageOf(err)}`);
            }
          },
          remove: (id) => {
            try {
              handlers.onRemove(id);
            } catch (err) {
              log?.(`terminals remove handler failed: ${messageOf(err)}`);
            }
          },
          ...(initialKeys !== undefined ? { initialKeys } : {}),
        },
      },
      streams: wantsActivity
        ? {
            activity: {
              input: {},
              onFrame: (ids) => {
                const next = new Set(ids);
                const fire = (id: TerminalId, isLive: boolean): void => {
                  try {
                    handlers.onActivity?.(id, isLive);
                  } catch (err) {
                    log?.(`activity handler failed: ${messageOf(err)}`);
                  }
                };
                for (const id of next) if (!live.has(id)) fire(id, true);
                for (const id of live) if (!next.has(id)) fire(id, false);
                live.clear();
                for (const id of next) live.add(id);
              },
            },
          }
        : {},
    },
    { signal, log },
  ).done;
}

export async function watchAgentStates(
  client: PadiSurfaceClient,
  input: PadiWatchStatesInput,
  onBatch: (batch: readonly PadiStateEvent[]) => void,
  signal?: AbortSignal,
  log?: (line: string) => void,
): Promise<void> {
  await mirrorRemoteSurface(
    padiSurface,
    client,
    {
      streams: {
        watchStates: {
          input,
          onFrame: (batch) => {
            try {
              onBatch(batch);
            } catch (err) {
              log?.(`watchStates handler failed: ${messageOf(err)}`);
            }
          },
        },
      },
    },
    { signal, log },
  ).done;
}

type AttachFrame =
  | { readonly kind: "snapshot"; readonly data: string }
  | { readonly kind: "delta"; readonly data: string }
  | { readonly kind: "resized" };

async function watchAttachFeed(
  client: PadiSurfaceClient,
  ctx: WaitCtx<ConditionMet>,
  opts: {
    readonly id: string;
    readonly onFrame: (frame: AttachFrame) => void;
    readonly onFeedLost: () => void;
    readonly onExit?: () => void;
    readonly onTerminalGone?: () => void;
    readonly retryAdvice: string;
  },
): Promise<void> {
  let feedError: string | undefined;
  let sawExit = false;

  const fire = (what: string, run: (() => void) | undefined): void => {
    try {
      run?.();
    } catch (err) {
      ctx.recordUpstreamError(`${what} handler failed: ${messageOf(err)}`);
    }
  };

  const settleOnLostFeed = async (): Promise<void> => {
    fire("onFeedLost", opts.onFeedLost);
    if (sawExit) {
      fire("onTerminalGone", opts.onTerminalGone);
      ctx.settle({ kind: "gone", elapsedMs: ctx.elapsedMs() });
      return;
    }
    try {
      let standing: PadiRoster | undefined;
      for await (const frame of iterateUntilAborted(
        client.surface.roster.get(undefined),
        ctx.signal,
      )) {
        standing = frame;
        break;
      }
      if (standing === undefined) {
        throw new Error(
          "padi roster yielded no snapshot frame — link or protocol failure.",
        );
      }
      const held = rosterHolds(standing, opts.id);
      if (held === false) {
        fire("onTerminalGone", opts.onTerminalGone);
        ctx.settle({ kind: "gone", elapsedMs: ctx.elapsedMs() });
        return;
      }
      if (held === null) {
        feedError ??= `the host has not finished adopting its terminals, so its list cannot say whether ${opts.id} is gone — ${opts.retryAdvice}.`;
      }
    } catch (err) {
      if (isDeadTransportError(err)) throw err;
      const m = messageOf(err);
      feedError ??= m;
      ctx.recordUpstreamError(m);
    }
    ctx.settle({
      kind: "closed",
      error:
        feedError ??
        `the daemon ended ${opts.id}'s output feed while its terminal is still live — ${opts.retryAdvice}.`,
    });
  };

  const consumeOutput = async (): Promise<void> => {
    try {
      const stream = unenrolledStreamCall(
        (input: { id: string }) => client.surface.terminalAttach.get(input),
        { id: opts.id },
        {
          label: `terminalAttach[${opts.id}] (padi watch)`,
          onRetry: () => fire("onFeedLost", opts.onFeedLost),
        },
      );
      for await (const frame of iterateUntilAborted(stream, ctx.signal)) {
        opts.onFrame(frame);
      }
      if (!ctx.signal.aborted) await settleOnLostFeed();
    } catch (err) {
      if (!ctx.signal.aborted) {
        if (isDeadTransportError(err)) throw err;
        const m = messageOf(err);
        feedError ??= m;
        ctx.recordUpstreamError(m);
        await settleOnLostFeed();
      }
    }
  };

  const consumeExit = async (): Promise<void> => {
    try {
      const stream = unenrolledStreamCall(
        (input: { id: string }) => client.surface.terminalExit.get(input),
        { id: opts.id },
        { label: `terminalExit[${opts.id}] (padi watch)` },
      );
      for await (const _msg of iterateUntilAborted(stream, ctx.signal)) {
        sawExit = true;
        fire("onExit", opts.onExit);
        return;
      }
    } catch {}
  };

  await Promise.all([consumeOutput(), consumeExit()]);
}

/** The outcome of a standing-subscription wait — the shared {@link WaitOutcome}
 *  with the drained batch as its met payload. */
export type WatchEventsOutcome = WaitOutcome<{
  events: readonly PadiWatchEvent[];
  dropped: number;
  ackAfter: number;
  elapsedMs: number;
}>;

/** Block until the named standing subscription has settle events, then drain and
 *  return them; or `timeout` after `timeoutMs`.
 *
 *  Unlike {@link awaitAgentState} / {@link awaitOutputSettled}, which see only
 *  what happens while the call is open, this drains a padi-side BUFFER, so the
 *  gaps between calls are not holes. */
export async function awaitWatchEvents(
  client: PadiSurfaceClient,
  opts: {
    name: string;
    after?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
  },
): Promise<WatchEventsOutcome> {
  return runWait<{
    events: readonly PadiWatchEvent[];
    dropped: number;
    ackAfter: number;
    elapsedMs: number;
  }>({ timeoutMs: opts.timeoutMs, signal: opts.signal }, async (ctx) => {
    const drainNow = async (): Promise<boolean> => {
      const drained = await Effect.runPromise(
        client.surface.watch.drain({
          name: opts.name,
          ...(opts.after === undefined ? {} : { after: opts.after }),
        }),
      );
      if (drained.events.length === 0 && drained.dropped === 0) return false;
      ctx.settle({
        kind: "met",
        events: drained.events,
        dropped: drained.dropped,
        ackAfter: drained.ackAfter,
        elapsedMs: ctx.elapsedMs(),
      });
      return true;
    };

    let baseline: number | undefined;
    try {
      const stream = unenrolledStreamCall(
        (input: { name: string }) => client.surface.watchPulse.get(input),
        { name: opts.name },
        { label: `watchPulse[${opts.name}] (padi watch)` },
      );
      for await (const frame of iterateUntilAborted(stream, ctx.signal)) {
        if (baseline === undefined) {
          baseline = frame.seq;
          if (await drainNow()) return;
          continue;
        }
        if (frame.seq !== baseline) {
          baseline = frame.seq;
          if (await drainNow()) return;
        }
      }
      if (!ctx.signal.aborted) {
        ctx.settle({
          kind: "closed",
          error: `the daemon ended the pulse feed for subscription "${opts.name}" — retry watch_next; buffered events are not lost.`,
        });
      }
    } catch (err) {
      if (ctx.signal.aborted) return;
      if (isDeadTransportError(err)) throw err;
      if (isWatchSubscriptionNotFound(err)) throw err;
      const m = messageOf(err);
      ctx.recordUpstreamError(m);
      ctx.settle({ kind: "closed", error: m });
    }
  });
}

const MATCH_OVERLAP_CODE_UNITS = 1 << 12;

function carryTail(window: string): string {
  if (window.length <= MATCH_OVERLAP_CODE_UNITS) return window;
  let start = window.length - MATCH_OVERLAP_CODE_UNITS;
  const head = window.charCodeAt(start);
  if (head >= 0xdc00 && head <= 0xdfff) start -= 1;
  return window.slice(start);
}

function cleanLine(s: string): string {
  return s
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\r/g, "")
    .trim();
}

function matchedLineAt(window: string, index: number): string {
  const start = window.lastIndexOf("\n", Math.max(0, index - 1)) + 1;
  const nl = window.indexOf("\n", index);
  return cleanLine(window.slice(start, nl === -1 ? window.length : nl));
}

export type TerminalCondition =
  | { readonly kind: "idle"; readonly idleMs: number }
  | { readonly kind: "match"; readonly pattern: RegExp }
  | { readonly kind: "agent"; readonly targets: ReadonlySet<string> };

export type ConditionHeld =
  | { readonly fired: "idle" }
  | { readonly fired: "match"; readonly matchedLine: string }
  | { readonly fired: "agent"; readonly agent: AgentInfo };

export type ConditionMet = Stamped<ConditionHeld>;

type Stamped<H> = H extends unknown
  ? H & { readonly elapsedMs: number; readonly screen?: string }
  : never;

/** The outcome of a {@link awaitTerminalCondition} — the shared
 *  {@link WaitOutcome} union over {@link ConditionMet}. */
export type TerminalConditionOutcome = WaitOutcome<ConditionMet>;

export type MetOf<C extends TerminalCondition> = WaitOutcome<
  Extract<ConditionMet, { fired: C["kind"] }>
>;

class EngineInvariantBroken extends Error {}

function quietWindow(
  what: string,
  ms: number,
  onQuiet: () => void,
): { readonly arm: () => void; readonly disarm: () => void } {
  if (!isValidTimerMs(ms)) {
    throw new RangeError(
      `${what} must be between 1 and ${MAX_TIMER_MS} (~24.8 days), got ${ms} — a larger window overflows setTimeout and fires a false near-instant met.`,
    );
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const disarm = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
  return {
    arm: () => {
      disarm();
      timer = setTimeout(onQuiet, ms);
    },
    disarm,
  };
}

interface FormContext {
  readonly client: PadiSurfaceClient;
  readonly id: TerminalId;
  readonly ctx: WaitCtx<ConditionMet>;
  readonly capturesScreen: boolean;
  readonly setHeld: (held: ConditionHeld | null) => void;
  readonly held: () => ConditionHeld | null;
  readonly markQuiet: () => void;
}

interface ConditionForm {
  readonly settlesOnExit: boolean;
  readonly onFrame?: (frame: AttachFrame) => void;
  readonly onFeedLost?: () => void;
  readonly onTerminalGone?: () => void;
  readonly subscribe?: () => Promise<void>;
  readonly dispose?: () => void;
}

function conditionForm(
  condition: TerminalCondition,
  engine: FormContext,
): ConditionForm {
  switch (condition.kind) {
    case "idle": {
      const window = quietWindow("idleMs", condition.idleMs, () => {
        engine.setHeld({ fired: "idle" });
      });
      return {
        settlesOnExit: true,
        onFrame: (frame) => {
          if (frame.kind === "resized") return;
          engine.setHeld(null);
          window.arm();
        },
        onFeedLost: () => {
          window.disarm();
          engine.setHeld(null);
        },
        dispose: () => window.disarm(),
      };
    }

    case "match": {
      let carry = "";
      return {
        settlesOnExit: false,
        onFrame: (frame) => {
          if (frame.kind !== "delta" || engine.held() !== null) return;
          const data = frame.data;
          if (data === "") return;
          const window = carry + data;
          const index = window.search(condition.pattern);
          if (index !== -1) {
            engine.setHeld({
              fired: "match",
              matchedLine: matchedLineAt(window, index),
            });
            return;
          }
          carry = carryTail(window);
        },
        onFeedLost: () => {
          carry = "";
        },
        ...(engine.capturesScreen
          ? {}
          : {
              onTerminalGone: () => {
                if (engine.held() !== null) engine.markQuiet();
              },
            }),
      };
    }

    case "agent": {
      const targets = condition.targets;
      return {
        settlesOnExit: true,
        subscribe: () =>
          watchTerminals(engine.client, {
            handlers: {
              onUpsert: (upserted, value) => {
                if (upserted !== engine.id) return;
                const agent = matchingActiveAgent(value, targets);
                engine.setHeld(
                  agent === null ? null : { fired: "agent", agent },
                );
              },
              onRemove: (removed) => {
                if (removed !== engine.id) return;
                void (async () => {
                  for await (const standing of iterateUntilAborted(
                    engine.client.surface.roster.get(undefined),
                    engine.ctx.signal,
                  )) {
                    if (rosterHolds(standing, engine.id) === false) {
                      engine.ctx.settle({
                        kind: "gone",
                        elapsedMs: engine.ctx.elapsedMs(),
                      });
                    }
                    return;
                  }
                })().catch((err: unknown) => {
                  engine.ctx.recordUpstreamError(
                    `reading the host's roster standing failed: ${messageOf(err)}`,
                  );
                });
              },
            },
            signal: engine.ctx.signal,
            log: (line) => engine.ctx.recordUpstreamError(line),
            initialKeys: () => [engine.id],
          }),
      };
    }
  }
}

export async function awaitTerminalCondition<C extends TerminalCondition>(
  client: PadiSurfaceClient,
  opts: {
    readonly id: TerminalId;
    readonly condition: C;
    /** Report met only once output has ALSO been quiet for this long. */
    readonly settledMs?: number;
    /** Stamp the met with the last N lines of the terminal's rendered screen. */
    readonly screenTail?: number;
    readonly timeoutMs?: number;
    readonly signal?: AbortSignal;
    /** "retry wait_outputSettled" — the tail of the `closed` sentence. */
    readonly retryAdvice: string;
  },
): Promise<MetOf<C>> {
  const { id, condition, settledMs, screenTail } = opts;
  if (
    screenTail !== undefined &&
    !Schema.is(ScreenTextTailSchema)(screenTail)
  ) {
    throw new RangeError(
      `screenTail must be a positive whole number of lines, got ${screenTail}.`,
    );
  }
  return runWait<ConditionMet>(
    { timeoutMs: opts.timeoutMs, signal: opts.signal },
    async (ctx) => {
      const quietGround = settledMs === undefined;

      let candidate: {
        readonly held: ConditionHeld | null;
        readonly quiet: boolean;
        readonly epoch: number;
      } = { held: null, quiet: quietGround, epoch: 0 };

      const sameCandidate = (
        a: ConditionHeld | null,
        b: ConditionHeld | null,
      ): boolean => {
        if (a === null || b === null) return a === b;
        if (a.fired !== b.fired) return false;
        switch (a.fired) {
          case "idle":
            return true;
          case "match":
            return a.matchedLine === (b as typeof a).matchedLine;
          case "agent": {
            const other = (b as typeof a).agent;
            return a.agent.kind === other.kind && a.agent.state === other.state;
          }
        }
      };

      const update = (
        next: Partial<{ held: ConditionHeld | null; quiet: boolean }>,
      ): void => {
        const held = next.held !== undefined ? next.held : candidate.held;
        const quiet = next.quiet !== undefined ? next.quiet : candidate.quiet;
        if (quiet === candidate.quiet && sameCandidate(held, candidate.held)) {
          candidate = { ...candidate, held };
          return;
        }
        candidate = { held, quiet, epoch: candidate.epoch + 1 };
        check();
      };

      let readFailure: unknown;
      let gateRefusal: TerminalNotActive | undefined;
      let pendingRead: Promise<void> | undefined;

      const settleMet = (
        payload: ConditionHeld,
        screen: string | undefined,
      ): void => {
        if (screenTail !== undefined && screen === undefined) {
          throw new EngineInvariantBroken(
            `awaitTerminalCondition: ${id} met with screenTail set but no screen — the engine's own invariant, not an empty terminal.`,
          );
        }
        ctx.settle({
          kind: "met",
          ...payload,
          elapsedMs: ctx.elapsedMs(),
          ...(screen === undefined ? {} : { screen }),
        });
      };

      const stampLoop = async (tail: number): Promise<void> => {
        try {
          while (
            !ctx.signal.aborted &&
            candidate.held !== null &&
            candidate.quiet
          ) {
            const at = candidate.epoch;
            const text = await Effect.runPromise(
              client.surface.screen.text({ id, tail }),
              { signal: ctx.signal },
            );
            if (ctx.signal.aborted) return;
            if (candidate.epoch !== at) continue;
            if (candidate.held === null) return;
            settleMet(candidate.held, text);
            return;
          }
        } catch (err) {
          if (err instanceof EngineInvariantBroken) throw err;
          if (ctx.signal.aborted) return;
          if (isTerminalNotFound(err)) {
            ctx.settle({ kind: "gone", elapsedMs: ctx.elapsedMs() });
            return;
          }
          if (isTerminalNotActive(err)) {
            readFailure = err;
            ctx.settle({
              kind: "closed",
              error: `${id} went to sleep before its screen could be read at the met`,
            });
            return;
          }
          const message = messageOf(err);
          ctx.recordUpstreamError(message);
          if (isDeadTransportError(err)) readFailure = err;
          ctx.settle({
            kind: "closed",
            error: `could not read ${id}'s screen at the met — ${message}`,
          });
        }
      };

      function check(): void {
        if (ctx.signal.aborted || candidate.held === null || !candidate.quiet) {
          return;
        }
        if (screenTail === undefined) {
          settleMet(candidate.held, undefined);
          return;
        }
        if (pendingRead !== undefined) return;
        pendingRead = stampLoop(screenTail).finally(() => {
          pendingRead = undefined;
        });
      }

      const settledWindow =
        settledMs === undefined
          ? undefined
          : quietWindow("settledMs", settledMs, () => {
              update({ quiet: true });
            });

      const form = conditionForm(condition, {
        client,
        id,
        ctx,
        capturesScreen: screenTail !== undefined,
        setHeld: (held) => update({ held }),
        held: () => candidate.held,
        markQuiet: () => update({ quiet: true }),
      });

      const arms: Promise<void>[] = [];

      arms.push(
        (async () => {
          const dormant = await dormantStateOf(client, id, ctx.signal);
          if (dormant === undefined || ctx.signal.aborted) return;
          gateRefusal = new TerminalNotActive({ id, state: dormant });
          ctx.settle({
            kind: "closed",
            error: `${id} is ${dormant} — there is nothing live to wait on`,
          });
        })(),
      );

      if (form.onFrame !== undefined || settledWindow !== undefined) {
        arms.push(
          watchAttachFeed(client, ctx, {
            id,
            onFrame: (frame) => {
              if (settledWindow !== undefined && frame.kind !== "resized") {
                update({ quiet: false });
                settledWindow.arm();
              }
              form.onFrame?.(frame);
            },
            onFeedLost: () => {
              settledWindow?.disarm();
              form.onFeedLost?.();
              update({ quiet: quietGround });
            },
            ...(form.settlesOnExit
              ? {
                  onExit: () =>
                    ctx.settle({ kind: "gone", elapsedMs: ctx.elapsedMs() }),
                }
              : {}),
            ...(form.onTerminalGone === undefined
              ? {}
              : { onTerminalGone: form.onTerminalGone }),
            retryAdvice: opts.retryAdvice,
          }),
        );
      }

      if (form.subscribe !== undefined) arms.push(form.subscribe());

      try {
        await Promise.all(arms);
        if (pendingRead !== undefined) await pendingRead;
      } finally {
        form.dispose?.();
        settledWindow?.disarm();
      }
      if (readFailure !== undefined) throw readFailure;
      if (gateRefusal !== undefined) throw gateRefusal;
    },
  ) as Promise<MetOf<C>>;
}

/** The outcome of an agent-state wait — the shared {@link WaitOutcome} union
 *  with the met payload this wait stamps: the matched agent, how long the wait
 *  took, and (when `screenTail` was asked for) the screen's last lines. */
export type AgentStateOutcome = WaitOutcome<{
  agent: AgentInfo;
  elapsedMs: number;
  screen?: string;
}>;

export async function awaitAgentState(
  client: PadiSurfaceClient,
  opts: {
    id: TerminalId;
    targets: ReadonlySet<string>;
    /** Report met only once output has ALSO been quiet for this long. */
    settledMs?: number;
    /** Stamp the met with the last N lines of the terminal's rendered screen. */
    screenTail?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
  },
): Promise<AgentStateOutcome> {
  const outcome = await awaitTerminalCondition(client, {
    id: opts.id,
    condition: { kind: "agent", targets: opts.targets } as const,
    ...(opts.settledMs === undefined ? {} : { settledMs: opts.settledMs }),
    ...(opts.screenTail === undefined ? {} : { screenTail: opts.screenTail }),
    timeoutMs: opts.timeoutMs,
    signal: opts.signal,
    retryAdvice: "re-run the agent-state wait",
  });
  return outcome.kind === "met"
    ? {
        kind: "met",
        agent: outcome.agent,
        elapsedMs: outcome.elapsedMs,
        ...(outcome.screen === undefined ? {} : { screen: outcome.screen }),
      }
    : outcome;
}

/** The outcome of an output-settled wait — the shared {@link WaitOutcome} union
 *  with the met payload this wait stamps: the idle signal fired, how long the
 *  wait took, and (when `screenTail` was asked for) the screen's last lines. */
export type OutputSettledOutcome = WaitOutcome<{
  fired: "idle";
  elapsedMs: number;
  screen?: string;
}>;

export async function awaitOutputSettled(
  client: PadiSurfaceClient,
  opts: {
    id: string;
    idleMs: number;
    /** Stamp the met with the last N lines of the terminal's rendered screen. */
    screenTail?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
  },
): Promise<OutputSettledOutcome> {
  return awaitTerminalCondition(client, {
    id: opts.id,
    condition: { kind: "idle", idleMs: opts.idleMs } as const,
    ...(opts.screenTail === undefined ? {} : { screenTail: opts.screenTail }),
    timeoutMs: opts.timeoutMs,
    signal: opts.signal,
    retryAdvice: "retry wait_outputSettled",
  });
}
