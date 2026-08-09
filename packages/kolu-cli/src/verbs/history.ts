/**
 * `kolu history` — the scrollback ABOVE the current screen, printed oldest
 * first.
 *
 * `snapshot` answers "what does this terminal show now"; this answers "what
 * scrolled past". They are two different reads because the daemon keeps them in
 * two different places: the live mirror (bounded by the viewport) and the
 * retained scrollback above it. An agent reading a long build log needs the
 * second one, and needs it in the order the terminal produced it.
 *
 * ## Why this is a pager and not a single call
 *
 * `screen.history` serves a bounded window — `max` rows ending just above a
 * caller-held cursor — because an unbounded reply would be a frame that scales
 * with the terminal's whole retained buffer, and padi's ndjson decoder CLOSES
 * the socket on an oversized frame. So the dump walks BACKWARDS a page at a
 * time: omit `before` on the first call (the host self-seeds from the top of
 * the current screen region), then feed each reply's `topLine` back as the next
 * `before`, until the host says `exhausted`. Collect the pages newest-older,
 * emit them REVERSED, and the dump reads top-to-bottom like the session did.
 *
 * `before` is `Schema.optionalKey`, which means ABSENT — an explicit
 * `before: undefined` is a decode failure, not the "self-seed from the screen
 * top" request the first iteration means. Hence the spread, never a literal
 * `undefined`.
 *
 * ## Why the `stale` arm FAILS here
 *
 * `screen.history` can answer `{kind:"stale"}` — "a width reflow renumbered the
 * absolute rows your cursor was seeded under; the numbers you hold no longer
 * point where you think". A client that got that mid-walk and simply STOPPED
 * would print a prefix of the history and exit 0, and nothing downstream could
 * tell that dump from a complete one. That is exactly the silent partial this
 * repo treats as a defect, so it fails loud instead. (The host only serves
 * `stale` to a caller that sent `epoch`, and this pager sends none — so in
 * practice the arm is a contract breach, and the message says so.)
 *
 * The port is from `kaval-tui`'s `cmdHistory`: padi's `screen.history` takes
 * the same input keys and returns the same discriminated union as kaval's
 * `getHistory`, so the walk is unchanged and only the member ref moved. The one
 * deliberate divergence is the paragraph above — kaval `break`s on `stale`.
 */

import { shortId } from "@kolu/padi/render";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { Effect } from "effect";
import type { Command } from "effect/unstable/cli";
// `import type` — fully erased, so this does NOT re-enter the command tree at
// runtime and the per-face dynamic-import fence is untouched.
import type { historyFlags } from "../cli.ts";
import { type Connection, type Endpoint, withPadi } from "../endpoint.ts";
import { type CliFailure, failure } from "../exit.ts";
import { resolveTerminal, writeErr, writeOut } from "./shared.ts";

/** How many scrollback rows one page asks for. Ported verbatim from kaval-tui's
 *  `HISTORY_PAGE_ROWS`: big enough that a long dump is a handful of round trips
 *  rather than hundreds, small enough that a page is nowhere near the frame
 *  ceiling that closes the socket. */
const HISTORY_PAGE_ROWS = 1000;

/** What the command tree parses for this verb — DERIVED from `historyFlags` in
 *  `cli.ts`. `lines` is optional, and ABSENT means the WHOLE history rather than
 *  a default page count; when present the parse has already refused anything
 *  that is not a positive whole number, BEFORE the dial. */
export type HistoryArgs = Command.Command.Config.Infer<typeof historyFlags>;

/** Write one block to stdout with exactly one trailing newline. stdout is DATA
 *  here — the scrollback bytes, VT sequences and all — so nothing else may go
 *  down this channel. A dump can be megabytes, hence `./shared.ts`'s draining
 *  sink: a slow consumer applies backpressure instead of ballooning node's write
 *  queue, and the last page is flushed rather than truncated at exit. */
const writeOutLine = (text: string): Effect.Effect<void, CliFailure> =>
  writeOut(text.endsWith("\n") ? text : `${text}\n`, "the scrollback");

