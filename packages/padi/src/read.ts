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
import { Data, Deferred, Effect } from "effect";
import { padiSurface, type PadiTerminal } from "./surface.ts";
import { PADI_LINK_CLOSED } from "./terminalVocab.ts";

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

// ── The scrollback pager ─────────────────────────────────────────────────────
//
// Correctly consuming `screen.history` is a multi-round-trip PROTOCOL
// discipline, not a call: seed `before` ABSENT (never `undefined` — the key is
// `Schema.optionalKey`, so an explicit undefined is a decode failure rather
// than the "self-seed from the screen top" request the first iteration means),
// feed each reply's `topLine` back as the next `before`, materialize a blank
// span from `before - topLine`, and terminate only on `exhausted`. Its failure
// mode is a silently truncated dump that exits 0, which is why it lives beside
// the reply shape it is a rule ABOUT rather than in each face that dumps
// scrollback. `kaval-tui` keeps its own copy until it is retired — it is a
// kaval client and may not import padi — but no padi client writes a second
// one.

/** How many scrollback rows one page asks for. Big enough that a long dump is a
 *  handful of round trips rather than hundreds, small enough that a page is
 *  nowhere near the frame ceiling that closes the socket (padi's ndjson decoder
 *  drops the link on an oversized frame, which is the whole reason this is a
 *  pager). */
export const HISTORY_PAGE_ROWS = 1000;

/** padi answered `stale` mid-walk: a width reflow renumbered the absolute rows
 *  the cursor was seeded under, so the rows already read cannot be joined to the
 *  rest.
 *
 *  A tagged FAILURE, never a `break`. A client that got this and simply STOPPED
 *  would print a prefix of the history and exit 0, and nothing downstream could
 *  tell that dump from a complete one — the silent partial this repo treats as a
 *  defect. (The host only serves `stale` to a caller that sent `epoch`, and this
 *  pager sends none, so in practice it is a contract breach.) The face phrases
 *  the sentence; the RULE that it is a failure is padi's. */
export class PadiHistoryStale extends Data.TaggedError("PadiHistoryStale")<{
  readonly id: TerminalId;
}> {}

/** Is this rejection the `stale` halt? A `_tag` compare rather than
 *  `instanceof`, for the reason `isContractSkewError` is a brand check: a face
 *  and the padi kit that raised the error can sit on different module instances
 *  of this package, and a tag compare is realm-safe by construction. Exported so
 *  a face maps it to its own sentence without re-deriving the test. */
export const isPadiHistoryStale = (err: unknown): err is PadiHistoryStale =>
  (err as { readonly _tag?: unknown })?._tag === "PadiHistoryStale";

/** Turn one reply into the text that page contributes, or `null` for "this reply
 *  contributes nothing".
 *
 *   - A non-empty chunk is emitted verbatim (VT-serialized bytes).
 *   - An EMPTY chunk that still SPANS rows (`before - topLine > 0`) is an
 *     all-blank run of scrollback: serializing a blank range collapses it to "",
 *     but those blank rows are real content, so they are materialized as blank
 *     lines. Dropping the page would silently compress the dump's vertical
 *     spacing below what the terminal actually produced.
 *   - An empty chunk on the SELF-SEEDED first page (`before === undefined`) is
 *     skipped: its span is not knowable client-side (there is no prior cursor to
 *     subtract from), so a leading blank run is the one uncovered edge. */
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

/** ONE page: the `max` older lines immediately above the screen. No cursor is
 *  sent, so the host self-seeds from the top of the current screen region —
 *  which is exactly "the lines that just scrolled off". `null` means the reply
 *  contributed nothing. */
export function readHistoryPage(
  client: PadiSurfaceClient,
  id: TerminalId,
  max: number,
): Effect.Effect<string | null, unknown> {
  return Effect.flatMap(client.surface.screen.history({ id, max }), (res) =>
    res.kind === "stale"
      ? Effect.fail(new PadiHistoryStale({ id }))
      : Effect.succeed(
          materializeHistoryPage(res.chunk, undefined, res.topLine),
        ),
  );
}

/** The WHOLE retained scrollback, OLDEST-FIRST: page from the screen top back
 *  to the oldest line the host still keeps.
 *
 *  Fetched newest-older (that is the only direction the wire serves) and handed
 *  back reversed, so a caller writes the pages in the order the session
 *  produced them. An all-blank page serializes to "" but is NOT exhaustion —
 *  the cursor still moved — so only `exhausted` ends the walk; treating "" as
 *  the end would cut off everything ABOVE a blank run. */
export function readWholeHistory(
  client: PadiSurfaceClient,
  id: TerminalId,
): Effect.Effect<readonly string[], unknown> {
  return Effect.gen(function* () {
    const newestFirst: string[] = [];
    let before: number | undefined;
    for (;;) {
      const res = yield* client.surface.screen.history({
        id,
        ...(before === undefined ? {} : { before }),
        max: HISTORY_PAGE_ROWS,
      });
      if (res.kind === "stale")
        return yield* Effect.fail(new PadiHistoryStale({ id }));
      const page = materializeHistoryPage(res.chunk, before, res.topLine);
      if (page !== null) newestFirst.push(page);
      before = res.topLine;
      if (res.exhausted) break;
    }
    return newestFirst.reverse();
  });
}

