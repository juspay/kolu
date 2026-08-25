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
 * ## The PAGER is padi's, the sentences are this verb's
 *
 * `screen.history` serves a bounded window — `max` rows ending just above a
 * caller-held cursor — because an unbounded reply would be a frame that scales
 * with the terminal's whole retained buffer, and padi's ndjson decoder CLOSES
 * the socket on an oversized frame. Walking that correctly (absent-not-
 * `undefined` seeding, feeding `topLine` back as `before`, materializing a
 * blank span, terminating only on `exhausted`, FAILING on `stale`) is a
 * protocol discipline whose failure mode is a silently truncated dump that
 * exits 0 — so it lives in `@kolu/padi/read` beside the reply shape it is a
 * rule about (`readHistoryPage` / `readWholeHistory`), not in the composition
 * root. It was a hand-rolled copy here, and the copy it was ported from
 * (kaval-tui's) had ALREADY diverged: kaval `break`s on `stale` and prints the
 * prefix.
 *
 * What stays is what is genuinely this face's: writing the blocks to stdout under
 * the CLI's output discipline, the trailer, and the sentence a `stale` reply is
 * reported with.
 */

import {
  isPadiHistoryStale,
  readHistoryPage,
  readWholeHistory,
} from "@kolu/padi/read";
import { shortId } from "@kolu/padi/render";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { Effect } from "effect";
import type { Command } from "effect/unstable/cli";
// `import type` — fully erased, so this does NOT re-enter the command tree at
// runtime and the per-face dynamic-import fence is untouched.
import type { historyFlags } from "../cli.ts";
import { type Connection, type Endpoint, withPadi } from "../endpoint.ts";
import { failure } from "../exit.ts";
import { resolveTerminal, writeErr, writeOutBlock } from "./shared.ts";

/** What the command tree parses for this verb — DERIVED from `historyFlags` in
 *  `cli.ts`. `lines` is optional, and ABSENT means the WHOLE history rather than
 *  a default page count; when present the parse has already refused anything
 *  that is not a positive whole number, BEFORE the dial. */
export type HistoryArgs = Command.Command.Config.Infer<typeof historyFlags>;

/** The `stale` arm's SENTENCE. padi decides that a `stale` reply is a failure
 *  (`PadiHistoryStale`) — halting quietly would print a PREFIX of the history
 *  and exit 0; this face decides how to say so, in the vocabulary of the command
 *  the user typed. */
const staleFailure = (id: TerminalId) =>
  failure(
    `padi answered "stale" while paging ${shortId(id)}'s scrollback — the mirror was renumbered by a width reflow mid-dump, so the rows already read cannot be joined to the rest. Nothing partial was printed; re-run \`kolu history\` once the terminal's width has settled.`,
  );

/** Read the pages the user asked for — ONE page (`--lines N`, the lines just
 *  above the screen) or the whole retained scrollback, oldest-first either way.
 *
 *  `max` is a positive int in the contract, and the PARSE is what enforces that
 *  (`positiveLines` in `cli.ts`). It used to be enforced inside here — after the
 *  dial and after the roster read — so `kolu history <id> --lines 0 --host box`
 *  ssh-provisioned a cold machine before saying "that is not a positive
 *  number", while `snapshot --tail 0` refused instantly on the same rule. */
function readPages(
  conn: Connection,
  id: TerminalId,
  lines: number | undefined,
): Effect.Effect<readonly string[], unknown> {
  const read =
    lines === undefined
      ? readWholeHistory(conn.client, id)
      : Effect.map(readHistoryPage(conn.client, id, lines), (page) =>
          page === null ? [] : [page],
        );
  return Effect.catch(read, (err) =>
    Effect.fail(isPadiHistoryStale(err) ? staleFailure(id) : err),
  );
}

/**
 * The verb: read inside the scope, WRITE AFTER IT.
 *
 * `ls.ts` states the rule at length — a reader piping into a pager could
 * otherwise hold a padi subscription open for as long as they scroll — and
 * `snapshot` follows it. This verb buffered every page and then wrote them all
 * INSIDE the scope, which is the opposite, and the rationale applies to it more
 * strongly than to either: `history` is the verb that produces megabytes and the
 * one most likely to be piped into `less`. (`send` and `watch` writing inside
 * the scope is correct: one is a trailer, the other needs the live link.)
 *
 * `withPadi` owns the link's lifetime, so an interrupt partway through the walk
 * releases exactly what was acquired; failures ride the error channel so the run
 * edge in `main.ts` — and nothing here — owns the exit code.
 */
export function run(
  endpoint: Endpoint,
  args: HistoryArgs,
): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    const { id, pages } = yield* withPadi(endpoint, (conn) =>
      Effect.gen(function* () {
        const id = yield* resolveTerminal(conn, args.id);
        return { id, pages: yield* readPages(conn, id, args.lines) };
      }),
    );

    for (const chunk of pages) yield* writeOutBlock(chunk, "the scrollback");
    yield* writeErr(
      args.lines === undefined
        ? `— ${shortId(id)} · ${pages.length} older page${pages.length === 1 ? "" : "s"}\n`
        : `— ${shortId(id)} · older history (≤${args.lines} lines)\n`,
    );
  });
}
