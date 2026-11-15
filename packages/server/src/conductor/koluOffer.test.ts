/**
 * WHAT KOLU OFFERS a work's two drawn questions — the harnesses it carries and
 * what a harness offers on the work's own host — and the gate in front of
 * them.
 *
 * Every claim here is about a HOST: its agents are off, still arriving, or
 * failed to land; its padi is not answering; its harness cannot list its
 * models; its harness's list command failed. So the fixture is a real padi
 * CLIENT — padi's own `padiClientOver` over a handler record keyed at padi's
 * own wire tags (`surfaceTag(padiSurfaceSibling.tagPrefix, …)`), the shape
 * `kolu-mcp`'s fleet suite settled on. A hand-written object cast to
 * `PadiSurfaceClient` would make any shape a padi client, and the member these
 * two calls dial (`agentDistroStatus.get`, `agentDistro.models`) could then be
 * renamed out from under this file while it stayed green.
 *
 * The two refusals it pins are the ones a person reads:
 *
 *  - `agents-not-ready` — asked which harness runs a role on a machine that
 *    has none to run. Named, with what to do about it, in
 *    `@kolu/agent-distro/status`'s own words rather than a second wording
 *    kolu would have to keep in step.
 *  - a FAILED listing is not an empty one — `models` REJECTS with the host's
 *    own sentence, so the recorder refuses with it instead of quietly
 *    offering nothing.
 */

import type { AgentDistroListing } from "@kolu/agent-distro/listing";
import type { AgentModels } from "@kolu/agent-distro/models";
import type { AgentDistroStatus } from "@kolu/agent-distro/schema";
import {
  agentsNotReadyWords,
  agentsTooOldWords,
} from "@kolu/agent-distro/status";
import { type PadiSurfaceClient, padiClientOver } from "@kolu/padi-client/dial";
import {
  AgentModelsUnavailable,
  padiSurfaceSibling,
} from "@kolu/padi-client/surface";
import { surfaceTag } from "@kolu/surface/define";
import { directDispatch } from "@kolu/surface/links/direct";
import type { SurfaceHandlers } from "@kolu/surface/server";
import { Effect, Stream } from "effect";
import type { FleetHostState, FleetHosts } from "kolu-mcp";
import { WorkRefusal } from "kolu-work";
import { describe, expect, it } from "vitest";
import { koluOfferOver } from "./koluOffer.ts";

/** The repository a work runs in — what a harness is asked about, because a
 *  repository's own `plugin.json` composes over the profiles a terminal
 *  there gets. */
const REPO = "/srv/repo";

/** This kolu's build, as its package describes it. */
const LISTING: AgentDistroListing = {
  kind: "available",
  harnesses: [
    { name: "omp", title: "omp", version: "5.2.0" },
    { name: "claude", title: "Claude Code", version: "2.1.0" },
  ],
};

/** A host whose agents landed — the one status that asks nothing of anybody. */
const READY: AgentDistroStatus = {
  kind: "ready",
  set: {
    bundle: "/nix/store/aaaa-agent-distro",
    profiles: [
      {
        reference: "github:juspay/skills",
        name: "juspay",
        path: "/nix/store/bbbb-juspay",
      },
    ],
  },
  delivering: false,
  answers: ["--list", "--models"],
};

/** What `omp` lists where it can list. */
const OMP_MODELS: AgentModels = {
  launch: { kind: "flag", flag: "--model" },
  models: {
    kind: "listed",
    ids: ["anthropic/claude-fable-5-2", "litellm/open-large"],
  },
};

/** ... and Claude Code, which has no command that lists its models at all. */
const CLAUDE_MODELS: AgentModels = {
  launch: { kind: "flag", flag: "--model" },
  models: { kind: "unlisted" },
};

/** The sentence a harness's own list command failed with — the host's words,
 *  which is the thing a refusal must carry. */
const LIST_FAILED =
  "`omp --list-models` exited 1: could not reach the model gateway";

interface FakePadi {
  readonly client: PadiSurfaceClient;
  /** Every models call this padi answered, as `<harness>@<cwd>`. */
  readonly modelCalls: () => ReadonlyArray<string>;
}

/** ONE host's padi, as a handler record at padi's own wire tags — dialled
 *  through the real face walk, so a member renamed in `padiSurface` breaks
 *  this file instead of passing. */
