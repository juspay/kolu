/**
 * WHAT KOLU OFFERS for the setup questions it draws the options for — a
 * role's harness and its model — read live, never stored:
 *
 *  - the HARNESSES are this kolu's agent-distro listing, read once at boot
 *    (`./agentDistroListing.ts`);
 *  - a harness's MODELS are the work's host's own answer, asked through its
 *    padi (`agentDistro.models`, which runs upstream's `agent-distro --models`
 *    in the work's repository, in the environment a new terminal there ends
 *    up with). A list the host could not read is `unavailable` in its words —
 *    a value the rule and the form read, not a refusal;
 *  - HOW A LAUNCH TAKES A MODEL is the host's `agentDistro.launch`, which
 *    reads the harness's adapter and runs nothing — what a start reads.
 *
 * And the gate in front of both (`requireAgentsReady`): a host whose coding
 * agents are switched off, not delivered yet, still downloading or failed to
 * land has no harness to choose, so no harness question is ever asked for it
 * — refused, naming the host and what to do, in `@kolu/agent-distro/status`'s
 * words.
 *
 * `index.ts` builds the one offer (it holds the listing and the fleet) and
 * hands it to the conversation (`live.ts`'s `setConductorOffer`), which
 * opens, answers and starts every work against it.
 */

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
/** An Effect's value, or its failure's own words as an Error. */
async function settled<A>(effect: Effect.Effect<A, unknown>): Promise<A> {
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
  /** The host's padi, or the sentence that says why there is none. */
  const padiOf = (host: string) => {
    const padi = hosts.padi(host);
    if (padi === null)
      throw new WorkRefusal(
        "agents-not-ready",
        `${hosts.display(host)} is ${hosts.state(host)}, not connected, so kolu cannot ask which harnesses it can run. Ask again once it is back.`,
      );
    return padi;
  };
  /** THE ONE SENTENCE for a kolu that carries no agent-distro — said
   *  wherever that state is met (the gate, and the options themselves), so
   *  the two can never drift into "no harnesses here" and "none at all". */
  const noAgentDistro = () =>
    new WorkRefusal(
      "agents-not-ready",
      "This kolu was built without agent-distro, so it has no harness to offer for a planner or an implementor.",
    );
  return {
    // A LIST OF NOTHING IS NOT AN ANSWER: a kolu built without agent-distro
    // has no harness to offer at all, which is a refusal in words — never an
    // empty menu that reads like a host with nothing installed.
    harnesses: () => {
      if (listing.kind === "unavailable") throw noAgentDistro();
      return listing.harnesses.map((one) => one.name);
    },
    models: async ({ host, repo, harness }) => {
      try {
        const answer = await settled(
          padiOf(host).surface.agentDistro.models({ harness, cwd: repo }),
        );
        return answer.models;
      } catch (err) {
        // THE HOST'S OWN WORD that it could not list — a value, so the form
        // can show it beside the models used before and a box to type one.
        // Anything else (a host that is not connected) stays a refusal.
        if (err instanceof AgentModelsUnavailable)
          return { kind: "unavailable", why: err.why };
        throw err;
      }
    },
    launch: async ({ host, harness }) =>
      (await settled(padiOf(host).surface.agentDistro.launch({ harness })))
        .model,
    requireAgentsReady: async (host) => {
      if (listing.kind === "unavailable") throw noAgentDistro();
      const where = hosts.display(host);
      const status = await settled(
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
      // READY, BUT OLDER THAN THIS KOLU: it serves terminals, and no model
      // can be asked of it — so nobody is handed a form they cannot answer.
      if (missingPackageCalls(status.answers).length > 0)
        throw new WorkRefusal("agents-not-ready", agentsTooOldWords(where));
    },
  };
}
