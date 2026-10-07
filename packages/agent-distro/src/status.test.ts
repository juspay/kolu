import { describe, expect, it } from "vitest";
import { agentBundleShortHash } from "./bundle.ts";
import type { AgentDistroListing } from "./listing.ts";
import {
  AGENTS_OFF,
  AGENTS_RETRY,
  type AgentDistroStatusShape,
  agentMarkLabel,
  agentMarkOf,
  agentRestartReady,
  agentStaleLabel,
  agentStalenessOf,
  agentStatusLines,
  agentsHint,
  agentsSegmentOf,
  agentsSegments,
  downloadBytes,
  harnessLine,
} from "./status.ts";

const READY_BUNDLE =
  "/nix/store/nd11nx5f1dkf02cr9dhxqq4axg23vzgc-agent-distro-vanilla";

describe("agentMarkOf — the one status → treatment fold", () => {
  const cases: [string, AgentDistroStatusShape | undefined, unknown][] = [
    ["no frame yet, not checking", undefined, { kind: "none" }],
    ["off", { kind: "off" }, { kind: "none" }],
    ["unavailable", { kind: "unavailable" }, { kind: "none" }],
    [
      "ready",
      { kind: "ready", profile: "vanilla", bundle: READY_BUNDLE },
      { kind: "ready", profile: "vanilla", hash: "nd11nx5f" },
    ],
    [
      "downloading with bytes",
      {
        kind: "downloading",
        profile: "vanilla",
        progress: { done: 1_100_000_000, total: 2_000_000_000 },
      },
      { kind: "downloading", fraction: 0.55, bytes: "1.1 GB of 2.0 GB" },
    ],
    [
      "downloading, no numbers yet",
      { kind: "downloading", profile: "vanilla" },
      { kind: "downloading", fraction: 0, bytes: undefined },
    ],
    [
      "error",
      { kind: "error", profile: "vanilla", message: "cache not usable" },
      { kind: "failed", message: "cache not usable" },
    ],
  ];
  for (const [name, status, mark] of cases)
    it(name, () => expect(agentMarkOf(status, false)).toEqual(mark));

  it("checking wins until the first frame — derived on the client, no server state", () => {
    expect(agentMarkOf(undefined, true)).toEqual({ kind: "checking" });
  });
});

describe("downloadBytes", () => {
  it("says no numbers when there are none — including a 0-byte total", () => {
    expect(downloadBytes(undefined)).toBeUndefined();
    expect(downloadBytes({ done: 0, total: 0 })).toBeUndefined();
    expect(downloadBytes({ done: 603_000_000, total: 2_200_000_000 })).toBe(
      "603 MB of 2.2 GB",
    );
  });
});

