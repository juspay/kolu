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
 * `Runtime.errorExitCode` decide the code. That is the whole integration — one
 * `reportingRunEdge` in the pipe decides the line and the verdict, the
 * runtime reads the number off that verdict, and no command in this package
 * ever calls `process.exit`.
 */

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect } from "effect";
import { Command } from "effect/unstable/cli";
import { reportingRunEdge } from "./exit";
import {
  fixtureRoot,
  fixtureRootOneShot,
  fixtureRootWithHelp,
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
//   one-shot         a transport that cannot push: no `watch`, no `--follow`
//   helped           a host that wrote a help page, so the verbs are unlisted
const root = ((mode) => {
  if (mode === "one-shot") return fixtureRootOneShot();
  if (mode === "helped") return fixtureRootWithHelp();
  if (mode === "parent-flags") return fixtureRootWithParentFlags();
  if (mode === "resolve-fails")
    return fixtureRootWithUnresolvableEndpoint("fail");
  if (mode === "resolve-throws")
    return fixtureRootWithUnresolvableEndpoint("throw");
  return fixtureRoot();
})(process.env.SURFACE_CLI_FIXTURE);

NodeRuntime.runMain(
  Command.run(root, { version: "0.0.0" }).pipe(
    // The whole run edge, in the one line the package exports it as: catch the
    // CAUSE (a defect is not a failure, and the runtime's own report of one goes
    // to STDOUT, into the data channel a script is reading), pass an
    // interrupts-only cause through untouched (Ctrl-C, whose 130 is the
    // runtime's teardown), write the arm's own line, re-fail with the verdict.
    // A host that hand-wrote those three moves was hand-writing the half of the
    // exit contract that decides whether the matrix is true of the binary.
    reportingRunEdge,
    Effect.provide(NodeServices.layer),
  ),
  // The other half of the same recipe, and the host's to pass because it is
  // `runMain`'s argument: the line is already written, and Effect's own report
  // on top of it would be a second, differently-worded copy — on stdout.
  { disableErrorReporting: true },
);
