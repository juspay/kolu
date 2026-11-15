/**
 * WHAT KOLU OFFERS for the setup questions it draws the options for — a
 * role's harness and its model — read live, never stored:
 *
 *  - the HARNESSES are this kolu's agent-distro listing, read once at boot
 *    (`./agentDistroListing.ts`);
 *  - a harness's MODELS are the work's host's own answer, asked through its
 *    padi (`agentDistro.models`, which runs upstream's `agent-distro --models`
 *    in the work's repository with the profiles a new terminal there gets).
 *
 * And the gate in front of both (`requireAgentsReady`): a host whose coding
 * agents are switched off, not delivered yet, still downloading or failed to
 * land has no harness to choose, so no harness question is ever asked for it
 * — refused, naming the host and what to do, in `@kolu/agent-distro/status`'s
 * words.
 *
 * `index.ts` builds the one offer (it holds the listing and the fleet) and
 * registers it; the conductor's `openWork` / `answerWork` take it from here,
 * so the surface's `answerWork` and the fleet face's `work_open` check
 * against the same thing.
 */

import type { AgentDistroListing } from "@kolu/agent-distro/listing";
import { agentsNotReadyWords } from "@kolu/agent-distro/status";
import { firstFrameOrThrow } from "@kolu/surface/first-frame";
import { Cause, Effect, Exit } from "effect";
import type { KoluOffer } from "kolu-conductor";
import type { FleetHosts } from "kolu-mcp";
import { WorkRefusal } from "kolu-work";

/** The offer, and the readiness gate that comes before any harness question. */
export interface KoluOfferHost {
  readonly offer: KoluOffer;
  /** Refuses ({@link WorkRefusal} `agents-not-ready`) unless `host` has a
   *  harness to choose: this kolu carries agent-distro, and the host's agents
   *  are ready. */
  readonly requireAgentsReady: (host: string) => Promise<void>;
}

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
}): KoluOfferHost {
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
  return {
    offer: {
      harnesses: () =>
        listing.kind === "available"
          ? listing.harnesses.map((one) => one.name)
          : [],
      models: async ({ host, repo, harness }) => {
        if (repo === "")
          throw new Error(
            "a watch has no repository, so there is nowhere to ask a harness for its models",
          );
        const answer = await settled(
          padiOf(host).surface.agentDistro.models({ harness, cwd: repo }),
        );
        return answer.models;
      },
    },
    requireAgentsReady: async (host) => {
      if (listing.kind === "unavailable")
        throw new WorkRefusal(
          "agents-not-ready",
          "This kolu was built without agent-distro, so it has no harness to offer for a planner or an implementor.",
        );
      const where = hosts.display(host);
      const status = await settled(
        firstFrameOrThrow(
          padiOf(host).surface.agentDistroStatus.get(undefined),
          `${where} answered no agent status, so kolu cannot tell whether it has a harness to run.`,
        ),
      );
      const why = agentsNotReadyWords(status, where);
      if (why !== null) throw new WorkRefusal("agents-not-ready", why);
    },
  };
}

let registered: KoluOfferHost | null = null;

/** Register the one offer — `index.ts`, once it holds the listing and the
 *  fleet, before anything can open or answer a work. */
export function setKoluOffer(host: KoluOfferHost): void {
  registered = host;
}

/** The offer, or the boot-order crash: `null` here is wiring that moved,
 *  never a host that is away. */
export function koluOffer(): KoluOfferHost {
  if (registered === null)
    throw new Error(
      "a work was opened or answered before index.ts registered kolu's offer — setKoluOffer must run before the surface is served",
    );
  return registered;
}