/** A composed record is "resolved enough to show" once its live sensors have
 *  landed. A dormant record (`sleeping`/`parked`) is a persisted projection, not
 *  mid-sensing, so it is always resolved. An `active` one is resolved once ANY of
 *  git / agent / foreground has landed, or its PR has left `pending` — a
 *  just-spawned terminal seeds all-null and fills in a beat later.
 *
 *  ANY, deliberately: a terminal outside a repo has no branch and no PR to find,
 *  and one sitting at a shell has no agent, so requiring all four would wait out
 *  `maxMs` on perfectly ordinary rows. The price of that weakness is that this
 *  goes true on the FIRST sensor to land, several hundred milliseconds before the
 *  rest of a fresh terminal's row exists — which is why {@link settledSnapshot}
 *  does not return the moment this passes. */
function isResolved(v: PadiTerminal): boolean {
  if (v.state !== "active") return true;
  return (
    v.git !== null ||
    v.agent !== null ||
    v.foreground !== null ||
    v.pr.kind !== "pending"
  );
}

/** WHICH of a record's four sensed facts padi has actually observed, as a
 *  bitmask. The point is the DIRECTION of change: a bit can only be set by a
 *  sensor landing, so `next & ~prev` is exactly "a sensor reported since the last
 *  frame" and nothing else. That is what separates a terminal still filling in
 *  from a terminal merely being BUSY — an agent flipping thinking→tools, a
 *  foreground retitling itself, an activity tick — all of which re-publish the
 *  record without adding a fact. On a machine with agents at work those account
 *  for nearly every frame, so a settle rule that counted frames rather than facts
 *  would never see the roster go still (measured: 952ms, and unbounded in
 *  principle) while learning nothing.
 *
 *  A dormant record is a persisted projection with no sensor pointed at it, so it
 *  reads as fully observed and can never be the reason a read waits. */
function sensedMask(v: PadiTerminal): number {
  if (v.state !== "active") return 0b1111;
  return (
    (v.git !== null ? 0b0001 : 0) |
    (v.agent !== null ? 0b0010 : 0) |
    (v.foreground !== null ? 0b0100 : 0) |
    (v.pr.kind !== "pending" ? 0b1000 : 0)
  );
}

/** Which arm of the settle race answered. Both arms SUCCEED — a dropped link
 *  carried as a value and re-raised after the race, never as a failure inside it,
 *  because `raceAll` ignores an early failure and keeps waiting for a success
 *  (the same trap `firstFrameOfCollectionItem` documents one layer down). */
type SettleOutcome = "settled" | "link-closed";

/** A snapshot that WAITS for padi's sensors to resolve, for `status` / `kolu ls`.
 *  It ends when every expected key is resolved AND the roster has stopped GAINING
 *  FACTS — capping the whole wait at `maxMs`. A terminal the sensors
 *  legitimately resolve to "nothing" never flips `isResolved`, so it falls
 *  through at `maxMs` — bounded, never a hang.
 *
 *  ## Why the trailing wait is QUIET and not a fixed sleep
 *
 *  The wait after `isResolved` exists because {@link isResolved} is deliberately
 *  weak: ANY one sensor landing makes a record "resolved enough to show", so a
 *  terminal spawned a beat ago passes that test the instant its foreground
 *  appears — while its branch, its PR, and its siblings are still on the way.
 *  Returning there prints dashes for facts that were seconds from arriving.
 *
 *  This used to be a flat `sleep(1500)` after the deferred, paid unconditionally.
 *  Measured against a live padi with 10 warm terminals, that cost **1509ms for a
 *  roster that was complete at 8ms** — and `ls` is the roster every driving agent
 *  runs, so it was paid constantly and for nothing.
 *
 *  It cannot be made conditional on what the FIRST frame looks like, which is the
 *  obvious fix and is wrong. A record mid-spawn and a record that will never have
 *  more to say are BYTE-IDENTICAL: `git: null` means "no repo" or "not probed
 *  yet", `pr: pending` means "no repo to ask about" or "the forge call is in
 *  flight". There is no field that separates them, so no first-frame predicate
 *  can. (Measured: gating the window on "was anything unresolved at first sight?"
 *  returns `—` for a terminal created a beat earlier in a git repo, where the flat
 *  sleep returned its branch.)
 *
 *  What DOES separate them is observable, and it is the only thing that is: a
 *  fresh terminal's record GAINS FACTS as you watch it. It is published all-null
 *  and then re-published once per sensor (measured on a live padi: foreground at
 *  +33ms, branch at +101ms, PR at +467ms), while a settled record's facts are
 *  already all there. So the trailing wait is for QUIET, measured in facts rather
 *  than in frames: `quietMs` with no new fact landing anywhere on the roster (see
 *  {@link sensedMask}). It re-arms every time one does, which makes it strictly
 *  more faithful than the sleep it replaces — it follows a burst however long the
 *  burst runs (to `maxMs`) instead of betting that 1500ms covered it.
 *
 *  FACTS, not frames, is the load-bearing half of that. A machine with agents at
 *  work republishes records constantly — a spinner retitles, an agent flips
 *  thinking→tools — and none of it adds a fact. A window that re-armed on frames
 *  never saw such a roster go still (measured: 952ms, and unbounded in principle),
 *  which is a slower read than the flat sleep it was meant to replace.
 *
 *  The three ways this read can end are three arms of ONE race, and that is the
 *  whole shape:
 *
 *    - every expected key resolved, then `quietMs` with no new fact → the
 *      snapshot;
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
 *  ordering left for a trailing timer to get wrong. */