function fakePadi(over: {
  readonly status: AgentDistroStatus;
  /** Per harness: what it answers, or the words its listing failed with. A
   *  harness nothing is said about is one this host does not have. */
  readonly models?: Readonly<Record<string, AgentModels | string>>;
  /** No status frame at all — a padi that answered the subscription and then
   *  said nothing, which is a link that cannot be read around. */
  readonly silent?: boolean;
}): FakePadi {
  const modelCalls: string[] = [];
  const at = (member: string, verb: string): string =>
    surfaceTag(padiSurfaceSibling.tagPrefix, member, verb);
  const handlers = {
    [at("agentDistroStatus", "get")]: () =>
      over.silent === true ? Stream.empty : Stream.make(over.status),
    [at("agentDistro", "models")]: (input: { harness: string; cwd: string }) =>
      Effect.suspend(() => {
        modelCalls.push(`${input.harness}@${input.cwd}`);
        const answer = over.models?.[input.harness];
        if (answer === undefined || typeof answer === "string")
          return Effect.fail(
            new AgentModelsUnavailable({
              harness: input.harness,
              why: answer ?? `${input.harness} is not a harness on this host`,
            }),
          );
        return Effect.succeed(answer);
      }),
  } as unknown as SurfaceHandlers;
  return {
    client: padiClientOver(directDispatch({ handlers })).padi,
    modelCalls: () => modelCalls,
  };
}

/** kolu-server's host map, as this file holds it. */
function fakeHosts(
  rows: ReadonlyArray<{
    readonly key: string;
    readonly display: string;
    readonly padi: FakePadi | null;
    readonly state?: FleetHostState;
  }>,
): FleetHosts {
  const held = new Map(rows.map((one) => [one.key, one]));
  return {
    keys: () => [...held.keys()],
    display: (key) => held.get(key)?.display ?? key,
    padi: (key) => held.get(key)?.padi?.client ?? null,
    state: (key) => held.get(key)?.state ?? "connected",
    subscribe: () => () => {},
  };
}

/** The refusal a call raised — caught, so its kind and its whole sentence can
 *  both be read. */
const refusalOf = async (call: Promise<unknown>): Promise<WorkRefusal> => {
  const thrown = await call.then(
    () => null,
    (err: unknown) => err,
  );
  if (thrown instanceof WorkRefusal) return thrown;
  throw new Error(`nothing was refused: ${String(thrown)}`);
};

/** An offer over one host called `build-box`, which a person knows as "the
 *  build box". */
const offerOver = (
  padi: FakePadi | null,
  over: {
    readonly listing?: AgentDistroListing;
    readonly state?: FleetHostState;
  } = {},
) =>
  koluOfferOver({
    listing: over.listing ?? LISTING,
    hosts: fakeHosts([
      {
        key: "build-box",
        display: "the build box",
        padi,
        ...(over.state === undefined ? {} : { state: over.state }),
      },
    ]),
  });

describe("the gate in front of a harness question", () => {
  it("lets a READY host through", async () => {
    const { requireAgentsReady } = offerOver(fakePadi({ status: READY }));
    // Resolves. A host with agents has a harness to choose, so there is
    // nothing to say about it.
    await expect(requireAgentsReady("build-box")).resolves.toBeUndefined();
  });

  it("refuses a host whose agents are OFF, naming it and what to do", async () => {
    const { requireAgentsReady } = offerOver(
      fakePadi({ status: { kind: "off" } }),
    );
    const refused = await refusalOf(requireAgentsReady("build-box"));
    expect(refused.kind).toBe("agents-not-ready");
    // The person's own name for the machine, and the one thing that fixes it
    // — a refusal that says "not ready" and stops is a turn wasted.
    expect(refused.why).toContain("the build box");
    expect(refused.why).toContain("Turn Agents on");
    expect(refused.why).toContain("Settings");
    // ... and in agent-distro's OWN words, not a second wording kolu would
    // have to keep in step with the Settings line beside it.
    expect(refused.why).toBe(
      agentsNotReadyWords({ kind: "off" }, "the build box"),
    );
  });

  it("refuses a host whose agents are still ARRIVING", async () => {
    const downloading: AgentDistroStatus = {
      kind: "downloading",
      profiles: ["github:juspay/skills"],
    };
    const { requireAgentsReady } = offerOver(fakePadi({ status: downloading }));
    const refused = await refusalOf(requireAgentsReady("build-box"));
    expect(refused.kind).toBe("agents-not-ready");
    expect(refused.why).toBe(agentsNotReadyWords(downloading, "the build box"));
    expect(refused.why).toContain("Wait for the download to finish");
  });

  it("refuses a host whose delivery FAILED, carrying the failure's headline", async () => {
    const failed: AgentDistroStatus = {
      kind: "error",
      profiles: ["github:juspay/skills"],
      message: "error: builder for '/nix/store/x.drv' failed with exit code 1",
    };
    const { requireAgentsReady } = offerOver(fakePadi({ status: failed }));
    const refused = await refusalOf(requireAgentsReady("build-box"));
    expect(refused.kind).toBe("agents-not-ready");
    expect(refused.why).toBe(agentsNotReadyWords(failed, "the build box"));
    expect(refused.why).toContain("could not be delivered to the build box");
  });

  it("refuses a READY host whose agents are OLDER than this kolu needs", async () => {
    // The human's own host: the package kolu delivered (upstream's newest
    // published) predates `--models`. It serves terminals, so it reads ready;
    // what it answers says no model can be asked of it — so no form is handed
    // out that nobody could answer.
    const { requireAgentsReady } = offerOver(
      fakePadi({ status: { ...READY, answers: [] } }),
    );
    const refused = await refusalOf(requireAgentsReady("build-box"));
    expect(refused.kind).toBe("agents-not-ready");
    expect(refused.why).toBe(agentsTooOldWords("the build box"));
  });

  it("refuses when THIS kolu was built without agent-distro, before asking the host", async () => {
    const padi = fakePadi({ status: READY });
    const { requireAgentsReady } = offerOver(padi, {
      listing: { kind: "unavailable" },
    });
    const refused = await refusalOf(requireAgentsReady("build-box"));
    expect(refused.kind).toBe("agents-not-ready");
    expect(refused.why).toContain("built without agent-distro");
    // ... and `harnesses` is honestly empty rather than a list of nothing
    // that reads like a host problem.
    expect(
      offerOver(padi, { listing: { kind: "unavailable" } }).harnesses(),
    ).toEqual([]);
  });

  it("refuses a host that is NOT CONNECTED, by name and by state", async () => {
    const { requireAgentsReady } = offerOver(null, { state: "warming" });
    const refused = await refusalOf(requireAgentsReady("build-box"));
    expect(refused.kind).toBe("agents-not-ready");
    expect(refused.why).toContain("the build box is warming");
    expect(refused.why).toContain("Ask again once it is back");
  });

  it("THROWS, naming the host, when a padi answered no status at all", async () => {
    const { requireAgentsReady } = offerOver(
      fakePadi({ status: READY, silent: true }),
    );
    // A missing snapshot is a BROKEN LINK, not a reading of the host: it is
    // not refused (a refusal is something the person can act on) but thrown,
    // carrying the host's name. Collapsing it to "no agents yet" would read
    // as a machine with nothing installed and send somebody to Settings.
    await expect(requireAgentsReady("build-box")).rejects.toThrow(
      "the build box answered no agent status",
    );
    await expect(requireAgentsReady("build-box")).rejects.not.toBeInstanceOf(
      WorkRefusal,
    );
  });
});

