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
import { Effect } from "effect";
import { Command } from "effect/unstable/cli";
import { runEdge } from "./exit";
import { fixtureRoot } from "./fixture.testlib";

NodeRuntime.runMain(
  Command.run(fixtureRoot(), { version: "0.0.0" }).pipe(
    Effect.catch((error) => {
      // The WHOLE run edge, in three lines: ask `runEdge` what to write and what
      // to fail with, write it, re-fail. Everything a host would otherwise have
      // to know — which failures the CLI library already rendered, which code a
      // rendered refusal deserves, how to word an arbitrary defect — lives in
      // `exit.ts` beside the matrix it makes true, rather than in a fixture.
      const { stderr, failure } = runEdge("demo", error);
      return Effect.flatMap(
        Effect.sync(() => {
          if (stderr !== "") process.stderr.write(stderr);
        }),
        () => Effect.fail(failure),
      );
    }),
    Effect.provide(NodeServices.layer),
  ),
);