/**
 * Turn one reply into the text that page contributes, or `null` for "this reply
 * contributes nothing". Ported from `kaval-tui/src/historyPage.ts`
 * (`materializeHistoryPage`) — it cannot be imported, because kaval-tui is a
 * kaval client and NO kaval dependency may enter this package; the rule it
 * encodes is about padi's reply shape, which is identical.
 *
 *  - A non-empty chunk is emitted verbatim (VT-serialized bytes).
 *  - An EMPTY chunk that still SPANS rows (`before - topLine > 0`) is an
 *    all-blank run of scrollback: serializing a blank range collapses it to "",
 *    but those blank rows are real content, so they are materialized as blank
 *    lines. Dropping the page would silently compress the dump's vertical
 *    spacing below what the terminal actually produced.
 *  - An empty chunk on the SELF-SEEDED first page (`before === undefined`) is
 *    skipped: its span is not knowable client-side (there is no prior cursor to
 *    subtract from), so a leading blank run is the one uncovered edge.
 */
function materializeHistoryPage(
  chunk: string,
  before: number | undefined,
  topLine: number,
): string | null {
  if (chunk !== "") return chunk;
  if (before === undefined) return null;
  const span = before - topLine;
  return span > 0 ? "\n".repeat(span) : null;
}

/** The `stale` arm, as the loud failure it has to be. See the module header:
 *  halting quietly would print a PREFIX of the history and exit 0. */
const staleFailure = (id: TerminalId) =>
  failure(
    `padi answered "stale" while paging ${shortId(id)}'s scrollback — the mirror was renumbered by a width reflow mid-dump, so the rows already read cannot be joined to the rest. Nothing partial was printed; re-run \`kolu history\` once the terminal's width has settled.`,
  );

/** One page: the N older lines immediately above the screen. No cursor is sent,
 *  so the host self-seeds from the top of the current screen region — which is
 *  exactly "the N lines that just scrolled off".
 *
 *  `max` is a positive int in the contract, and the PARSE is what enforces that
 *  (`positiveLines` in `cli.ts`). It used to be enforced here — after the dial
 *  and after the roster read — so `kolu history <id> --lines 0 --host box`
 *  ssh-provisioned a cold machine before saying "that is not a positive
 *  number", while `snapshot --tail 0` refused instantly on the same rule. */
function onePage(
  conn: Connection,
  id: TerminalId,
  max: number,
): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    const res = yield* conn.client.surface.screen.history({ id, max });
    if (res.kind === "stale") return yield* Effect.fail(staleFailure(id));
    const page = materializeHistoryPage(res.chunk, undefined, res.topLine);
    if (page !== null) yield* writeOutLine(page);
    yield* writeErr(`— ${shortId(id)} · older history (≤${max} lines)\n`);
  });
}

/** The whole retained scrollback: page from the screen top back to the oldest
 *  line the host still keeps. Fetched newest-older, emitted OLDEST-first. */
function wholeHistory(
  conn: Connection,
  id: TerminalId,
): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    const pages: string[] = [];
    let before: number | undefined;
    for (;;) {
      const res = yield* conn.client.surface.screen.history({
        id,
        // ABSENT on the first iteration (self-seed), present thereafter — an
        // explicit `undefined` would be a decode failure, not a request.
        ...(before === undefined ? {} : { before }),
        max: HISTORY_PAGE_ROWS,
      });
      if (res.kind === "stale") return yield* Effect.fail(staleFailure(id));
      // An all-blank page serializes to "" but is NOT exhaustion — the cursor
      // still moved, so keep walking or content ABOVE a blank run is cut off.
      // Only `exhausted` (the top of the retained mirror) ends the dump.
      const page = materializeHistoryPage(res.chunk, before, res.topLine);
      if (page !== null) pages.push(page);
      before = res.topLine;
      if (res.exhausted) break;
    }
    for (const chunk of pages.slice().reverse()) yield* writeOutLine(chunk);
    yield* writeErr(
      `— ${shortId(id)} · ${pages.length} older page${pages.length === 1 ? "" : "s"}\n`,
    );
  });
}

/** The verb. `withPadi` owns the link's lifetime, so an interrupt partway
 *  through the walk releases exactly what was acquired; failures ride the error
 *  channel so the run edge in `main.ts` — and nothing here — owns the exit code.
 */
export function run(
  endpoint: Endpoint,
  args: HistoryArgs,
): Effect.Effect<void, unknown> {
  return withPadi(endpoint, (conn) =>
    Effect.gen(function* () {
      const id = yield* resolveTerminal(conn, args.id);
      return yield* args.lines === undefined
        ? wholeHistory(conn, id)
        : onePage(conn, id, args.lines);
    }),
  );
}