describe("the options kolu draws", () => {
  it("offers the harnesses this kolu's package carries, by command name", async () => {
    const offer = offerOver(fakePadi({ status: READY }));
    // The NAME, not the title: it is what a launch runs and what an answer is
    // checked against.
    expect(offer.harnesses()).toEqual(["omp", "claude"]);
  });

  it("asks the WORK'S HOST what a harness offers THERE, in the work's repository", async () => {
    const padi = fakePadi({
      status: READY,
      models: { omp: OMP_MODELS, claude: CLAUDE_MODELS },
    });
    const offer = offerOver(padi);
    // The host's WHOLE answer — the list and how the harness takes a model,
    // which a start reads its launch off.
    expect(
      await offer.models({ host: "build-box", repo: REPO, harness: "omp" }),
    ).toEqual(OMP_MODELS);
    // A harness with no way to list its models says so — and that is an
    // ANSWER: whatever model id the person names is then the model.
    expect(
      await offer.models({ host: "build-box", repo: REPO, harness: "claude" }),
    ).toEqual(CLAUDE_MODELS);
    // Both asked of the host, about the work's own repository.
    expect(padi.modelCalls()).toEqual([`omp@${REPO}`, `claude@${REPO}`]);
  });

  it("REJECTS with the host's own words when the listing failed", async () => {
    const offer = offerOver(
      fakePadi({ status: READY, models: { omp: LIST_FAILED } }),
    );
    // NEVER an empty list. The recorder turns this into its `not-offered`
    // refusal carrying these same words, so the person reads why the box they
    // are looking at has nothing in it.
    await expect(
      offer.models({ host: "build-box", repo: REPO, harness: "omp" }),
    ).rejects.toThrow(LIST_FAILED);
  });

  it("REJECTS for a harness the host does not have, in the host's words", async () => {
    const offer = offerOver(
      fakePadi({ status: READY, models: { omp: OMP_MODELS } }),
    );
    await expect(
      offer.models({ host: "build-box", repo: REPO, harness: "claude" }),
    ).rejects.toThrow("claude is not a harness on this host");
  });

  it("REJECTS for a host that is not connected, naming it", async () => {
    const offer = offerOver(null, { state: "failed" });
    const refused = await refusalOf(
      offer.models({ host: "build-box", repo: REPO, harness: "omp" }),
    );
    expect(refused.kind).toBe("agents-not-ready");
    expect(refused.why).toContain("the build box is failed");
    expect(refused.why).toContain("which harnesses it can run");
  });

  it("REJECTS for a watch, which has no repository to ask about", async () => {
    const padi = fakePadi({ status: READY, models: { omp: OMP_MODELS } });
    const offer = offerOver(padi);
    // A watch is the person's own terminal: there is no repository a harness
    // would be asked in, so this is a caller mistake rather than a host that
    // is away.
    await expect(
      offer.models({ host: "build-box", repo: "", harness: "omp" }),
    ).rejects.toThrow("a watch has no repository");
    expect(padi.modelCalls()).toEqual([]);
  });
});
