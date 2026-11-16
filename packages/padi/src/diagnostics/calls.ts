/**
 * Per-call timing for padi's procedures — total time, and the part spent in
 * the child processes each call started.
 *
 * One wrapper over the whole built procedure table ({@link timeProcedures}):
 * every leaf is wrapped under its dotted path, so no handler names itself and
 * a new procedure cannot be left out. Each call runs inside a child-meter scope
 * with its own tally, and records one sample when its Effect exits.
 *
 * A body only lands in that scope if it RUNS there. `servePadi`'s `handle()`
 * runs its body later, on the fiber, so it goes through {@link callScoped},
 * which captures the scope in force when the handler is built, runs the body
 * inside it, and marks the Effect it returns — one act, so a mark without the
 * capture (a false measured zero) cannot be spelled. A procedure whose Effect
 * is not marked (an Effect program, like `lifecycle.recycleKaval` or
 * `agentDistro.models`) still has its total timed, but its child time is
 * reported unmeasured, never zero.
 *
 * A call slower than {@link SLOW_CALL_MS} logs one `warn` line. Everything
 * faster is in the table. Streams are not calls: their children are in the
 * children table, not here.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { PadiCallRow } from "@kolu/padi-client/surface";
import { Effect } from "effect";
import {
  createChildTally,
  measured,
  runInChildScope,
  summarizeTimings,
  unmeasured,
} from "kolu-io";
import type { Logger } from "pino";

/** A call a person waits on. Padi's log keeps 30 MB: at 200 ms an incident
 *  writes several lines a second and pushes everything else out. */
export const SLOW_CALL_MS = 500;

const WINDOW_MS = 60_000;

const runsInCallScope = new WeakSet<object>();

/** Build a procedure's Effect around a promise-shaped `body` that runs, when
 *  the fiber gets to it, inside the async context in force NOW — the call
 *  scope {@link timeProcedures} opened — and mark the result as attributable.
 *  `classify` turns the attempt's failure into the procedure's own error
 *  channel; the Effect it returns is the one marked and handed back. */
export function callScoped<A, E>(
  body: (signal: AbortSignal) => A | Promise<A>,
  classify: (attempt: Effect.Effect<A, unknown>) => Effect.Effect<A, E>,
): Effect.Effect<A, E> {
  const inCallScope = AsyncLocalStorage.snapshot();
  const effect = classify(
    Effect.tryPromise({
      try: async (signal) => inCallScope(() => body(signal)),
      catch: (err: unknown) => err,
    }),
  );
  runsInCallScope.add(effect);
  return effect;
}

interface CallSample {
  readonly at: number;
  readonly totalMs: number;
  /** Undefined when the body did not run in the call's scope. */
  readonly child:
    | { readonly runMs: number; readonly children: number }
    | undefined;
}

export interface CallsTable {
  record(procedure: string, sample: CallSample): void;
  read(): { windowMs: number; rows: PadiCallRow[] };
}

export function createCallsTable(): CallsTable {
  const samples: { procedure: string; sample: CallSample }[] = [];
  const prune = (now: number): void => {
    while (
      samples.length > 0 &&
      (samples[0]?.sample.at ?? now) < now - WINDOW_MS
    ) {
      samples.shift();
    }
  };
  return {
    record(procedure, sample) {
      prune(sample.at);
      samples.push({ procedure, sample });
    },
    read() {
      prune(performance.now());
      const byProcedure = new Map<string, CallSample[]>();
      for (const { procedure, sample } of samples) {
        const list = byProcedure.get(procedure) ?? [];
        list.push(sample);
        byProcedure.set(procedure, list);
      }
      const rows: PadiCallRow[] = [...byProcedure].map(([procedure, list]) => {
        const attributed = list.flatMap((s) => (s.child ? [s.child] : []));
        return {
          procedure,
          count: list.length,
          total: summarizeTimings(list.map((s) => s.totalMs)),
          inChildren:
            attributed.length === list.length
              ? measured({
                  summary: summarizeTimings(attributed.map((c) => c.runMs)),
                  children: attributed.reduce((n, c) => n + c.children, 0),
                })
              : unmeasured(
                  "this procedure runs as an Effect program, outside the call scope; its children are not attributed to it",
                ),
        };
      });
      rows.sort((a, b) => b.total.maxMs - a.total.maxMs);
      return { windowMs: WINDOW_MS, rows };
    },
  };
}

type Leaf = (...args: never[]) => unknown;

/** Wrap every procedure leaf of `procedures` (nested by namespace) so each
 *  call is timed under its dotted path. */
export function timeProcedures<T extends object>(
  procedures: T,
  calls: CallsTable,
  log: Logger,
  prefix = "",
): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(procedures)) {
    const name = prefix === "" ? key : `${prefix}.${key}`;
    out[key] =
      typeof value === "function"
        ? timeLeaf(name, value as Leaf, calls, log)
        : timeProcedures(value as object, calls, log, name);
  }
  return out as T;
}

function timeLeaf(
  procedure: string,
  leaf: Leaf,
  calls: CallsTable,
  log: Logger,
): Leaf {
  return (...args) => {
    const tally = createChildTally();
    // The leaf BUILDS its Effect here, inside the scope, so a `handle()` body
    // captures this call's tally.
    const effect = runInChildScope({ tally }, () =>
      leaf(...args),
    ) as Effect.Effect<unknown, unknown>;
    const attributed = runsInCallScope.has(effect);
    return Effect.suspend(() => {
      const startedAt = performance.now();
      return Effect.ensuring(
        effect,
        Effect.sync(() => {
          const totalMs = performance.now() - startedAt;
          calls.record(procedure, {
            at: performance.now(),
            totalMs,
            child: attributed
              ? { runMs: tally.runMs, children: tally.children }
              : undefined,
          });
          if (totalMs >= SLOW_CALL_MS) {
            log.warn(
              {
                procedure,
                totalMs: Math.round(totalMs),
                // Absent, not a placeholder, when the body ran outside the
                // call scope: a log query reads a missing field honestly.
                ...(attributed
                  ? {
                      childMs: Math.round(tally.runMs),
                      children: tally.children,
                    }
                  : {}),
              },
              "padi: slow call",
            );
          }
        }),
      );
    });
  };
}
