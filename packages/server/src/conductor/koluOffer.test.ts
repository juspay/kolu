import type { AgentDistroListing } from "@kolu/agent-distro/listing";
import type { AgentModels } from "@kolu/agent-distro/models";
import type { AgentDistroStatus } from "@kolu/agent-distro/schema";
import {
  agentsNotReadyWords,
  agentsTooOldWords,
} from "@kolu/agent-distro/status";
import { type PadiSurfaceClient, padiClientOver } from "@kolu/padi-client/dial";
import {
  AgentLaunchUnavailable,
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

const REPO = "/srv/repo";

const LISTING: AgentDistroListing = {
  kind: "available",
  harnesses: [
    { name: "omp", title: "omp", version: "5.2.0" },
    { name: "claude", title: "Claude Code", version: "2.1.0" },
  ],
};

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
  answers: ["--list", "--models", "--launch"],
};

const OMP_MODELS: AgentModels = {
  launch: { kind: "flag", flag: "--model" },
  models: {
    kind: "listed",
    ids: ["anthropic/claude-fable-5-2", "litellm/open-large"],
  },
};

const CLAUDE_MODELS: AgentModels = {
  launch: { kind: "flag", flag: "--model" },
  models: { kind: "unlisted" },
};

const LIST_FAILED =
  "`omp --list-models` exited 1: could not reach the model gateway";

interface FakePadi {
  readonly client: PadiSurfaceClient;
  readonly modelCalls: () => ReadonlyArray<string>;
}

function fakePadi(over: {
  readonly status: AgentDistroStatus;
  readonly models?: Readonly<Record<string, AgentModels | string>>;
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
    [at("agentDistro", "launch")]: (input: { harness: string }) =>
      Effect.suspend(() => {
        const answer = over.models?.[input.harness];
        if (answer === undefined)
          return Effect.fail(
            new AgentLaunchUnavailable({
              harness: input.harness,
              why: `${input.harness} is not a harness on this host`,
            }),
          );
        return Effect.succeed({
          model:
            typeof answer === "string"
              ? { kind: "flag", flag: "--model" }
              : answer.launch,
        });
      }),
  } as unknown as SurfaceHandlers;
  return {
    client: padiClientOver(directDispatch({ handlers })).padi,
    modelCalls: () => modelCalls,
  };
}

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

const refusalOf = async (call: Promise<unknown>): Promise<WorkRefusal> => {
  const thrown = await call.then(
    () => null,
    (err: unknown) => err,
  );
  if (thrown instanceof WorkRefusal) return thrown;
  throw new Error(`nothing was refused: ${String(thrown)}`);
};

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
    await expect(requireAgentsReady("build-box")).resolves.toBeUndefined();
  });

  it("refuses a host whose agents are OFF, naming it and what to do", async () => {
    const { requireAgentsReady } = offerOver(
      fakePadi({ status: { kind: "off" } }),
    );
    const refused = await refusalOf(requireAgentsReady("build-box"));
    expect(refused.kind).toBe("agents-not-ready");
    expect(refused.why).toContain("the build box");
    expect(refused.why).toContain("Turn Agents on");
    expect(refused.why).toContain("Settings");
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
    const { requireAgentsReady } = offerOver(
      fakePadi({ status: { ...READY, answers: [] } }),
    );
    const refused = await refusalOf(requireAgentsReady("build-box"));
    expect(refused.kind).toBe("agents-not-ready");
    expect(refused.why).toBe(agentsTooOldWords("the build box"));
  });

  it("refuses a package that lists models but cannot say how a launch takes one", async () => {
    const { requireAgentsReady } = offerOver(
      fakePadi({ status: { ...READY, answers: ["--list", "--models"] } }),
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
    const { harnesses } = offerOver(padi, {
      listing: { kind: "unavailable" },
    });
    expect(harnesses).toThrow(WorkRefusal);
    expect(harnesses).toThrow("built without agent-distro");
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
    expect(offer.harnesses()).toEqual(["omp", "claude"]);
  });

  it("asks the WORK'S HOST what a harness offers THERE, in the work's repository", async () => {
    const padi = fakePadi({
      status: READY,
      models: { omp: OMP_MODELS, claude: CLAUDE_MODELS },
    });
    const offer = offerOver(padi);
    expect(
      await offer.models({ host: "build-box", repo: REPO, harness: "omp" }),
    ).toEqual(OMP_MODELS.models);
    expect(
      await offer.models({ host: "build-box", repo: REPO, harness: "claude" }),
    ).toEqual(CLAUDE_MODELS.models);
    expect(padi.modelCalls()).toEqual([`omp@${REPO}`, `claude@${REPO}`]);
  });

  it("answers a listing that failed as UNAVAILABLE, in the host's own words", async () => {
    const offer = offerOver(
      fakePadi({ status: READY, models: { omp: LIST_FAILED } }),
    );
    expect(
      await offer.models({ host: "build-box", repo: REPO, harness: "omp" }),
    ).toEqual({ kind: "unavailable", why: LIST_FAILED });
  });

  it("says how a launch takes a model even where the listing fails", async () => {
    const offer = offerOver(
      fakePadi({ status: READY, models: { omp: LIST_FAILED } }),
    );
    expect(await offer.launch({ host: "build-box", harness: "omp" })).toEqual({
      kind: "flag",
      flag: "--model",
    });
    await expect(
      offer.launch({ host: "build-box", harness: "claude" }),
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
});
