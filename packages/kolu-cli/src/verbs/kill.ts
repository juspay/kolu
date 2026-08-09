/**
 * `kolu kill <id>` — end one terminal.
 *
 * The verb with the least to say and the most to get right: it produces NO
 * scriptable payload, only an effect on the world and an exit code. So stdout
 * stays completely empty here (nothing to pipe, nothing for a `$(…)` to
 * capture) and the one human line goes to stderr, which is where every verb's
 * trailers live. A `kolu kill` inside a pipeline contributes zero bytes to the
 * stream, which is the correct amount.
 *
 * ## Why the id is resolved before the RPC
 *
 * `<id>` accepts any unique PREFIX, widened by `resolveTerminal` in
 * `./shared.ts` — padi's `lifecycle.kill` takes a full uuid, and a prefix handed
 * to it straight would fail as an opaque schema-decode error rather than "no
 * terminal matching \"3f9\"".
 *
 * Neither wrong-id case may be a quiet success. A `kill` that matched nothing
 * and exited 0 would read, to the driving loop above it, exactly like a kill
 * that worked — so a script would move on believing a terminal is gone while an
 * agent keeps running in it. That is the silent-degradation this repo treats as
 * a defect, and it is why both arms are a `failure()` (exit 1) rather than a
 * no-op.
 *
 * ## The one race, and why it also fails loud
 *
 * Between resolving the id and the kill landing, the terminal can exit on its
 * own; padi then answers `TerminalNotFound`. That arm is REPORTED, not
 * swallowed — the user asked to end a terminal and something else ended it
 * first, which is a different outcome from "I ended it" and a driver may
 * legitimately care. It surfaces as the CLI's one-line failure with the reason
 * named, never as a bare decode dump and never as a fake success.
 *
 * No `process.exit` anywhere below: every arm fails on the ERROR channel, so
 * `main.ts`'s run edge owns the code (`exit.ts`'s contract) and this module
 * stays a pure Effect that a test can run without ending its process.
 */

import { shortId } from "@kolu/padi/render";
import { Effect } from "effect";
import type { Command } from "effect/unstable/cli";
// `import type` — fully erased, so this does NOT re-enter the command tree at
// runtime and the per-face dynamic-import fence is untouched.
import type { killFlags } from "../cli.ts";
import { type Connection, type Endpoint, withPadi } from "../endpoint.ts";
import { failure } from "../exit.ts";
import { resolveTerminal, writeErr } from "./shared.ts";

/** What the command tree parses for this verb — DERIVED from the flag record in
 *  `cli.ts`. `id` is a terminal id or any unique prefix of one (the `kolu ls`
 *  short form). */
export type KillArgs = Command.Command.Config.Infer<typeof killFlags>;

/** End the terminal `id` names, and say so on stderr.
 *
 *  The confirmation carries the pid as well as the short id because that is the
 *  fact a user can still act on afterwards — `ps`, a log line, a stray child
 *  process — once the terminal itself is gone from `kolu ls`. */
const killOne = Effect.fn(function* (conn: Connection, query: string) {
  const id = yield* resolveTerminal(conn, query);
  const info = yield* Effect.mapError(
    conn.client.surface.lifecycle.kill({ id }),
    (err) =>
      failure(
        `could not kill ${shortId(id)} — ${err.message}. It may have exited on its own; \`kolu ls\` shows what is still live.`,
      ),
  );
  yield* writeErr(`— killed ${shortId(info.id)} (pid ${info.pid})\n`);
});

/** The verb, as `cli.ts`'s `runVerb` expects it: dial the chosen padi, kill,
 *  release. The link's lifetime is `withPadi`'s scope, so an interrupt partway
 *  through releases exactly what was acquired. */
export function run(
  endpoint: Endpoint,
  args: KillArgs,
): Effect.Effect<void, unknown> {
  return withPadi(endpoint, (conn) => killOne(conn, args.id));
}
