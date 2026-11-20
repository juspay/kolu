import { writeFile } from "node:fs/promises";
import { shortId } from "@kolu/padi/render";
import { Effect } from "effect";
import type { Command } from "effect/cli";
import type { screenshotFlags } from "../cli.ts";
import { type Endpoint, withPadi } from "../endpoint.ts";
import { errorMessage, failure, terminalAsleep } from "../exit.ts";
import { resolveTerminal, writeErr, writeOut } from "./shared.ts";

export type ScreenshotArgs = Command.Command.Config.Infer<
  typeof screenshotFlags
>;

const STDOUT = "-";

const DEFAULT_OUT = "kolu-screenshot.png";

export const run = Effect.fn("kolu screenshot")(function* (
  endpoint: Endpoint,
  args: ScreenshotArgs,
) {
  const lines = args.lines;

  const { image, id } = yield* withPadi(endpoint, (conn) =>
    Effect.gen(function* () {
      const id = yield* resolveTerminal(conn, args.id);
      const read = conn.client.surface.screen.image({
        id,
        ...(lines !== undefined && { lines }),
      });
      const image = yield* read.pipe(
        Effect.catchTag("TerminalNotFound", () =>
          Effect.fail(
            failure(
              `terminal ${shortId(id)} ended between listing it and reading its screen — nothing to screenshot.`,
            ),
          ),
        ),
        Effect.catchTag("TerminalNotActive", (err) =>
          Effect.fail(
            terminalAsleep({
              terminal: shortId(id),
              state: err.state,
              attempted: "screenshot it",
            }),
          ),
        ),
      );
      return { image, id };
    }),
  );

  const png = Buffer.from(image.data, "base64");
  const out = args.out ?? DEFAULT_OUT;

  const toStdout = out === STDOUT;
  if (toStdout) {
    yield* writeOut(png, "the PNG");
  } else {
    yield* Effect.tryPromise({
      try: () => writeFile(out, png),
      catch: (err) => failure(`could not write ${out}: ${errorMessage(err)}`),
    });
  }

  yield* writeErr(
    `— ${shortId(id)} · ${image.cols}x${image.rows} · ${png.length} bytes${
      toStdout ? "" : ` → ${out}`
    }\n`,
  );
});
