import { GIB, MIB } from "@kolu/byte-units";
import { describe, expect, it } from "vitest";
import { agentBundleShortHash } from "./bundle.ts";
import type { AgentDistroListing } from "./listing.ts";
import { DEFAULT_AGENT_PROFILE } from "./manifest.ts";
import type { AgentDistroStatus } from "./schema.ts";
import {
  AGENTS_NOT_CHOSEN,
  AGENTS_OFF,
  agentsStepHint,
  agentDistroChoice,
  agentDistroSettingOf,
  agentsChosen,
  agentsChosenLabel,
  agentsPressedSegment,
  agentsRestingSegment,
  firstRunAgentsDone,
  AGENTS_RETRY,
  agentFailureLines,
  agentFailureRemedy,
  agentMarkWords,
  DOWNLOAD_MIN_FILL,
  agentMarkLabel,
  agentChipLabel,
  agentMarkOf,
  agentRestartAction,
  agentRestartReady,
  agentStaleLabel,
  agentStalenessOf,
  agentStatusLines,
  agentToast,
  AGENTS_OFF_MEANS,
  agentsHint,
  agentsSegments,
  downloadBytes,
  downloadEdge,
  harnessLine,
  restartedLabel,
  unknownProfileMessage,
  unknownProfileOf,
} from "./status.ts";

const READY_BUNDLE =
  "/nix/store/nd11nx5f1dkf02cr9dhxqq4axg23vzgc-agent-distro-vanilla";

describe("agentMarkOf — the one status → treatment fold", () => {
  const cases: [string, AgentDistroStatus | undefined, unknown][] = [
    ["no frame yet, not checking", undefined, { kind: "none", why: "unheard" }],
    ["off", { kind: "off" }, { kind: "none", why: "off" }],
    [
      "unavailable",
      { kind: "unavailable" },
      { kind: "none", why: "unavailable" },
    ],
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
        progress: { done: 1.1 * GIB, total: 2 * GIB },
      },
      { kind: "downloading", fraction: 0.55, bytes: "1.1 GiB of 2.0 GiB" },
    ],
    [
      "downloading, no numbers yet",
      { kind: "downloading", profile: "vanilla" },
      // Nothing counted yet still shows a sliver — never an empty track.
      { kind: "downloading", fraction: DOWNLOAD_MIN_FILL, bytes: undefined },
    ],
    [
      "error",
      {
        kind: "error",
        profile: "vanilla",
        reason: "updater",
        message: "cache not usable",
      },
      { kind: "failed", reason: "updater", message: "cache not usable" },
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
    expect(downloadBytes({ done: 603 * MIB, total: 2.2 * GIB })).toBe(
      "603 MiB of 2.2 GiB",
    );
  });
});

