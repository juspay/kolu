import type { Effect } from "effect";
import type { Command } from "effect/cli";
import type { debriefFlags } from "../cli.ts";
import { DEBRIEF_PLAN } from "../debriefProtocol.ts";
import type { Endpoint } from "../endpoint.ts";
import { runPlan } from "./wait.ts";

export type DebriefArgs = Command.Command.Config.Infer<typeof debriefFlags>;

export function run(
  endpoint: Endpoint,
  args: DebriefArgs,
): Effect.Effect<void, unknown> {
  return runPlan(
    endpoint,
    DEBRIEF_PLAN,
    {
      id: args.id,
      settled: args.quiet,
      snapshot: args.tail,
      timeout: args.timeout,
      json: args.json,
    },
    "kolu debrief",
  );
}
