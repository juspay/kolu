import {
  type AgentModelLaunch,
  modelLaunchWords,
} from "@kolu/agent-distro/models";
import { shellJoin, shellQuoteArg } from "@kolu/shell-quote";
import { ToolFailure } from "@kolu/surface-mcp/tools";
import { Effect } from "effect";
import { type WaterfallRole, WorkRefusal } from "kolu-work";
import type { FleetWorks } from "./works.ts";

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
