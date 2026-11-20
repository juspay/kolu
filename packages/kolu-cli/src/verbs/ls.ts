import { settledSnapshot } from "@kolu/padi/read";
import { formatStatus, formatStatusJson } from "@kolu/padi/render";
import { Effect } from "effect";
import type { Command } from "effect/cli";
import type { lsFlags } from "../cli.ts";
import { type Endpoint, withPadi } from "../endpoint.ts";
import { writeOut } from "./shared.ts";

export type LsArgs = Command.Command.Config.Infer<typeof lsFlags>;

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