describe("agentMarkLabel", () => {
  it("words each treatment; none has no words", () => {
    expect(
      agentMarkLabel({ kind: "none", why: "off" }, "this machine"),
    ).toBeUndefined();
    expect(agentMarkLabel({ kind: "checking" }, "this machine")).toBe(
      "Coding agents: checking this machine…",
    );
    expect(
      agentMarkLabel(
        { kind: "ready", profile: "vanilla", hash: "8rcmf6rd" },
        "box",
      ),
    ).toBe(
      "Coding agents ready on box: vanilla (8rcmf6rd) — new terminals there start with them",
    );
    expect(
      agentMarkLabel(
        {
          kind: "downloading",
          fraction: 0.55,
          bytes: "1.1 GiB of 2.0 GiB",
        },
        "this machine",
      ),
    ).toBe("Downloading the coding agents to this machine… 1.1 GiB of 2.0 GiB");
    expect(
      agentMarkLabel(
        { kind: "failed", reason: "updater", message: "nix missing" },
        "box",
      ),
    ).toBe(
      `The coding agents could not be downloaded to box: nix missing\n${AGENTS_RETRY}`,
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
  it("names each agent the way people know it, with its version, in listing order", () => {
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
    ).toBe("Claude Code 2.1.291 · Codex 0.80.1 · Oh My Pi 18.7.0");
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
/** The opening both Agents hints share, as the reader sees it — typed once here
 *  so a reworded lead fails every test that pins it. */
const BARE_LEAD =
  "Kolu can bring AI coding agents along — kept up to date, nothing to install:";
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

  it("hovers say, in plain words, what each choice is — upstream's text after", () => {
    if (LISTING.kind !== "available") throw new Error("fixture");
    expect(agentsSegments(LISTING.profiles).map((s) => s.hint)).toEqual([
      AGENTS_OFF_MEANS,
      "Stock agents, your own API keys.\nagent-distro describes it as: Upstream harnesses with your own provider",
      "Juspay's agents and skills, through Juspay's gateway.\nagent-distro describes it as: Juspay skills + Kolu",
    ]);
  });

  it("refuses a profile kolu has no plain words for", () => {
    expect(() =>
      agentsSegments([{ name: "mystery", description: "m", harnesses: [] }]),
    ).toThrow(/PROFILE_PLAIN/);
  });

  it("refuses a profile named like the Off segment", () => {
    expect(() =>
      agentsSegments([{ name: AGENTS_OFF, description: "", harnesses: [] }]),
    ).toThrow();
  });
});

describe("agentsHint", () => {
  const base = { listing: LISTING };

  it("off: what kolu can bring, which agents (the default profile's, from the listing), the choices, the consequence", () => {
    expect(
      agentsHint({ ...base, stored: { enabled: false, profile: "vanilla" } }),
    ).toEqual({
      tone: "muted",
      text: [
        BARE_LEAD,
        "Claude Code 2.1.291 · Codex 0.160.1",
        "Pick vanilla (stock agents, your own API keys) or juspay (Juspay's agents and skills, through Juspay's gateway). New terminals then start with those agents; what you installed yourself stays as a fallback.",
        `Off — ${AGENTS_OFF_MEANS}`,
      ].join("\n"),
    });
  });

  it("on: what the profile is in plain words, then its agents with versions", () => {
    expect(agentsHint({ ...base, stored: VANILLA_ON })).toEqual({
      tone: "muted",
      text: [
        "Stock agents, your own API keys.",
        "Claude Code 2.1.291 · Codex 0.160.1",
      ].join("\n"),
    });
  });

  it("keeps the unknown-choice warning, never resetting the choice", () => {
    expect(
      agentsHint({ ...base, stored: { enabled: true, profile: "gone" } }),
    ).toEqual({ tone: "warn", text: unknownProfileMessage("gone") });
  });

  it("says nothing until the listing arrives", () => {
    expect(
      agentsHint({ ...base, listing: undefined, stored: VANILLA_ON }),
    ).toBeUndefined();
  });

  it("nothing chosen: the off explanation, then that nothing is chosen yet", () => {
    const off = agentsHint({
      ...base,
      stored: { enabled: false, profile: "vanilla" },
    });
    expect(agentsHint({ ...base, stored: null })).toEqual({
      tone: "muted",
      text: `${off?.text}\n${AGENTS_NOT_CHOSEN}`,
    });
  });
});

describe("the stored Agents value — `null` is never chosen", () => {
  it("agentDistroSettingOf: null is off on the default profile; a value is itself", () => {
    expect(agentDistroSettingOf(null)).toEqual({
      enabled: false,
      profile: DEFAULT_AGENT_PROFILE,
    });
    // One shared value, so a memo over the fold never re-notifies on null.
    expect(agentDistroSettingOf(null)).toBe(agentDistroSettingOf(null));
    expect(DEFAULT_AGENT_PROFILE).toBe("vanilla");
    const juspayOff = { enabled: false, profile: "juspay" };
    expect(agentDistroSettingOf(juspayOff)).toBe(juspayOff);
    expect(agentDistroSettingOf(VANILLA_ON)).toBe(VANILLA_ON);
  });

  it("agentsChosen is the absence of a value, and nothing else", () => {
    expect(agentsChosen(null)).toBe(false);
    expect(agentsChosen({ enabled: false, profile: "vanilla" })).toBe(true);
    expect(agentsChosen(VANILLA_ON)).toBe(true);
  });

  it("agentsPressedSegment: none while nothing is chosen, the choice after (Off whatever profile is remembered)", () => {
    expect(agentsPressedSegment(null)).toBeUndefined();
    expect(agentsPressedSegment({ enabled: false, profile: "juspay" })).toBe(
      AGENTS_OFF,
    );
    expect(agentsPressedSegment(VANILLA_ON)).toBe("vanilla");
  });

  it("agentsRestingSegment: the default (the listing's first) profile, Off when there is none", () => {
    expect(agentsRestingSegment(LISTING)).toBe("vanilla");
    expect(agentsRestingSegment({ kind: "available", profiles: [] })).toBe(
      AGENTS_OFF,
    );
    expect(agentsRestingSegment({ kind: "unavailable" })).toBe(AGENTS_OFF);
    expect(agentsRestingSegment(undefined)).toBe(AGENTS_OFF);
  });

  it("agentDistroChoice writes the whole value; Off keeps the stored profile", () => {
    expect(agentDistroChoice("juspay", null)).toEqual({
      enabled: true,
      profile: "juspay",
    });
    expect(agentDistroChoice(AGENTS_OFF, null)).toEqual({
      enabled: false,
      profile: DEFAULT_AGENT_PROFILE,
    });
    expect(
      agentDistroChoice(AGENTS_OFF, { enabled: true, profile: "juspay" }),
    ).toEqual({ enabled: false, profile: "juspay" });
    expect(
      agentDistroChoice("vanilla", { enabled: false, profile: "juspay" }),
    ).toEqual(VANILLA_ON);
  });
});

describe("agentsStepHint — the welcome card's form of the hint", () => {
  const LEAD = `${BARE_LEAD} Claude Code 2.1.291 · Codex 0.160.1`;
  /** The listing with juspay carrying agents of its own, so the lead can
   *  follow the profile in view. */
  const STEP_LISTING: AgentDistroListing = {
    kind: "available",
    profiles: [
      ...(LISTING.kind === "available" ? LISTING.profiles.slice(0, 1) : []),
      {
        name: "juspay",
        description: "Juspay skills + Kolu",
        harnesses: [
          {
            name: "claude",
            title: "Claude Code",
            tagline: "t",
            version: "9.9.9",
          },
        ],
      },
    ],
  };

  it("the lead names the agents of the profile in view on one line; the choice line follows the segment", () => {
    expect(
      agentsStepHint({ listing: STEP_LISTING, segment: "vanilla" }),
    ).toEqual({
      lead: LEAD,
      choice: "vanilla — stock agents, your own API keys",
    });
    expect(
      agentsStepHint({ listing: STEP_LISTING, segment: "juspay" }),
    ).toEqual({
      lead: `${BARE_LEAD} Claude Code 9.9.9`,
      choice: "juspay — Juspay's agents and skills, through Juspay's gateway",
    });
  });

  it("on Off, or with nothing in view, the lead names the default profile's agents", () => {
    expect(
      agentsStepHint({ listing: STEP_LISTING, segment: AGENTS_OFF }),
    ).toEqual({
      lead: LEAD,
      choice: `Off — ${AGENTS_OFF_MEANS}`,
    });
    expect(
      agentsStepHint({ listing: STEP_LISTING, segment: undefined }),
    ).toEqual({
      lead: LEAD,
      choice: undefined,
    });
  });

  it("a profile with no agents listed leaves the lead bare, never a dangling space", () => {
    expect(agentsStepHint({ listing: LISTING, segment: "juspay" })?.lead).toBe(
      BARE_LEAD,
    );
  });

  it("shares its vocabulary with the Settings hint", () => {
    const settings = agentsHint({ listing: LISTING, stored: null })?.text ?? "";
    // juspay lists no agents in LISTING, so its step lead is the bare opening.
    const bare = agentsStepHint({ listing: LISTING, segment: "juspay" });
    const off = agentsStepHint({ listing: LISTING, segment: AGENTS_OFF });
    expect(settings.startsWith(bare?.lead ?? "-")).toBe(true);
    expect(settings).toContain(off?.choice ?? "-");
  });

  it("says nothing before the listing, or in a kolu built without agents", () => {
    expect(
      agentsStepHint({ listing: undefined, segment: "vanilla" }),
    ).toBeUndefined();
    expect(
      agentsStepHint({ listing: { kind: "unavailable" }, segment: AGENTS_OFF }),
    ).toBeUndefined();
  });
});

describe("firstRunAgentsDone — the first-run step's done-predicate", () => {
  const OFF = { enabled: false, profile: "vanilla" };
  /** One status of every kind — `satisfies` keeps it exhaustive. */
  const STATUSES = {
    off: { kind: "off" },
    unavailable: { kind: "unavailable" },
    downloading: { kind: "downloading", profile: "vanilla" },
    ready: { kind: "ready", profile: "vanilla", bundle: BUNDLE },
    error: {
      kind: "error",
      profile: "vanilla",
      reason: "updater",
      message: "m",
    },
  } as const satisfies {
    [K in AgentDistroStatus["kind"]]: Extract<AgentDistroStatus, { kind: K }>;
  };
  const kinds = Object.keys(STATUSES) as AgentDistroStatus["kind"][];

  it("is never done while nothing is chosen, whatever this machine says", () => {
    for (const local of [undefined, ...Object.values(STATUSES)])
      expect(
        firstRunAgentsDone({ stored: null, listing: LISTING, local }),
      ).toBe(false);
  });

  it("is never done while Off is chosen either — Off keeps the choice at the top", () => {
    for (const local of [undefined, ...Object.values(STATUSES)]) {
      expect(firstRunAgentsDone({ stored: OFF, listing: LISTING, local })).toBe(
        false,
      );
      // Off with a remembered profile kolu no longer ships is still just Off.
      expect(
        firstRunAgentsDone({
          stored: { enabled: false, profile: "gone" },
          listing: LISTING,
          local,
        }),
      ).toBe(false);
    }
  });

  it("with a profile chosen, waits until this machine has settled — not known until its status catches up", () => {
    const want: Record<AgentDistroStatus["kind"], boolean | undefined> = {
      // padi still off: the push has not landed (a reload, a server restart).
      off: undefined,
      unavailable: true,
      downloading: false,
      ready: true,
      error: false,
    };
    for (const kind of kinds)
      expect(
        firstRunAgentsDone({
          stored: VANILLA_ON,
          listing: LISTING,
          local: STATUSES[kind],
        }),
      ).toBe(want[kind]);
    expect(
      firstRunAgentsDone({
        stored: VANILLA_ON,
        listing: LISTING,
        local: undefined,
      }),
    ).toBeUndefined();
  });

  it("a status for another profile is one padi has not caught up from: not known yet", () => {
    for (const kind of ["ready", "downloading", "error"] as const)
      expect(
        firstRunAgentsDone({
          stored: { enabled: true, profile: "juspay" },
          listing: LISTING,
          local: STATUSES[kind],
        }),
      ).toBeUndefined();
  });

  it("is not known until the listing arrives — without it the step could only offer Off", () => {
    for (const stored of [null, OFF, VANILLA_ON])
      expect(
        firstRunAgentsDone({ stored, listing: undefined, local: undefined }),
      ).toBeUndefined();
  });

  it("is done at once in a kolu built without agents — there is nothing to choose", () => {
    for (const stored of [null, OFF, VANILLA_ON])
      expect(
        firstRunAgentsDone({
          stored,
          listing: { kind: "unavailable" },
          local: undefined,
        }),
      ).toBe(true);
  });

  it("is done for a stored profile this kolu does not ship — Settings warns; the row must not pin forever", () => {
    expect(
      firstRunAgentsDone({
        stored: { enabled: true, profile: "gone" },
        listing: LISTING,
        local: STATUSES.downloading,
      }),
    ).toBe(true);
  });

  it("its done line names the chosen profile, and there is none while agents are off", () => {
    expect(agentsChosenLabel(VANILLA_ON, LISTING)).toBe("Agents: vanilla ✓");
    expect(
      agentsChosenLabel({ enabled: true, profile: "juspay" }, LISTING),
    ).toBe("Agents: juspay ✓");
    expect(agentsChosenLabel(OFF, LISTING)).toBeUndefined();
  });

  it("has no done line for a stored profile this kolu does not ship — Settings warns about it", () => {
    expect(
      agentsChosenLabel({ enabled: true, profile: "gone" }, LISTING),
    ).toBeUndefined();
  });

  it("has no done line in a kolu built without agents — nobody chose anything", () => {
    expect(agentsChosenLabel(OFF, { kind: "unavailable" })).toBeUndefined();
    expect(
      agentsChosenLabel(VANILLA_ON, { kind: "unavailable" }),
    ).toBeUndefined();
  });
});

describe("agentStatusLines", () => {
  const ready = { kind: "ready", profile: "vanilla", bundle: BUNDLE } as const;
  const host = (
    label: string,
    status: AgentDistroStatus | undefined,
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

  it("every host ready on DIFFERENT builds: collapses without claiming one hash", () => {
    const fetched = {
      kind: "ready",
      profile: "vanilla",
      bundle:
        "/nix/store/pcs6b3vjzzzzzzzzzzzzzzzzzzzzzzzz-agent-distro-vanilla",
    } as const;
    expect(
      agentStatusLines({
        local: host("this machine", ready),
        remotes: [host("box", fetched)],
      }),
    ).toEqual([
      {
        host: "this machine",
        bar: "ok",
        fill: 1,
        text: "ready · vanilla · on 2 hosts",
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
            progress: { done: 1.1 * GIB, total: 2 * GIB },
          }),
          host("done", ready),
          host("pu-3", {
            kind: "error",
            profile: "vanilla",
            reason: "updater",
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
      { host: "box", bar: "busy", fill: 0.55, text: "1.1 GiB of 2.0 GiB" },
      {
        host: "pu-3",
        bar: "warn",
        fill: 1,
        text: `The coding agents could not be downloaded to pu-3: cache not usable\n${AGENTS_RETRY}`,
      },
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
      {
        host: "this machine",
        bar: "busy",
        fill: DOWNLOAD_MIN_FILL,
        text: "downloading…",
      },
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
  const terminal = { agents: { profile: "vanilla", bundle: OLD } };
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

  it("another profile the host has not settled on yet: stale, waiting on its download", () => {
    for (const status of [
      undefined,
      { kind: "downloading", profile: "juspay" } as const,
      ready("vanilla", OLD),
    ])
      expect(
        agentStalenessOf({ terminal, status, setting: on("juspay") }),
      ).toEqual({
        kind: "stale",
        had,
        now: { kind: "waiting", profile: "juspay", on: "downloading" },
      });
    expect(
      agentStalenessOf({
        terminal,
        status: {
          kind: "error",
          profile: "juspay",
          reason: "updater",
          message: "m",
        },
        setting: on("juspay"),
      }),
    ).toEqual({
      kind: "stale",
      had,
      now: { kind: "waiting", profile: "juspay", on: "failed" },
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

  it("same profile with no word from the host yet: current", () => {
    for (const status of [
      undefined,
      { kind: "off" } as const,
      { kind: "unavailable" } as const,
    ])
      expect(
        agentStalenessOf({ terminal, status, setting: on("vanilla") }),
      ).toEqual({ kind: "current" });
  });

  it("same profile while the host downloads or failed: stale — a new terminal there gets no agents", () => {
    expect(
      agentStalenessOf({
        terminal,
        status: { kind: "downloading", profile: "vanilla" },
        setting: on("vanilla"),
      }),
    ).toEqual({
      kind: "stale",
      had,
      now: { kind: "waiting", profile: "vanilla", on: "downloading" },
    });
    expect(
      agentStalenessOf({
        terminal,
        status: {
          kind: "error",
          profile: "vanilla",
          reason: "updater",
          message: "m",
        },
        setting: on("vanilla"),
      }),
    ).toEqual({
      kind: "stale",
      had,
      now: { kind: "waiting", profile: "vanilla", on: "failed" },
    });
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
    for (const on of ["downloading", "failed"] as const)
      expect(
        agentRestartReady({
          kind: "stale",
          had,
          now: { kind: "waiting", profile: "juspay", on },
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
      "This terminal has the vanilla coding agents (nd11nx5f). New terminals get juspay (ivzki9f3). Restart to switch; the agent's conversation resumes on the new agents, other programs end.",
    );
  });
  it("agents now off: a plain shell", () => {
    expect(agentStaleLabel({ kind: "stale", had, now: { kind: "off" } })).toBe(
      "This terminal has the vanilla coding agents (nd11nx5f). Coding agents are now off. Restart to switch; it comes back as a plain shell, and running programs end.",
    );
  });
  it("the new profile still downloading: says so, no Restart yet", () => {
    expect(
      agentStaleLabel({
        kind: "stale",
        had,
        now: { kind: "waiting", profile: "juspay", on: "downloading" },
      }),
    ).toBe(
      "This terminal has the vanilla coding agents (nd11nx5f). New terminals get juspay, which is still downloading to this machine; Restart appears once it is ready.",
    );
  });
  it("the download failed: new terminals get none, no Restart yet", () => {
    expect(
      agentStaleLabel({
        kind: "stale",
        had,
        now: { kind: "waiting", profile: "vanilla", on: "failed" },
      }),
    ).toBe(
      "This terminal has the vanilla coding agents (nd11nx5f). vanilla could not be downloaded to this machine, so new terminals get no coding agents; Restart appears once it is ready.",
    );
  });
  it("the restart's consequence is agentRestartAction's own words", () => {
    for (const now of [
      { kind: "off" } as const,
      { kind: "profile", profile: "juspay", hash: "ivzki9f3" } as const,
    ]) {
      const stale = { kind: "stale", had, now } as const;
      expect(agentStaleLabel(stale)).toContain(
        `Restart to switch; ${agentRestartAction(stale).outcome}.`,
      );
    }
  });
});

describe("unknownProfileOf — the one test for a saved choice kolu does not offer", () => {
  it("names the stored profile only when the listing lacks it, on or off", () => {
    expect(unknownProfileOf({ enabled: true, profile: "gone" }, LISTING)).toBe(
      "gone",
    );
    expect(unknownProfileOf({ enabled: false, profile: "gone" }, LISTING)).toBe(
      "gone",
    );
    expect(
      unknownProfileOf({ enabled: true, profile: "vanilla" }, LISTING),
    ).toBeUndefined();
    expect(
      unknownProfileOf({ enabled: true, profile: "gone" }, undefined),
    ).toBeUndefined();
  });
});

describe("agentRestartAction — what the stale pill's restart does, decided once", () => {
  const had = { profile: "vanilla", hash: "nd11nx5f" };
  it("agents stay on: the conversation resumes — not destructive", () => {
    expect(
      agentRestartAction({
        kind: "stale",
        had,
        now: { kind: "profile", profile: "juspay", hash: "ivzki9f3" },
      }),
    ).toEqual({
      label: "Restart",
      armedLabel: "Restart agent",
      destructive: false,
      outcome:
        "the agent's conversation resumes on the new agents, other programs end",
    });
  });
  it("agents now off: a plain shell, the agent ends — destructive", () => {
    expect(
      agentRestartAction({ kind: "stale", had, now: { kind: "off" } }),
    ).toEqual({
      label: "Restart",
      armedLabel: "Kill agent and restart",
      destructive: true,
      outcome: "it comes back as a plain shell, and running programs end",
    });
  });
});

describe("the words outside the folds", () => {
  it("the pill's hover, the restart toast (from what padi did), the toasts", () => {
    expect(
      agentChipLabel(
        "vanilla",
        "/nix/store/nd11nx5f1dkf02cr9dhxqq4axg23vzgc-agent-distro-vanilla",
      ),
    ).toBe(
      "This terminal started with the vanilla coding agents (nd11nx5f). Click to choose what new terminals get.",
    );
    expect(restartedLabel({ agentProfile: undefined, resumed: false })).toBe(
      "Restarted as a plain shell",
    );
    expect(restartedLabel({ agentProfile: "juspay", resumed: false })).toBe(
      "Restarted with the juspay agents",
    );
    expect(restartedLabel({ agentProfile: "juspay", resumed: true })).toBe(
      "Restarted with the juspay agents; the conversation resumed",
    );
    expect(agentToast.on("juspay")).toBe("New terminals get the juspay agents");
  });
});

describe("downloadEdge — the moments a host's download is worth a toast", () => {
  it("start when a download begins or is first heard under way; ready / failed only out of a download", () => {
    expect(downloadEdge("off", "downloading")).toBe("start");
    expect(downloadEdge(undefined, "downloading")).toBe("start");
    expect(downloadEdge("downloading", "downloading")).toBe("none");
    expect(downloadEdge("downloading", "ready")).toBe("ready");
    expect(downloadEdge("downloading", "error")).toBe("failed");
    expect(downloadEdge(undefined, "ready")).toBe("none");
    expect(downloadEdge("off", "error")).toBe("none");
    expect(downloadEdge("ready", undefined)).toBe("none");
  });
  it("dropped when agents are turned off under a running download", () => {
    expect(downloadEdge("downloading", "off")).toBe("dropped");
    expect(downloadEdge("downloading", "unavailable")).toBe("dropped");
    expect(downloadEdge("ready", "off")).toBe("none");
  });
});

describe("a failure's words: cause, then remedy (by reason), then the retry — each once", () => {
  it("nixMissing carries the host-setup remedy; the retry appears exactly once", () => {
    const label =
      agentMarkLabel(
        {
          kind: "failed",
          reason: "nixMissing",
          message: "nix is not on padi's PATH on this host",
        },
        "box",
      ) ?? "";
    const lines = label.split("\n");
    expect(lines[0]).toBe(
      "The coding agents could not be downloaded to box: nix is not on padi's PATH on this host",
    );
    expect(lines[1]).toBe(agentFailureRemedy("nixMissing"));
    expect(lines.filter((l) => l === AGENTS_RETRY)).toHaveLength(1);
    expect(lines).toHaveLength(3);
  });
  it("an updater failure is its own words, then the retry", () => {
    expect(agentFailureRemedy("updater")).toBeUndefined();
    expect(
      agentFailureLines(
        { reason: "updater", message: "cache not usable" },
        "box",
      ),
    ).toEqual([
      "The coding agents could not be downloaded to box: cache not usable",
      AGENTS_RETRY,
    ]);
  });
  it("the hover, the toast and the Settings line say the same lines", () => {
    const failure = {
      reason: "nixMissing",
      message: "nix is not on padi's PATH on this host",
    } as const;
    const lines = agentFailureLines(failure, "box");
    const mark = { kind: "failed", ...failure } as const;
    // Hover / accessible name.
    expect(agentMarkLabel(mark, "box")).toBe(lines.join("\n"));
    // Toast: the cause as its title, the rest as its description.
    expect(agentMarkWords(mark, "box")).toEqual({
      title: lines[0],
      detail: lines.slice(1),
    });
    // Settings line.
    const [line] = agentStatusLines({
      local: {
        label: "box",
        status: { kind: "error", profile: "vanilla", ...failure },
        checking: false,
      },
      remotes: [],
    });
    expect(line?.text).toBe(lines.join("\n"));
  });
});
