/**
 * The tiny HOST BINARY the end-to-end tests spawn — a real process, with a real
 * argv, a real stdout and a real exit code.
 *
 * It exists because three things in this package's contract are only true of a
 * process: the exit matrix (`exit.ts`), a Ctrl-C during `--follow` (a signal, an
 * interrupt, code 130), and "stdout is data" (a pipe, not a captured sink). An
 * in-process assertion can prove the Effect that WOULD produce them; only a
 * process proves they arrive.
 *
 * It is also the smallest honest example of what a host owes: mount the
 * projected commands, run them, and let the failure's own
 * `Runtime.errorExitCode` decide the code. That is the whole integration —
 * `runEdge` decides the line and the verdict, the runtime reads the number off
 * that verdict, and no command in this package ever calls `process.exit`.
 */

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Cause, Effect } from "effect";
import { Command } from "effect/unstable/cli";
import { runEdge } from "./exit";
import {
  fixtureRoot,
  fixtureRootWithParentFlags,
  fixtureRootWithUnresolvableEndpoint,
} from "./fixture.testlib";

// WHICH shape of host this run is. One binary and ONE run edge for all of them,
// so a case proves an alternative mounting reaches the same answers rather than
// only that it compiles:
//
//   (default)        the endpoint flag on every generated verb
//   parent-flags     declared once on the PARENT, read back in `resolve`
//   resolve-fails    a resolution that refuses, as a typed failure
//   resolve-throws   the same refusal as a bare throw out of the seam
const root = ((mode) => {
  if (mode === "parent-flags") return fixtureRootWithParentFlags();
  if (mode === "resolve-fails")
    return fixtureRootWithUnresolvableEndpoint("fail");
  if (mode === "resolve-throws")
    return fixtureRootWithUnresolvableEndpoint("throw");
  return fixtureRoot();
})(process.env.SURFACE_CLI_FIXTURE);

NodeRuntime.runMain(
  Command.run(root, { version: "0.0.0" }).pipe(
    // `catchCause`, not `catch`: a DEFECT is not a failure, so `Effect.catch`
    // never sees one — and the runtime then reports it itself, on the main fiber,
    // through the default logger, which writes to STDOUT. That lands a log line
    // in the middle of the data channel a script is reading, and the case is not
    // exotic: the server's own per-request refusal (`SurfaceMemberNotExposed`,
    // when the serving face withholds a member this face's map offers — the
    // two-gates arrangement working as designed) crosses the wire as one.
    //
    // Catching the CAUSE puts every arm through the same door: `runEdge` words
    // it, this writes it to stderr, and the runtime has nothing left to report.
    // An INTERRUPT passes through untouched — that is Ctrl-C, and its 130 is the
    // runtime's own teardown reading an interrupts-only cause.
    Effect.catchCause((cause) => {
      if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause);
      const { stderr, failure } = runEdge("demo", Cause.squash(cause));
      return Effect.flatMap(
        Effect.sync(() => {
          if (stderr !== "") process.stderr.write(stderr);
        }),
        () => Effect.fail(failure),
      );
    }),
    Effect.provide(NodeServices.layer),
  ),
  // The line above is already written, and it is the ONE this face promises.
  // Effect's own report on top of it would be a second, differently-worded copy
  // — on stdout.
  { disableErrorReporting: true },
);
