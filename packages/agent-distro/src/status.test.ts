import { describe, expect, it } from "vitest";
import { agentBundleShortHash } from "./bundle.ts";
import type { AgentDistroListing } from "./listing.ts";
import {
  AGENTS_OFF,
  agentDistroStatusText,
  agentsHint,
  agentsSegmentOf,
  agentsSegments,
  harnessLine,
} from "./status.ts";

describe("agentDistroStatusText", () => {
  it("shows bytes while fetching", () => {
    expect(
      agentDistroStatusText({
        kind: "downloading",
        profile: "vanilla",
        progress: { done: 1_100_000_000, total: 2_000_000_000 },
      }),
    ).toEqual({ tone: "busy", text: "Downloading agents… 1.1 GB of 2.0 GB" });
  });

  it("says no numbers when there are none to say — including a 0-byte total", () => {
    for (const progress of [undefined, { done: 0, total: 0 }])
      expect(
        agentDistroStatusText({
          kind: "downloading",
          profile: "vanilla",
          ...(progress ? { progress } : {}),
        }),
      ).toEqual({ tone: "busy", text: "Downloading agents…" });
  });

  it("is silent for ready, off and unavailable; an error is its message", () => {
    expect(
      agentDistroStatusText({ kind: "ready", profile: "v", bundle: "/b" }),
    ).toBeUndefined();
    expect(agentDistroStatusText({ kind: "off" })).toBeUndefined();
    expect(
      agentDistroStatusText({ kind: "error", profile: "v", message: "m" }),
    ).toEqual({ tone: "error", text: "m" });
  });
});

describe("agentBundleShortHash", () => {
  it("is the first 8 characters of the store hash", () => {
    expect(
      agentBundleShortHash(
        "/nix/store/nd11nx5f1dkf02cr9dhxqq4axg23vzgc-agent-distro-vanilla",
      ),
    ).toBe("nd11nx5f");
  });
});

describe("harnessLine", () => {
  it("lists each harness's command and version, in listing order", () => {
    expect(
      harnessLine({
        name: "vanilla",
        description: "d",
        harnesses: [
          {
            name: "claude",
            title: "Claude Code",
            tagline: "t",
            version: "2.1.291",
          },
          { name: "codex", title: "Codex", tagline: "t", version: "0.80.1" },
          { name: "omp", title: "Oh My Pi", tagline: "t", version: "18.7.0" },
        ],
      }),
    ).toBe("claude 2.1.291 · codex 0.80.1 · omp 18.7.0");
  });
});

const LISTING: AgentDistroListing = {
  kind: "available",
  profiles: [
    {
      name: "vanilla",
      description: "Upstream harnesses with your own provider",
      harnesses: [
        {
          name: "claude",
          title: "Claude Code",
          tagline: "t",
          version: "2.1.291",
        },
        { name: "codex", title: "Codex", tagline: "t", version: "0.160.1" },
      ],
    },
    {
      name: "juspay",
      description: "Juspay skills + Kolu",
      harnesses: [],
    },
  ],
};
const VANILLA_ON = { enabled: true, profile: "vanilla" };
const BUNDLE =
  "/nix/store/nd11nx5f1dkf02cr9dhxqq4axg23vzgc-agent-distro-vanilla";

describe("the one Agents control", () => {
  it("is Off, then one segment per profile", () => {
    if (LISTING.kind !== "available") throw new Error("fixture");
    expect(agentsSegments(LISTING.profiles).map((s) => s.label)).toEqual([
      "Off",
      "vanilla",
      "juspay",
    ]);
  });

  it("refuses a profile named like the Off segment", () => {
    expect(() =>
      agentsSegments([{ name: AGENTS_OFF, description: "", harnesses: [] }]),
    ).toThrow();
  });

  it("shows Off when disabled, whatever profile is remembered", () => {
    expect(agentsSegmentOf({ enabled: false, profile: "juspay" })).toBe(
      AGENTS_OFF,
    );
    expect(agentsSegmentOf({ enabled: true, profile: "juspay" })).toBe(
      "juspay",
    );
  });
});

describe("agentsHint", () => {
  const base = { listing: LISTING, local: undefined, remotes: [] };

  it("off: what turning it on does", () => {
    expect(
      agentsHint({ ...base, setting: { enabled: false, profile: "vanilla" } }),
    ).toEqual({
      tone: "muted",
      text: "Off. Pick a profile to put agent-distro's agents first on the PATH of new terminals, ahead of agents you installed yourself.",
    });
  });

  it("on and ready: description, agents with versions, ready with the short hash", () => {
    expect(
      agentsHint({
        ...base,
        setting: VANILLA_ON,
        local: { kind: "ready", profile: "vanilla", bundle: BUNDLE },
      }),
    ).toEqual({
      tone: "muted",
      text: [
        "Upstream harnesses with your own provider",
        "claude 2.1.291 · codex 0.160.1",
        "Ready for new terminals — vanilla nd11nx5f",
      ].join("\n"),
    });
  });

  it("this machine downloading shows the bytes; failing shows the error in warn", () => {
    expect(
      agentsHint({
        ...base,
        setting: VANILLA_ON,
        local: {
          kind: "downloading",
          profile: "vanilla",
          progress: { done: 1_100_000_000, total: 2_000_000_000 },
        },
      })?.text.split("\n")[2],
    ).toBe("Downloading agents… 1.1 GB of 2.0 GB");
    expect(
      agentsHint({
        ...base,
        setting: VANILLA_ON,
        local: {
          kind: "error",
          profile: "vanilla",
          message: "cache not usable",
        },
      }),
    ).toMatchObject({ tone: "warn" });
  });

  it("adds a line per remote host that is downloading or failed, and none for the rest", () => {
    const hint = agentsHint({
      ...base,
      setting: VANILLA_ON,
      local: { kind: "ready", profile: "vanilla", bundle: BUNDLE },
      remotes: [
        {
          label: "box",
          status: {
            kind: "downloading",
            profile: "vanilla",
            progress: { done: 603_000_000, total: 2_200_000_000 },
          },
        },
        {
          label: "zest",
          status: { kind: "error", profile: "vanilla", message: "nix missing" },
        },
        {
          label: "idle",
          status: { kind: "ready", profile: "vanilla", bundle: BUNDLE },
        },
      ],
    });
    expect(hint?.text.split("\n").slice(3)).toEqual([
      "Downloading on box… 603 MB of 2.2 GB",
      "Failed on zest: nix missing",
    ]);
    expect(hint?.tone).toBe("warn");
  });

  it("keeps the unknown-profile warning, never resetting the choice", () => {
    expect(
      agentsHint({ ...base, setting: { enabled: true, profile: "gone" } }),
    ).toEqual({
      tone: "warn",
      text: '"gone" is not a profile this kolu ships — pick one.',
    });
  });

  it("says nothing until the listing arrives", () => {
    expect(
      agentsHint({ ...base, listing: undefined, setting: VANILLA_ON }),
    ).toBeUndefined();
  });
});
