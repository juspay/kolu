/**
 * The data side of padi's CLI faces — reading padi's `terminals` collection from
 * a connected client, factored out of each `main.ts` so it is testable against a
 * real padi over a real socket with no tty. Two one-shot reads live here: the key
 * set (`readTerminalKeys`, prefix resolution) and `settledSnapshot` (`status`).
 * The LIVE side — `watchTerminals` for `watch` and `awaitAgentState` for
 * `wait` — graduated into the dial kit (`watch.ts`) when the kolu MCP face became
 * its verbatim second consumer; these one-shot reads followed it here when kolu's
 * CLI became THEIR second consumer, so both faces read one implementation.
 *
 * padi's compatibility is gated at DIAL (`connectPadi` refuses a contract skew
 * loudly), so — unlike the retired pulam-tui — there is no separate `assertCompatible` read.
 *
 * Both reads are EFFECTS. Not a spelling change: `status` is a bounded read that
 * must die on Ctrl+C and must not outlive the command that asked for it, and an
 * `await` is precisely what interruption cannot reach through. Composed instead,
 * the CLI's own cancellation tears every subscription this module opens down
 * through their own finalizers, and `main.ts` runs the whole command once.
 */

import type { PadiSurfaceClient } from "./dial.ts";
import { firstFrameOrThrow } from "@kolu/surface/first-frame";
import { mirrorRemoteSurface } from "@kolu/surface/mirror";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { Deferred, Effect } from "effect";
import { padiSurface, type PadiTerminal } from "./surface.ts";

/** The current terminal key set — the FIRST frame of the `keys` snapshot-then-delta
 *  stream. The `keys` collection ALWAYS opens with a snapshot frame (zero terminals
 *  is a defined empty array, not an empty stream), so an empty stream means the
 *  link/protocol failed — this surfaces it loudly rather than collapsing to "no
 *  terminals" (which `resolveOne` would then misreport as `no terminal matching
 *  <id>`, and `status` would render as a blank table —
 *  caught-error-must-not-collapse-to-empty). The ONE home for the snapshot-frame
 *  contract and its failure string, shared by {@link settledSnapshot} and the
 *  CLI's id-prefix resolution (`wait` / `create --parent`, which need only the ids,
 *  never each terminal's value — so they read the key set, not the whole snapshot).
 *
 *  `keys` hands back a LAZY `Stream` synchronously — nothing is subscribed until
 *  it is consumed, and there is no `signal` to pass (D10/#18: cancellation is
 *  fiber interruption). `firstFrameOrThrow` takes that `Stream` directly and
 *  reads it with `Stream.runHead`, which interrupts the rest once the snapshot is
 *  in hand — so this one-shot read tears its own subscription down, and
 *  interrupting the READ tears it down too. The member ref is built INSIDE the
 *  effect, so a client that throws SYNCHRONOUSLY (a wrong-surface client) arrives
 *  as a failure on the error channel, never as a throw past the caller. */
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

/** A composed record is "resolved enough to show" once its live sensors have
 *  landed. A dormant record (`sleeping`/`parked`) is a persisted projection, not
 *  mid-sensing, so it is always resolved. An `active` one is resolved once ANY of
 *  git / agent / foreground has landed, or its PR has left `pending` — a
 *  just-spawned terminal seeds all-null and fills in a beat later. */
function isResolved(v: PadiTerminal): boolean {
  if (v.state !== "active") return true;
  return (
    v.git !== null ||
    v.agent !== null ||
    v.foreground !== null ||
    v.pr.kind !== "pending"
  );
}

/** Which arm of the settle race answered. Both arms SUCCEED — a dropped link
 *  carried as a value and re-raised after the race, never as a failure inside it,
 *  because `raceAll` ignores an early failure and keeps waiting for a success
 *  (the same trap `firstFrameOfCollectionItem` documents one layer down). */
type SettleOutcome = "settled" | "link-closed";

