import {
  isPadiHistoryStale,
  readHistoryPage,
  readWholeHistory,
} from "@kolu/padi/read";
import { shortId } from "@kolu/padi/render";
import { terminalNotActiveOf } from "@kolu/padi-client/surface";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { Effect } from "effect";
import type { Command } from "effect/cli";
import type { historyFlags } from "../cli.ts";
import { type Connection, type Endpoint, withPadi } from "../endpoint.ts";
import { failure, terminalAsleep } from "../exit.ts";
import { resolveTerminal, writeErr, writeOutBlock } from "./shared.ts";

export type HistoryArgs = Command.Command.Config.Infer<typeof historyFlags>;

const staleFailure = (id: TerminalId) =>
  failure(
    `padi answered "stale" while paging ${shortId(id)}'s scrollback — the mirror was renumbered by a width reflow mid-dump, so the rows already read cannot be joined to the rest. Nothing partial was printed; re-run \`kolu history\` once the terminal's width has settled.`,
  );

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
  return Effect.catch(read, (err) => {
    const dormant = terminalNotActiveOf(err);
    if (dormant !== undefined) {
      return Effect.fail(
        terminalAsleep({
          terminal: shortId(id),
          state: dormant.state,
          attempted: "page its scrollback",
        }),
      );
    }
    return Effect.fail(isPadiHistoryStale(err) ? staleFailure(id) : err);
  });
}

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
