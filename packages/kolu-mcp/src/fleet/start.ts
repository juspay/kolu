/**
 * THE COMMAND A PLANNER OR IMPLEMENTOR STARTS WITH — built by kolu from the
 * work's saved setup, never written by the Conductor.
 *
 * The harness and the model are the human's answers on the work
 * ({@link FleetWorks.startOf}); how that harness takes a model is the host's
 * own word, upstream's adapter answering `agent-distro --models` through padi
 * (`agentDistro.models`). So the one place a model flag is spelled is the
 * harness's adapter in agent-distro, and the one source of a waterfall agent's
 * command is this module: a planner started with a command that disagrees
 * with its setup is not something `lifecycle_create` can be asked for.
 */

import {
  modelLaunchWords,
  type AgentModelLaunch,
} from "@kolu/agent-distro/models";
import { shellJoin, shellQuoteArg } from "@kolu/shell-quote";
import { ToolFailure } from "@kolu/surface-mcp/tools";
import { Effect } from "effect";
import { type WaterfallRole, WorkRefusal } from "kolu-work";
import { type FleetHosts, requireHost } from "./hosts.ts";
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
 *  or the refusal that says why there is none yet. */
export function waterfallRun(
  hosts: FleetHosts,
  works: FleetWorks,
  call: {
    readonly work: string;
    readonly role: WaterfallRole;
    readonly host: string;
  },
): Effect.Effect<string, ToolFailure> {
  return Effect.gen(function* () {
    const start = yield* Effect.try({
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
    const padi = yield* requireHost(hosts, start.host);
    const models = yield* Effect.mapError(
      padi.surface.agentDistro.models({
        harness: start.harness,
        cwd: start.repo,
      }),
      (err: unknown) =>
        new ToolFailure(
          `kolu cannot start the ${call.role} on ${start.harness}: ${err instanceof Error ? err.message : String(err)}`,
          {
            kind: "models-unavailable",
            work: call.work,
            harness: start.harness,
          },
        ),
    );
    return startCommand(start.harness, models.launch, start.model);
  });
}
