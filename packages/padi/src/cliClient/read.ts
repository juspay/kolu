import type { PadiSurfaceClient } from "@kolu/padi-client/dial";
import { type PadiTerminal, padiSurface } from "@kolu/padi-client/surface";
import { PADI_LINK_CLOSED } from "@kolu/padi-client/terminalVocab";
import { firstFrameOrThrow } from "@kolu/surface/first-frame";
import { mirrorRemoteSurface } from "@kolu/surface/mirror";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { Data, Deferred, Effect } from "effect";

/** The current terminal key set — the FIRST frame of the `keys`
 *  snapshot-then-delta stream. A stream that ends without a snapshot frame
 *  fails on the error channel rather than answering an empty roster. */
export function readTerminalKeys(
  client: PadiSurfaceClient,
): Effect.Effect<readonly TerminalId[], unknown> {
  return Effect.suspend(() =>
    firstFrameOrThrow(
      client.surface.terminals.keys(undefined),
      "padi terminals keys yielded no snapshot frame — link or protocol failure.",
    ),
  );
}

/** How many scrollback rows one page asks for. */
export const HISTORY_PAGE_ROWS = 1000;

/** padi answered `stale` mid-walk: a width reflow renumbered the absolute rows
 *  the walk was paging through. A tagged FAILURE, never a `break` — a client
 *  that stops here has a truncated history and must know it. */
export class PadiHistoryStale extends Data.TaggedError("PadiHistoryStale")<{
  readonly id: TerminalId;
}> {}

/** Is this rejection the `stale` halt? */
export const isPadiHistoryStale = (err: unknown): err is PadiHistoryStale =>
  (err as { readonly _tag?: unknown })?._tag === "PadiHistoryStale";

/** Turn one reply into the text that page contributes, or `null` for "this
 *  reply adds nothing": a blank span above the screen is materialized as
 *  newlines so the rows keep their absolute positions. */
export function materializeHistoryPage(
  chunk: string,
  before: number | undefined,
  topLine: number,
): string | null {
  if (chunk !== "") return chunk;
  if (before === undefined) return null;
  const span = before - topLine;
  return span > 0 ? "\n".repeat(span) : null;
}

interface HistoryPageReply {
  readonly chunk: string;
  readonly topLine: number;
  readonly exhausted: boolean;
}

/** The scrollback walk, owned: the FIRST page omits `before` entirely (an
 *  explicit `undefined` fails the `optionalKey` decode), every later page feeds
 *  the previous reply's `topLine` back, and the walk ends only on `exhausted`. */
export interface HistoryCursor {
  page(): {
    readonly id: TerminalId;
    readonly max: number;
    readonly before?: number;
  };
  take(reply: HistoryPageReply): {
    readonly text: string | null;
    readonly done: boolean;
  };
}

/** Open a cursor over one terminal's scrollback, `max` rows per page. */
export function historyCursor(id: TerminalId, max: number): HistoryCursor {
  let before: number | undefined;
  return {
    page: () => ({ id, max, ...(before === undefined ? {} : { before }) }),
    take: (reply) => {
      const text = materializeHistoryPage(reply.chunk, before, reply.topLine);
      before = reply.topLine;
      return { text, done: reply.exhausted };
    },
  };
}

/** ONE page: the `max` older lines immediately above the screen. */
export function readHistoryPage(
  client: PadiSurfaceClient,
  id: TerminalId,
  max: number,
): Effect.Effect<string | null, unknown> {
  const cursor = historyCursor(id, max);
  return Effect.flatMap(client.surface.screen.history(cursor.page()), (res) =>
    res.kind === "stale"
      ? Effect.fail(new PadiHistoryStale({ id }))
      : Effect.succeed(cursor.take(res).text),
  );
}

/** The WHOLE retained scrollback, OLDEST-FIRST — pages from the screen top
 *  back until padi says `exhausted`, or fails {@link PadiHistoryStale}. */
export function readWholeHistory(
  client: PadiSurfaceClient,
  id: TerminalId,
): Effect.Effect<readonly string[], unknown> {
  return Effect.gen(function* () {
    const cursor = historyCursor(id, HISTORY_PAGE_ROWS);
    const newestFirst: string[] = [];
    for (;;) {
      const res = yield* client.surface.screen.history(cursor.page());
      if (res.kind === "stale")
        return yield* Effect.fail(new PadiHistoryStale({ id }));
      const { text, done } = cursor.take(res);
      if (text !== null) newestFirst.push(text);
      if (done) break;
    }
    return newestFirst.reverse();
  });
}

