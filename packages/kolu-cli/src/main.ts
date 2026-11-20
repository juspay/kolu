import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Cause, Effect } from "effect";
import { Command } from "effect/cli";
import { serverVersion } from "kolu-server/src/hostname.ts";
import { koluCli } from "./cli.ts";
import {
  CliExitCode,
  CliFailure,
  errorMessage,
  isFaceExitArm,
  koluLine,
  renderDiagnostic,
  UsageRefused,
} from "./exit.ts";

/** The brand every `effect/cli` error carries.
 *
 *  Matched on the BRAND rather than on `_tag`: the library sets `_tag` to the
 *  short name (`ShowHelp`, `DuplicateOption`, …) and stamps this key alongside
 *  it, so a `_tag.startsWith("~effect/cli/")` test — the obvious-looking one —
 *  silently matches nothing and double-prints every diagnostic. */
const CLI_ERROR_BRAND = "~effect/cli/CliError";

type LibraryOutcome = "ours" | "asked-for-text" | "usage-refused";

const libraryOutcome = (err: unknown): LibraryOutcome => {
  const printedByTheLibrary =
    typeof err === "object" && err !== null && CLI_ERROR_BRAND in err;
  if (!printedByTheLibrary) return "ours";
  const given = process.argv.slice(2);
  const separator = given.indexOf("--");
  const kolusOwn = separator === -1 ? given : given.slice(0, separator);
  const askedForText = kolusOwn.some(
    (a) => a === "--help" || a === "-h" || a === "--version" || a === "-v",
  );
  return askedForText ? "asked-for-text" : "usage-refused";
};

const program = Command.run(koluCli, { version: serverVersion });

const armDefect = (err: unknown): unknown =>
  isFaceExitArm(err)
    ? err
    : new CliFailure({
        reason: errorMessage(err),
        stderr: koluLine(errorMessage(err)),
        code: CliExitCode.refused,
      });

const reportAndRefail = (err: unknown): Effect.Effect<never, unknown> => {
  const armed = armDefect(err);
  return Effect.flatMap(
    Effect.sync(() => {
      process.stderr.write(renderDiagnostic(armed));
    }),
    () => Effect.fail(armed),
  );
};

NodeRuntime.runMain(
  program.pipe(
    Effect.catchCause((cause) => {
      if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause);
      const err = Cause.squash(cause);
      switch (libraryOutcome(err)) {
        case "ours":
          return reportAndRefail(err);
        case "asked-for-text":
          return Effect.void;
        case "usage-refused":
          return Effect.fail(new UsageRefused());
      }
    }),
    Effect.provide(NodeServices.layer),
  ),
);
