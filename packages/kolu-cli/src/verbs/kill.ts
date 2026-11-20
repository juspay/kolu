import { shortId } from "@kolu/padi/render";
import { Effect } from "effect";
import type { Command } from "effect/cli";
import type { killFlags } from "../cli.ts";
import { type Connection, type Endpoint, withPadi } from "../endpoint.ts";
import { failure } from "../exit.ts";
import { resolveTerminal, writeErr } from "./shared.ts";

export type KillArgs = Command.Command.Config.Infer<typeof killFlags>;

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

export function run(
  endpoint: Endpoint,
  args: KillArgs,
): Effect.Effect<void, unknown> {
  return withPadi(endpoint, (conn) => killOne(conn, args.id));
}
