import type { AgentDistroListing } from "@kolu/agent-distro/listing";
import { missingPackageCalls } from "@kolu/agent-distro/models";
import {
  agentsNotReadyWords,
  agentsTooOldWords,
} from "@kolu/agent-distro/status";
import { AgentModelsUnavailable } from "@kolu/padi-client/surface";
import { firstFrameOrThrow } from "@kolu/surface/first-frame";
import { Cause, Effect, Exit } from "effect";
import type { KoluOffer } from "kolu-conductor";
import type { FleetHosts } from "kolu-mcp";
import { WorkRefusal } from "kolu-work";

async function runOrThrowCause<A>(
  effect: Effect.Effect<A, unknown>,
): Promise<A> {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return exit.value;
  const failure = Cause.squash(exit.cause);
  throw failure instanceof Error
    ? failure
    : new Error(Cause.pretty(exit.cause));
}

export function koluOfferOver(deps: {
  readonly listing: AgentDistroListing;
  readonly hosts: FleetHosts;
}): KoluOffer {
  const { listing, hosts } = deps;
  const padiOf = (host: string) => {
    const padi = hosts.padi(host);
    if (padi === null)
      throw new WorkRefusal(
        "agents-not-ready",
        `${hosts.display(host)} is ${hosts.state(host)}, not connected, so kolu cannot ask which harnesses it can run. Ask again once it is back.`,
      );
    return padi;
  };
  const noAgentDistro = () =>
    new WorkRefusal(
      "agents-not-ready",
      "This kolu was built without agent-distro, so it has no harness to offer for a planner or an implementor.",
    );
  return {
    harnesses: () => {
      if (listing.kind === "unavailable") throw noAgentDistro();
      return listing.harnesses.map((one) => one.name);
    },
    models: async ({ host, repo, harness }) => {
      try {
        const answer = await runOrThrowCause(
          padiOf(host).surface.agentDistro.models({ harness, cwd: repo }),
        );
        return answer.models;
      } catch (err) {
        if (err instanceof AgentModelsUnavailable)
          return { kind: "unavailable", why: err.why };
        throw err;
      }
    },
    launch: async ({ host, harness }) =>
      (
        await runOrThrowCause(
          padiOf(host).surface.agentDistro.launch({ harness }),
        )
      ).model,
    requireAgentsReady: async (host) => {
      if (listing.kind === "unavailable") throw noAgentDistro();
      const where = hosts.display(host);
      const status = await runOrThrowCause(
        firstFrameOrThrow(
          padiOf(host).surface.agentDistroStatus.get(undefined),
          `${where} answered no agent status, so kolu cannot tell whether it has a harness to run.`,
        ),
      );
      if (status.kind !== "ready")
        throw new WorkRefusal(
          "agents-not-ready",
          agentsNotReadyWords(status, where),
        );
      if (missingPackageCalls(status.answers).length > 0)
        throw new WorkRefusal("agents-not-ready", agentsTooOldWords(where));
    },
  };
}