describe("agentMarkLabel", () => {
  it("words each treatment; none has no words", () => {
    expect(agentMarkLabel({ kind: "none" })).toBeUndefined();
    expect(agentMarkLabel({ kind: "checking" })).toBe("Agents: checking…");
    expect(
      agentMarkLabel({ kind: "ready", profile: "vanilla", hash: "8rcmf6rd" }),
    ).toBe("Agents: vanilla 8rcmf6rd · ready for new terminals");
    expect(
      agentMarkLabel({
        kind: "downloading",
        fraction: 0.55,
        bytes: "1.1 GB of 2.0 GB",
      }),
    ).toBe("Downloading agents… 1.1 GB of 2.0 GB");
    expect(agentMarkLabel({ kind: "failed", message: "nix missing" })).toBe(
      `Agents: nix missing\n${AGENTS_RETRY}`,
    );
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
  const base = { listing: LISTING };

  it("off: what turning it on does", () => {
    expect(
      agentsHint({ ...base, setting: { enabled: false, profile: "vanilla" } }),
    ).toEqual({
      tone: "muted",
      text: "Off. Pick a profile to put agent-distro's agents first on the PATH of new terminals, ahead of agents you installed yourself.",
    });
  });

  it("on: the description, then the agents with versions", () => {
    expect(agentsHint({ ...base, setting: VANILLA_ON })).toEqual({
      tone: "muted",
      text: [
        "Upstream harnesses with your own provider",
        "claude 2.1.291 · codex 0.160.1",
      ].join("\n"),
    });
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

describe("agentStatusLines", () => {
  const ready = { kind: "ready", profile: "vanilla", bundle: BUNDLE } as const;
  const host = (
    label: string,
    status: AgentDistroStatusShape | undefined,
    checking = false,
  ) => ({ label, status, checking });

  it("this machine alone, ready: one line, no host count", () => {
    expect(
      agentStatusLines({ local: host("this machine", ready), remotes: [] }),
    ).toEqual([
      {
        host: "this machine",
        bar: "ok",
        fill: 1,
        text: "ready · vanilla nd11nx5f",
      },
    ]);
  });

  it("every host ready: collapses into the first line, with the count", () => {
    expect(
      agentStatusLines({
        local: host("this machine", ready),
        remotes: [host("box", ready), host("zest", ready)],
      }),
    ).toEqual([
      {
        host: "this machine",
        bar: "ok",
        fill: 1,
        text: "ready · vanilla nd11nx5f · on 3 hosts",
      },
    ]);
  });

  it("this machine first, then each remote that is not ready — in its state's colour", () => {
    expect(
      agentStatusLines({
        local: host("this machine", ready),
        remotes: [
          host("box", {
            kind: "downloading",
            profile: "vanilla",
            progress: { done: 1_100_000_000, total: 2_000_000_000 },
          }),
          host("done", ready),
          host("pu-3", {
            kind: "error",
            profile: "vanilla",
            message: "cache not usable",
          }),
          host("ci-2", undefined, true),
        ],
      }),
    ).toEqual([
      {
        host: "this machine",
        bar: "ok",
        fill: 1,
        text: "ready · vanilla nd11nx5f",
      },
      { host: "box", bar: "busy", fill: 0.55, text: "1.1 GB of 2.0 GB" },
      { host: "pu-3", bar: "warn", fill: 1, text: "cache not usable" },
      { host: "ci-2", bar: "empty", fill: 0, text: "checking…" },
    ]);
  });

  it("does not collapse when this machine is not ready, even if every remote is", () => {
    expect(
      agentStatusLines({
        local: host("this machine", { kind: "downloading", profile: "v" }),
        remotes: [host("box", ready)],
      }),
    ).toEqual([
      { host: "this machine", bar: "busy", fill: 0, text: "downloading…" },
    ]);
  });
});

describe("agentStalenessOf — is a terminal's agents what a new one gets", () => {
  const OLD =
    "/nix/store/nd11nx5f1dkf02cr9dhxqq4axg23vzgc-agent-distro-vanilla";
  const NEW =
    "/nix/store/8rcmf6rdyyyyyyyyyyyyyyyyyyyyyyyy-agent-distro-vanilla";
  const JUSPAY =
    "/nix/store/ivzki9f3zzzzzzzzzzzzzzzzzzzzzzzz-agent-distro-juspay";
  const terminal = { agentProfile: "vanilla", agentBundle: OLD };
  const had = { profile: "vanilla", hash: "nd11nx5f" };
  const on = (profile: string) => ({ enabled: true, profile });
  const ready = (profile: string, bundle: string) =>
    ({ kind: "ready", profile, bundle }) as const;

  it("a terminal without agents is never stale", () => {
    expect(
      agentStalenessOf({
        terminal: {},
        status: ready("vanilla", NEW),
        setting: on("vanilla"),
      }),
    ).toEqual({ kind: "current" });
  });

  it("agents now off", () => {
    expect(
      agentStalenessOf({
        terminal,
        status: { kind: "off" },
        setting: { enabled: false, profile: "vanilla" },
      }),
    ).toEqual({ kind: "stale", had, now: { kind: "off" } });
  });

  it("another profile, with its hash once the host is ready with it", () => {
    expect(
      agentStalenessOf({
        terminal,
        status: ready("juspay", JUSPAY),
        setting: on("juspay"),
      }),
    ).toEqual({
      kind: "stale",
      had,
      now: { kind: "profile", profile: "juspay", hash: "ivzki9f3" },
    });
  });

  it("another profile the host has not settled on yet: stale, no hash", () => {
    for (const status of [
      undefined,
      { kind: "downloading", profile: "juspay" } as const,
      { kind: "error", profile: "juspay", message: "m" } as const,
      ready("vanilla", OLD),
    ])
      expect(
        agentStalenessOf({ terminal, status, setting: on("juspay") }),
      ).toEqual({
        kind: "stale",
        had,
        now: { kind: "profile", profile: "juspay", hash: undefined },
      });
  });

  it("same profile, and an update landed: the host's ready bundle differs", () => {
    expect(
      agentStalenessOf({
        terminal,
        status: ready("vanilla", NEW),
        setting: on("vanilla"),
      }),
    ).toEqual({
      kind: "stale",
      had,
      now: { kind: "profile", profile: "vanilla", hash: "8rcmf6rd" },
    });
  });

  it("same profile and the same bundle: current", () => {
    expect(
      agentStalenessOf({
        terminal,
        status: ready("vanilla", OLD),
        setting: on("vanilla"),
      }),
    ).toEqual({ kind: "current" });
  });

  it("same profile while the host has not settled: current — nothing to restart into", () => {
    for (const status of [
      undefined,
      { kind: "off" } as const,
      { kind: "unavailable" } as const,
      { kind: "downloading", profile: "vanilla" } as const,
      { kind: "error", profile: "vanilla", message: "m" } as const,
    ])
      expect(
        agentStalenessOf({ terminal, status, setting: on("vanilla") }),
      ).toEqual({ kind: "current" });
  });
});

describe("agentRestartReady", () => {
  const had = { profile: "vanilla", hash: "nd11nx5f" };
  it("yes when agents are now off, or the new bundle is known; no while it downloads", () => {
    expect(
      agentRestartReady({ kind: "stale", had, now: { kind: "off" } }),
    ).toBe(true);
    expect(
      agentRestartReady({
        kind: "stale",
        had,
        now: { kind: "profile", profile: "juspay", hash: "ivzki9f3" },
      }),
    ).toBe(true);
    expect(
      agentRestartReady({
        kind: "stale",
        had,
        now: { kind: "profile", profile: "juspay", hash: undefined },
      }),
    ).toBe(false);
  });
});

describe("agentStaleLabel", () => {
  const had = { profile: "vanilla", hash: "nd11nx5f" };
  it("agents stay on: the conversation resumes on the new agents", () => {
    expect(
      agentStaleLabel({
        kind: "stale",
        had,
        now: { kind: "profile", profile: "juspay", hash: "ivzki9f3" },
      }),
    ).toBe(
      "This terminal has vanilla nd11nx5f. New terminals get juspay ivzki9f3. Restart to switch; the agent's conversation resumes on the new agents, other programs end.",
    );
  });
  it("agents now off: a plain shell", () => {
    expect(agentStaleLabel({ kind: "stale", had, now: { kind: "off" } })).toBe(
      "This terminal has vanilla nd11nx5f. Agents are now off. Restart to switch; it comes back as a plain shell, and running programs end.",
    );
  });
  it("the new profile still downloading: says so, no Restart yet", () => {
    expect(
      agentStaleLabel({
        kind: "stale",
        had,
        now: { kind: "profile", profile: "juspay", hash: undefined },
      }),
    ).toBe(
      "This terminal has vanilla nd11nx5f. New terminals get juspay, which is still downloading on this host; Restart appears once it is ready.",
    );
  });
});
