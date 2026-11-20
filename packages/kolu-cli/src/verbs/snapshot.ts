import { shortId } from "@kolu/padi/render";
import { Effect } from "effect";
import type { Command } from "effect/cli";
import type { snapshotFlags } from "../cli.ts";
import { type Endpoint, withPadi } from "../endpoint.ts";
import { failure, terminalAsleep } from "../exit.ts";
import { resolveTerminal, writeErr, writeOutBlock } from "./shared.ts";

export type SnapshotArgs = Command.Command.Config.Infer<typeof snapshotFlags>;

const lineCount = (text: string): number =>
  text === "" ? 0 : text.replace(/\n+$/, "").split("\n").length;

export const run = Effect.fn("kolu snapshot")(function* (
  endpoint: Endpoint,
  args: SnapshotArgs,
) {
  const tail = args.tail;

  const { text, id } = yield* withPadi(endpoint, (conn) =>
    Effect.gen(function* () {
      const id = yield* resolveTerminal(conn, args.id);
      const read = conn.client.surface.screen.text(
        tail === undefined ? { id } : { id, tail },
      );
      const text = yield* read.pipe(
        Effect.catchTag("TerminalNotFound", () =>
          Effect.fail(
            failure(
              `terminal ${shortId(id)} ended between listing it and reading its screen — nothing to snapshot.`,
            ),
          ),
        ),
        Effect.catchTag("TerminalNotActive", (err) =>
          Effect.fail(
            terminalAsleep({
              terminal: shortId(id),
              state: err.state,
              attempted: "read its screen",
            }),
          ),
        ),
      );
      return { text, id };
    }),
  );

  yield* writeOutBlock(text, "the screen text");
  const lines = lineCount(text);
  yield* writeErr(
    `— ${shortId(id)} · ${lines} line${lines === 1 ? "" : "s"}\n`,
  );
});
