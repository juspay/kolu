/**
 * `kolu ls` — the merged roster. This is padi-tui's `status` under the name the
 * one terminal CLI gives it: `ls` is what a user reaches for to answer "what is
 * running, and what is each one doing", so it takes the shell's own word for
 * that question rather than the daemon's word for the answer.
 *
 * The verb itself is glue and nothing else, deliberately. The two halves it
 * joins already exist and are already tested apart from any socket or tty:
 *
 *   - {@link settledSnapshot} (`@kolu/padi/read`) — the READ. It waits for
 *     padi's sensors (git · agent · foreground · PR) to land before handing back
 *     the collection, which is the whole reason this is not a bare
 *     `terminals.keys` read: a terminal spawned a beat ago seeds all-null, and a
 *     roster that printed dashes for it would be lying about a terminal that is
 *     fine. The wait is bounded (a hard cap inside the read), so an unresolvable
 *     sensor costs a moment, never a hang.
 *   - {@link formatStatus} / {@link formatStatusJson} (`@kolu/padi/render`) —
 *     the RENDER, pure. padi-tui and this face print the SAME table from the
 *     same records; a second copy of the column layout would be a second truth.
 *
 * ## Why the link is released before anything is printed
 *
 * `withPadi`'s scope closes when the effect it wraps completes, so wrapping ONLY
 * the read (rather than the whole verb) means the socket is already gone by the
 * time the first byte reaches stdout. A snapshot needs no live connection to be
 * printed, and a reader piping into a pager could otherwise hold a padi
 * subscription open for as long as they scroll.
 *
 * ## Output discipline
 *
 * The table (or the JSON) is DATA — it goes to stdout, whole, and it is the only
 * thing this verb writes, through the draining sink in `./shared.ts` (a big
 * `--json` roster into a pipe must flush before the process exits, and a reader
 * that hangs up is a complete `kolu ls`). There is no human trailer to send to
 * stderr: unlike `create`, `ls` has no side effect to narrate. An empty inventory
 * prints `no terminals.` (the renderer's honest one-liner) and still exits 0 —
 * "nothing is running" is an answer, not a failure.
 *
 * No `process.exit` anywhere below: a failure rides the error channel and the
 * run edge in `main.ts` reads the code off it, so the exit contract stays in one
 * place (`exit.ts`).
 */

import { settledSnapshot } from "@kolu/padi/read";
import { formatStatus, formatStatusJson } from "@kolu/padi/render";
import { Effect } from "effect";
import type { Command } from "effect/unstable/cli";
// `import type` — fully erased, so this does NOT re-enter the command tree at
// runtime and the per-face dynamic-import fence is untouched.
import type { lsFlags } from "../cli.ts";
import { type Endpoint, withPadi } from "../endpoint.ts";
import { writeOut } from "./shared.ts";

/** What the command tree parses for this verb — DERIVED from the flag record in
 *  `cli.ts`, so a flag added there and forgotten here is inexpressible rather
 *  than silently never read. */
export type LsArgs = Command.Command.Config.Infer<typeof lsFlags>;

/** Read the roster, release the link, print it. */
export function run(
  endpoint: Endpoint,
  args: LsArgs,
): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    const entries = yield* withPadi(endpoint, (conn) =>
      settledSnapshot(conn.client),
    );
    const text = args.json ? formatStatusJson(entries) : formatStatus(entries);
    yield* writeOut(`${text}\n`, "the terminal list");
  });
}