export function settledSnapshot(
  client: PadiSurfaceClient,
  opts: { maxMs?: number; quietMs?: number } = {},
): Effect.Effect<Array<[TerminalId, PadiTerminal]>, unknown> {
  const maxMs = opts.maxMs ?? 3000;
  // Long enough to bridge the gaps WITHIN a spawn's sensor burst (the widest
  // measured is the forge call, ~370ms behind the branch probe), short enough
  // that a settled roster pays it once and is gone.
  const quietMs = opts.quietMs ?? 500;
  return Effect.scoped(
    Effect.gen(function* () {
      // The key set padi first reports — the terminals we wait to resolve.
      const expected = yield* readTerminalKeys(client);

      const acc = new Map<TerminalId, PadiTerminal>();
      const allResolved = yield* Deferred.make<void>();
      // The first non-abort upstream blip, so a failure carries a diagnostic
      // rather than surfacing as a bare "link closed".
      let upstreamError: string | undefined;
      // When the roster last GAINED something: a key arriving, a key leaving, or
      // a sensor reporting a fact that was not there before (see
      // {@link sensedMask}). Seeded at the read's start, so a roster that says
      // nothing at all still has to hold still for `quietMs` before we believe it.
      let lastSensedAt = Date.now();

      const considerSettling = (): void => {
        const done =
          expected.length === 0 ||
          expected.every((k) => {
            const v = acc.get(k);
            return v === undefined ? false : isResolved(v);
          });
        // `doneUnsafe` is idempotent — the first completion wins and later ones
        // are no-ops. That is what retires the old `graceTimer === undefined`
        // guard: "cross this line exactly once" is a property of the deferred,
        // not a flag this callback has to maintain.
        if (done) Deferred.doneUnsafe(allResolved, Effect.void);
      };

      // An EMPTY roster settles HERE or nowhere: the check above only ever runs
      // from the sink, and a roster with no keys produces no upsert to run it
      // from — so without this call the zero-terminal read would sit out the whole
      // `maxMs` waiting for a frame that by definition never comes.
      considerSettling();

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
                    const prev = acc.get(id);
                    // A key we have never seen is the roster GROWING, and a frame
                    // that adds a sensed fact is a sensor LANDING. Everything else
                    // — the same facts republished because an agent ticked — is
                    // noise this window must not chase.
                    if (
                      prev === undefined ||
                      (sensedMask(value) & ~sensedMask(prev)) !== 0
                    ) {
                      lastSensedAt = Date.now();
                    }
                    acc.set(id, value);
                    considerSettling();
                  },
                  remove: (id) => {
                    // A departure is the roster moving as much as an arrival is.
                    lastSensedAt = Date.now();
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

      // "`quietMs` since the last fact landed", read off the same clock the sink
      // stamps. It SLEEPS THE REMAINDER and re-checks rather than sleeping a flat
      // `quietMs`: a sensor that reports mid-window pushes the deadline out, which
      // is the whole difference between waiting for a burst to END and betting on
      // how long a burst takes. Self-recursive, so a burst of any length is one
      // expression rather than a loop with a counter.
      const untilQuiet: Effect.Effect<void> = Effect.suspend(() => {
        const remaining = quietMs - (Date.now() - lastSensedAt);
        return remaining <= 0
          ? Effect.void
          : Effect.flatMap(Effect.sleep(remaining), () => untilQuiet);
      });

      const outcome = yield* Effect.raceAll<Effect.Effect<SettleOutcome>>([
        // Every expected key is resolved AND no sensor has reported for a while.
        // The two conditions answer different questions — "is there anything left
        // to show?" and "is padi still filling records in?" — and `ls` is wrong
        // without either (see the header).
        Effect.as(
          Effect.flatMap(Deferred.await(allResolved), () => untilQuiet),
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
        // The shared sentence, not a fourth spelling of it: what a user can
        // act on is the same whichever read was in flight.
        return yield* Effect.fail(new Error(upstreamError ?? PADI_LINK_CLOSED));
      }
      return [...acc.entries()];
    }),
  );
}