/** A snapshot that WAITS for padi's sensors to resolve, for `status`. Against a
 *  warm local padi every value arrives resolved, so this settles at once
 *  (sub-`graceMs`); against a padi that just spawned a terminal it waits just long
 *  enough for the sensors, then lingers `graceMs` to catch siblings landing in the
 *  same burst — capping the whole wait at `maxMs`. A terminal the sensors
 *  legitimately resolve to "nothing" never flips `isResolved`, so it falls through
 *  at `maxMs` — bounded, never a hang.
 *
 *  The three ways this read can end are three arms of ONE race, and that is the
 *  whole shape:
 *
 *    - every expected key resolved, then `graceMs` of quiet → the snapshot;
 *    - `maxMs` elapsed → the snapshot anyway (bounded, never a hang);
 *    - the mirror ended on its own → the LINK dropped mid-read, which FAILS loud
 *      rather than returning a partial table (caught-error-must-not-collapse-to-
 *      empty).
 *
 *  It used to be an `AbortController`, two timers, a hand-rolled deferred, and
 *  two latches (`stopped`, `linkFailed`) whose only job was to decide, after the
 *  fact, which of those three happened first. Racing them answers that
 *  structurally: whichever arm wins interrupts the others, and the mirror's
 *  scope-close finalizer is what unwinds the subscriptions — so there is no
 *  ordering left for a trailing grace timer to get wrong. */
export function settledSnapshot(
  client: PadiSurfaceClient,
  opts: { maxMs?: number; graceMs?: number } = {},
): Effect.Effect<Array<[TerminalId, PadiTerminal]>, unknown> {
  const maxMs = opts.maxMs ?? 3000;
  const graceMs = opts.graceMs ?? 1500;
  return Effect.scoped(
    Effect.gen(function* () {
      // The key set padi first reports — the terminals we wait to resolve.
      const expected = yield* readTerminalKeys(client);

      const acc = new Map<TerminalId, PadiTerminal>();
      const allResolved = yield* Deferred.make<void>();
      // The first non-abort upstream blip, so a failure carries a diagnostic
      // rather than surfacing as a bare "link closed".
      let upstreamError: string | undefined;

      const considerSettling = (): void => {
        const done =
          expected.length === 0 ||
          expected.every((k) => {
            const v = acc.get(k);
            return v === undefined ? false : isResolved(v);
          });
        // `doneUnsafe` is idempotent — the first completion wins and later ones
        // are no-ops. That is what retires the `graceTimer === undefined` guard:
        // "arm the grace window exactly once" is a property of the deferred, not
        // a flag this callback has to maintain.
        if (done) Deferred.doneUnsafe(allResolved, Effect.void);
      };

      // The mirror is a SCOPED resource: acquiring it opens the subscriptions,
      // releasing it aborts them and waits for the unwind. Every exit path from
      // this effect — a winning arm, a failure, a Ctrl+C interrupting the whole
      // command — runs that release, which is what the `finally { abort.abort() }`
      // and the `.done.then(…)` bookkeeping used to approximate.
      const mirror = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const abort = new AbortController();
          const handle = mirrorRemoteSurface(
            padiSurface,
            client,
            {
              collections: {
                terminals: {
                  upsert: (id, value) => {
                    acc.set(id, value);
                    considerSettling();
                  },
                  remove: (id) => {
                    acc.delete(id);
                    considerSettling();
                  },
                },
              },
              // Subscribe to `activity` too — not for its data (ignored here) but
              // because a collection-only mirror has nothing holding it open: it
              // would settle its `.done` right after the initial snapshot and stop
              // delivering the very resolution deltas we're waiting for. The
              // (snapshot-then-delta) activity stream keeps the mirror live until
              // the scope closes, exactly as `watch` does.
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
            // Swallowed deliberately: this is the TEARDOWN's outcome, never the
            // read's. A real mid-read drop is reported by the race arm below,
            // which observes the same promise while the read is still live.
            return handle.done.then(
              () => undefined,
              () => undefined,
            );
          }),
      );

      const outcome = yield* Effect.raceAll<Effect.Effect<SettleOutcome>>([
        // Sensors landed — linger `graceMs` to catch siblings in the same burst.
        Effect.as(
          Effect.flatMap(Deferred.await(allResolved), () =>
            Effect.sleep(graceMs),
          ),
          "settled",
        ),
        // The hard cap. Bounded, never a hang.
        Effect.as(Effect.sleep(maxMs), "settled"),
        // The mirror ended by itself. Since the only other way it ends is our own
        // scope close — which happens strictly AFTER this race — reaching here at
        // all means the link dropped under us.
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
        return yield* Effect.fail(
          new Error(
            upstreamError ??
              "the padi link closed before the terminal snapshot settled — the daemon stopped or the connection dropped. Is `padi` still running?",
          ),
        );
      }
      return [...acc.entries()];
    }),
  );
}