function isResolved(v: PadiTerminal): boolean {
  if (v.state !== "active") return true;
  return (
    v.git.kind !== "unresolved" ||
    v.agent !== null ||
    v.foreground !== null ||
    v.pr.kind !== "pending"
  );
}

function sensedMask(v: PadiTerminal): number {
  if (v.state !== "active") return 0b1111;
  return (
    (v.git.kind !== "unresolved" ? 0b0001 : 0) |
    (v.agent !== null ? 0b0010 : 0) |
    (v.foreground !== null ? 0b0100 : 0) |
    (v.pr.kind !== "pending" ? 0b1000 : 0)
  );
}

type SettleOutcome = "settled" | "link-closed";

interface RosterQuiet {
  readonly seen: ReadonlyMap<TerminalId, PadiTerminal>;
  upsert(id: TerminalId, value: PadiTerminal): void;
  remove(id: TerminalId): void;
  readonly settled: Effect.Effect<void>;
}

function untilRosterQuiet(args: {
  readonly expected: readonly TerminalId[];
  readonly quietMs: number;
}): Effect.Effect<RosterQuiet> {
  const { expected, quietMs } = args;
  return Effect.map(Deferred.make<void>(), (allResolved) => {
    const seen = new Map<TerminalId, PadiTerminal>();
    let lastSensedAt = Date.now();

    const considerSettling = (): void => {
      const done =
        expected.length === 0 ||
        expected.every((k) => {
          const v = seen.get(k);
          return v === undefined ? false : isResolved(v);
        });
      if (done) Deferred.doneUnsafe(allResolved, Effect.void);
    };
    considerSettling();

    const quiet: Effect.Effect<void> = Effect.suspend(() => {
      const remaining = quietMs - (Date.now() - lastSensedAt);
      return remaining <= 0
        ? Effect.void
        : Effect.flatMap(Effect.sleep(remaining), () => quiet);
    });

    return {
      seen,
      upsert: (id, value) => {
        const prev = seen.get(id);
        if (
          prev === undefined ||
          (sensedMask(value) & ~sensedMask(prev)) !== 0
        ) {
          lastSensedAt = Date.now();
        }
        seen.set(id, value);
        considerSettling();
      },
      remove: (id) => {
        lastSensedAt = Date.now();
        seen.delete(id);
        considerSettling();
      },
      settled: Effect.flatMap(Deferred.await(allResolved), () => quiet),
    };
  });
}

/** A snapshot that WAITS for padi's sensors to resolve, for `status` /
 *  `kolu ls`. Three arms of one race, all bounded: every expected terminal
 *  resolved and the roster then quiet for `quietMs`; `maxMs` elapsed (the
 *  snapshot anyway, never a hang); or the link dropped, which FAILS. */
export function settledSnapshot(
  client: PadiSurfaceClient,
  opts: { maxMs?: number; quietMs?: number } = {},
): Effect.Effect<Array<[TerminalId, PadiTerminal]>, unknown> {
  const maxMs = opts.maxMs ?? 3000;
  const quietMs = opts.quietMs ?? 500;
  return Effect.scoped(
    Effect.gen(function* () {
      const expected = yield* readTerminalKeys(client);
      const roster = yield* untilRosterQuiet({ expected, quietMs });
      let upstreamError: string | undefined;

      const mirror = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const abort = new AbortController();
          const handle = mirrorRemoteSurface(
            padiSurface,
            client,
            {
              collections: {
                terminals: {
                  upsert: (id, value) => roster.upsert(id, value),
                  remove: (id) => roster.remove(id),
                },
              },
              streams: { activity: { input: {}, onFrame: () => {} } },
            },
            {
              signal: abort.signal,
              log: (line) => {
                upstreamError ??= line;
              },
            },
          );
          return { abort, handle };
        }),
        ({ abort, handle }) =>
          Effect.promise(() => {
            abort.abort();
            return handle.done.then(
              () => undefined,
              () => undefined,
            );
          }),
      );

      const outcome = yield* Effect.raceAll<Effect.Effect<SettleOutcome>>([
        Effect.as(roster.settled, "settled"),
        Effect.as(Effect.sleep(maxMs), "settled"),
        Effect.as(
          Effect.promise(() =>
            mirror.handle.done.then(
              () => undefined,
              (err: unknown) => {
                upstreamError ??=
                  err instanceof Error ? err.message : String(err);
              },
            ),
          ),
          "link-closed",
        ),
      ]);

      if (outcome === "link-closed") {
        return yield* Effect.fail(new Error(upstreamError ?? PADI_LINK_CLOSED));
      }
      return [...roster.seen.entries()];
    }),
  );
}
