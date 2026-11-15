/**
 * THE COMMAND A PLANNER OR IMPLEMENTOR STARTS WITH — built by kolu from the
 * work's saved setup, never written by the Conductor.
 *
 * The harness and the model are the human's answers on the work, judged
 * again against what kolu offers on the work's host, and how that harness
 * takes a model is the host's own word — upstream's adapter answering
 * `agent-distro --models` through padi ({@link FleetWorks.startOf}). So the
 * one place a model flag is spelled is the harness's adapter in agent-distro,
 * and the one source of a waterfall agent's command is this module: a planner
 * started with a command that disagrees with its setup, or on a saved answer
 * kolu no longer offers, is not something `lifecycle_create` can be asked
 * for.
 */

import {
  type AgentModelLaunch,
  modelLaunchWords,
} from "@kolu/agent-distro/models";
import { shellJoin, shellQuoteArg } from "@kolu/shell-quote";
import { ToolFailure } from "@kolu/surface-mcp/tools";
import { Effect } from "effect";
import { type WaterfallRole, WorkRefusal } from "kolu-work";
import type { FleetWorks } from "./works.ts";

/** The shell line that starts `harness` on `model`: the environment the
 *  launch takes first, then the harness and its model words. */
export function startCommand(
  harness: string,
  launch: AgentModelLaunch,
  model: string,
): string {
  const { env, args } = modelLaunchWords(launch, model);
  return [
    ...Object.entries(env).map(
      ([name, value]) => `${name}=${shellQuoteArg(value)}`,
    ),
    shellJoin([harness, ...args]),
  ].join(" ");
}

/** The `run` a planner or implementor of `work` is created with, on `host` —
 *  or the refusal that says why there is none. */
export function waterfallRun(
  works: FleetWorks,
  call: {
    readonly work: string;
    readonly role: WaterfallRole;
    readonly host: string;
  },
): Effect.Effect<string, ToolFailure> {
  return Effect.gen(function* () {
    const start = yield* Effect.tryPromise({
      try: () => works.startOf(call.work, call.role),
      catch: (err: unknown) =>
        err instanceof WorkRefusal
          ? new ToolFailure(err.why, { kind: err.kind, work: call.work })
          : new ToolFailure(
              `kolu could not read the setup of ${JSON.stringify(call.work)}: ${String(err)}`,
              { kind: "work-call-failed", work: call.work },
            ),
    });
    if (start.host !== call.host) {
      return yield* Effect.fail(
        new ToolFailure(
          `The ${call.role} of ${JSON.stringify(call.work)} runs on ${JSON.stringify(start.host)}, the host the work is on — create it there, not on ${JSON.stringify(call.host)}.`,
          {
            kind: "wrong-host",
            work: call.work,
            host: start.host,
            named: call.host,
          },
        ),
      );
    }
    return startCommand(start.harness, start.launch, start.model);
  });
}
