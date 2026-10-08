import { GIB, MIB } from "@kolu/byte-units";
import { describe, expect, it } from "vitest";
import { agentBundleShortHash } from "./bundle.ts";
import { type AgentDistroListing, profileOfBundle } from "./listing.ts";
import { DEFAULT_AGENT_PROFILE } from "./manifest.ts";
import type { AgentDistroReceipt, AgentDistroStatus } from "./schema.ts";
import {
  AGENTS_CHECK_NOW,
  AGENTS_ALL_HOSTS,
  AGENTS_HISTORY,
  agentCheckNowBusy,
  agentCheckNowLabel,
  agentHostCheckable,
  agentMarkFillWords,
  AGENTS_RECEIPT_UNREADABLE,
  AGENTS_UPDATE_CHECKING,
  agentMarkFill,
  agentMarkUpdate,
  AGENTS_UPDATE_DOWNLOADING,
  agentUpdateCheckable,
  agentUpdateHistoryRows,
  agentUpdateRunning,
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
  downloadEdgeFacts,
  harnessLine,
  restartedLabel,
  unknownProfileMessage,
  unknownProfileOf,
  versionsLine,
} from "./status.ts";
import { bundleFiles, readFrom } from "./testing.ts";
import { parseVersions, versionsFile } from "./versions.ts";

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
      agentMarkLabel({ kind: "none", why: "off" }, "naiveintent"),
    ).toBeUndefined();
    expect(agentMarkLabel({ kind: "checking" }, "naiveintent")).toBe(
      "Coding agents: checking naiveintent…",
    );
    expect(
      agentMarkLabel(
        { kind: "ready", profile: "vanilla", hash: "8rcmf6rd" },
        "box",
      ),
    ).toBe(
      "Coding agents ready on box: vanilla (8rcmf6rd) — new terminals on box start with them",
    );
    expect(
      agentMarkLabel(
        {
          kind: "downloading",
          fraction: 0.55,
          bytes: "1.1 GiB of 2.0 GiB",
        },
        "naiveintent",
      ),
    ).toBe("Downloading the coding agents to naiveintent… 1.1 GiB of 2.0 GiB");
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
            version: "2.1.291",
          },
          { name: "codex", title: "Codex", version: "0.80.1" },
          { name: "omp", title: "Oh My Pi", version: "18.7.0" },
        ],
      }),
    ).toBe("Claude Code 2.1.291 · Codex 0.80.1 · Oh My Pi 18.7.0");
  });

  it("cuts a version's `+` revision suffix, as agent-distro's own picker shows it", () => {
    expect(
      versionsLine([
        { title: "OpenCode", version: "1.18.35+53d1eab" },
        { title: "Claude Code", version: "2.1.292" },
      ]),
    ).toBe("OpenCode 1.18.35 · Claude Code 2.1.292");
    // The raw string is kept where it is parsed; only the line cuts it.
    expect(
      parseVersions("opencode\tOpenCode\t1.18.35+53d1eab")[0]?.version,
    ).toBe("1.18.35+53d1eab");
  });

  it("Settings' line for a bundle is its receipt's line — both read the same versions file", () => {
    const read = readFrom(
      bundleFiles("/s/v", {
        name: "vanilla",
        description: "Upstream harnesses with your own provider",
        harnesses: [
          { name: "claude", title: "Claude Code", version: "2.1.292" },
          { name: "opencode", title: "OpenCode", version: "1.18.35+53d1eab" },
        ],
      }),
    );
    // What Settings lists before this machine's receipt (kolu-server's read)…
    const listing: AgentDistroListing = {
      kind: "available",
      profiles: [profileOfBundle("vanilla", "/s/v", read)],
    };
    const hint = (localReceipt: AgentDistroReceipt | undefined) =>
      agentsHint({ stored: VANILLA_ON, listing, localReceipt })?.text;
    // …and what it shows once the receipt is in (padi's read of the same file).
    const receipt: AgentDistroReceipt = {
      profile: "vanilla",
      bundle: "/s/v",
      versions: [...parseVersions(read(versionsFile("/s/v")))],
      events: [],
      running: [],
    };
    expect(hint(receipt)).toBe(hint(undefined));
    expect(hint(undefined)).toBe(
      "Stock agents, your own API keys.\nClaude Code 2.1.292 · OpenCode 1.18.35",
    );
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
          version: "2.1.291",
        },
        { name: "codex", title: "Codex", version: "0.160.1" },
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
  const base = { listing: LISTING, localReceipt: undefined };

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
    const settings =
      agentsHint({ listing: LISTING, stored: null, localReceipt: undefined })
        ?.text ?? "";
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

/** A fixed "ago" phrase, so a line's words do not hang on the clock. */
const AGO = (at: number) => `@${at}`;

describe("agentStatusLines", () => {
  const ready = { kind: "ready", profile: "vanilla", bundle: BUNDLE } as const;
  const host = (
    label: string,
    status: AgentDistroStatus | undefined,
    checking = false,
  ) => ({ label, status, checking, receipt: undefined, ago: AGO });

  it("this machine alone, ready: one line, no host count", () => {
    expect(
      agentStatusLines({
        local: host("naiveintent", ready),
        remotes: [],
      }),
    ).toEqual([
      {
        host: "naiveintent",
        bar: "ok",
        fill: 1,
        text: "ready · vanilla nd11nx5f",
      },
    ]);
  });

  it("every host ready: collapses into one 'all hosts' line, with the count", () => {
    expect(
      agentStatusLines({
        local: host("naiveintent", ready),
        remotes: [host("box", ready), host("zest", ready)],
      }),
    ).toEqual([
      {
        // Labelled by the fold, never one machine's name.
        host: AGENTS_ALL_HOSTS,
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
        local: host("naiveintent", ready),
        remotes: [host("box", fetched)],
      }),
    ).toEqual([
      {
        host: AGENTS_ALL_HOSTS,
        bar: "ok",
        fill: 1,
        text: "ready · vanilla · on 2 hosts",
      },
    ]);
  });

  it("this machine first, then each remote that is not ready — in its state's colour", () => {
    expect(
      agentStatusLines({
        local: host("naiveintent", ready),
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
        host: "naiveintent",
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
        local: host("naiveintent", { kind: "downloading", profile: "v" }),
        remotes: [host("box", ready)],
      }),
    ).toEqual([
      {
        host: "naiveintent",
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
      agentStaleLabel(
        {
          kind: "stale",
          had,
          now: { kind: "profile", profile: "juspay", hash: "ivzki9f3" },
        },
        "naiveintent",
      ),
    ).toBe(
      "This terminal has the vanilla coding agents (nd11nx5f). New terminals get juspay (ivzki9f3). Restart to switch; the agent's conversation resumes on the new agents, other programs end.",
    );
  });
  it("agents now off: a plain shell", () => {
    expect(
      agentStaleLabel(
        { kind: "stale", had, now: { kind: "off" } },
        "naiveintent",
      ),
    ).toBe(
      "This terminal has the vanilla coding agents (nd11nx5f). Coding agents are now off. Restart to switch; it comes back as a plain shell, and running programs end.",
    );
  });
  it("the new profile still downloading: says so, no Restart yet", () => {
    expect(
      agentStaleLabel(
        {
          kind: "stale",
          had,
          now: { kind: "waiting", profile: "juspay", on: "downloading" },
        },
        "naiveintent",
      ),
    ).toBe(
      "This terminal has the vanilla coding agents (nd11nx5f). New terminals get juspay, which is still downloading to naiveintent; Restart appears once it is ready.",
    );
  });
  it("the download failed: new terminals get none, no Restart yet", () => {
    expect(
      agentStaleLabel(
        {
          kind: "stale",
          had,
          now: { kind: "waiting", profile: "vanilla", on: "failed" },
        },
        "naiveintent",
      ),
    ).toBe(
      "This terminal has the vanilla coding agents (nd11nx5f). vanilla could not be downloaded to naiveintent, so new terminals get no coding agents; Restart appears once it is ready.",
    );
  });
  it("the restart's consequence is agentRestartAction's own words", () => {
    for (const now of [
      { kind: "off" } as const,
      { kind: "profile", profile: "juspay", hash: "ivzki9f3" } as const,
    ]) {
      const stale = { kind: "stale", had, now } as const;
      expect(agentStaleLabel(stale, "naiveintent")).toContain(
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
  const k = (kind: AgentDistroStatus["kind"]) => ({ kind });
  const ready = (bundle: string, profile = "vanilla") => ({
    kind: "ready" as const,
    profile,
    bundle,
  });
  it("start when a download begins or is first heard under way; ready / failed only out of a download", () => {
    expect(downloadEdge(k("off"), k("downloading"))).toBe("start");
    expect(downloadEdge(undefined, k("downloading"))).toBe("start");
    expect(downloadEdge(k("downloading"), k("downloading"))).toBe("none");
    expect(downloadEdge(k("downloading"), ready("/a"))).toBe("ready");
    expect(downloadEdge(k("downloading"), k("error"))).toBe("failed");
    expect(downloadEdge(undefined, ready("/a"))).toBe("none");
    expect(downloadEdge(k("off"), k("error"))).toBe("none");
    expect(downloadEdge(ready("/a"), undefined)).toBe("none");
  });
  it("dropped when agents are turned off under a running download", () => {
    expect(downloadEdge(k("downloading"), k("off"))).toBe("dropped");
    expect(downloadEdge(k("downloading"), k("unavailable"))).toBe("dropped");
    expect(downloadEdge(ready("/a"), k("off"))).toBe("none");
  });
  it("updated when a ready host's bundle of the SAME profile changes — never on a switch", () => {
    expect(downloadEdge(ready("/a"), ready("/b"))).toBe("updated");
    expect(downloadEdge(ready("/a"), ready("/a"))).toBe("none");
    expect(downloadEdge(ready("/a"), ready("/b", "juspay"))).toBe("none");
  });
  it("reads its facts off a status, by value", () => {
    expect(
      downloadEdgeFacts({
        kind: "ready",
        profile: "vanilla",
        bundle: "/a",
        update: {},
      }),
    ).toEqual({ kind: "ready", profile: "vanilla", bundle: "/a" });
    expect(downloadEdgeFacts({ kind: "off" })).toEqual({ kind: "off" });
    expect(downloadEdgeFacts(undefined)).toBeUndefined();
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
        receipt: undefined,
        ago: AGO,
      },
      remotes: [],
    });
    expect(line?.text).toBe(lines.join("\n"));
  });
});

describe("K3 — updates while a bundle serves", () => {
  const ready = { kind: "ready", profile: "vanilla", bundle: BUNDLE } as const;
  const checking = { ...ready, update: {} } as const;
  const downloading = {
    ...ready,
    update: { progress: { done: 512 * MIB, total: 2 * GIB } },
  } as const;
  const receipt = (over: Partial<AgentDistroReceipt>): AgentDistroReceipt => ({
    profile: "vanilla",
    versions: [],
    events: [],
    running: [],
    ...over,
  });
  const host = (
    status: AgentDistroStatus,
    r: AgentDistroReceipt | undefined = undefined,
  ) => ({
    label: "naiveintent",
    status,
    checking: false,
    receipt: r,
    ago: AGO,
  });

  it("the mark stays ready while an update runs; a ring only once bytes move", () => {
    expect(agentMarkOf(checking, false)).toEqual({
      kind: "ready",
      profile: "vanilla",
      hash: "nd11nx5f",
      update: {},
    });
    const mark = agentMarkOf(downloading, false);
    expect(mark).toMatchObject({
      kind: "ready",
      update: { download: { fraction: 0.25, bytes: "512 MiB of 2.0 GiB" } },
    });
    expect(agentMarkWords(mark, "box")?.detail).toEqual([
      AGENTS_UPDATE_DOWNLOADING,
    ]);
    expect(agentMarkWords(agentMarkOf(checking, false), "box")?.detail).toEqual(
      ["Checking for newer agents…"],
    );
    // One fold for the phase and the fill, the tab's ring and the line alike.
    expect(agentMarkUpdate(agentMarkOf(checking, false))).toBe("checking");
    expect(agentMarkUpdate(mark)).toBe("downloading");
    expect(agentMarkUpdate(agentMarkOf(ready, false))).toBeUndefined();
    expect(agentMarkFill(mark)).toEqual({
      fraction: 0.25,
      bytes: "512 MiB of 2.0 GiB",
    });
    expect(agentMarkFill(agentMarkOf(checking, false))).toBeUndefined();
    expect(agentMarkLabel(mark, "box")).toContain("512 MiB of 2.0 GiB");
  });

  it("the line's note says the last run, in its own outcome's words", () => {
    const line = (r: AgentDistroReceipt) =>
      agentStatusLines({ local: host(ready, r), remotes: [] })[0]?.note;
    expect(
      line(
        receipt({
          lastRun: { at: 1, outcome: "updated", words: "x", by: "updater" },
        }),
      ),
    ).toEqual({
      text: "updated @1",
      title: "updated @1 — agent-distro's updater: x",
      tone: "muted",
    });
    expect(
      line(
        receipt({
          lastRun: { at: 2, outcome: "unchanged", words: "", by: "updater" },
        }),
      ),
    ).toEqual({
      text: "checked @2, up to date",
      title: "checked @2, up to date",
      tone: "muted",
    });
    // A skip claims no cause: the reason rides in the hover, with its author.
    const reason =
      "cache https://cache.example not usable; add it to nix.settings substituters/trusted-public-keys";
    expect(
      line(
        receipt({
          lastRun: { at: 3, outcome: "skipped", words: reason, by: "updater" },
        }),
      ),
    ).toEqual({
      text: "checked @3, skipped",
      title: `checked @3, skipped — agent-distro's updater: ${reason}`,
      tone: "muted",
    });
    // padi's own words are labelled padi's, never the updater's.
    expect(
      line(
        receipt({
          lastRun: {
            at: 4,
            outcome: "failed",
            words: "the updater exited 3 without a result: TypeError: boom",
            by: "padi",
          },
        }),
      ),
    ).toEqual({
      text: "last update failed @4",
      title:
        "last update failed @4 — padi: the updater exited 3 without a result: TypeError: boom",
      tone: "warn",
    });
    // Files that would not read say so on the line.
    expect(line(receipt({ error: "history line is not …" }))).toEqual({
      text: AGENTS_RECEIPT_UNREADABLE,
      title: `${AGENTS_RECEIPT_UNREADABLE} — padi: history line is not …`,
      tone: "warn",
    });
    // A receipt for another profile is one padi has not caught up from.
    expect(
      line({
        ...receipt({
          lastRun: { at: 1, outcome: "updated", words: "x", by: "updater" },
        }),
        profile: "juspay",
      }),
    ).toBeUndefined();
  });

  it("a host whose history will not read, or whose last run failed, keeps its own line among ready hosts", () => {
    const failedRun = receipt({
      lastRun: {
        at: 4,
        outcome: "failed",
        words: "nix build exit 1",
        by: "updater",
      },
    });
    const unreadable = receipt({ error: "history line is not …" });
    // A remote: its own line, note and all, never folded away.
    const remote = agentStatusLines({
      local: host(ready),
      remotes: [{ ...host(ready, unreadable), label: "box" }],
    });
    expect(remote.map((l) => l.host)).toEqual(["naiveintent", "box"]);
    expect(remote[1]?.note?.text).toBe(AGENTS_RECEIPT_UNREADABLE);
    // The machine running kolu: its line keeps its note, the remotes their
    // settled silence.
    const local = agentStatusLines({
      local: host(ready, failedRun),
      remotes: [{ ...host(ready), label: "box" }],
    });
    expect(local.map((l) => l.host)).toEqual(["naiveintent"]);
    expect(local[0]?.note).toMatchObject({
      text: "last update failed @4",
      tone: "warn",
    });
    // A skip or an up-to-date run is settled: they still fold.
    const skipped = receipt({
      lastRun: { at: 3, outcome: "skipped", words: "x", by: "updater" },
    });
    expect(
      agentStatusLines({
        local: host(ready, skipped),
        remotes: [{ ...host(ready, skipped), label: "box" }],
      }).map((l) => l.host),
    ).toEqual([AGENTS_ALL_HOSTS]);
  });

  it("the line shows a run in flight, and its bytes once it downloads", () => {
    expect(agentStatusLines({ local: host(checking), remotes: [] })).toEqual([
      {
        host: "naiveintent",
        bar: "ok",
        fill: 1,
        text: "ready · vanilla nd11nx5f",
        note: {
          text: AGENTS_UPDATE_CHECKING,
          title: AGENTS_UPDATE_CHECKING,
          tone: "muted",
        },
        update: "checking",
      },
    ]);
    expect(agentStatusLines({ local: host(downloading), remotes: [] })).toEqual(
      [
        {
          // The host IS ready: the bar stays full and green while it updates.
          host: "naiveintent",
          bar: "ok",
          fill: 1,
          text: "ready · vanilla nd11nx5f",
          note: {
            text: "updating · 512 MiB of 2.0 GiB",
            title: "updating · 512 MiB of 2.0 GiB",
            tone: "muted",
          },
          update: "downloading",
        },
      ],
    );
  });

  it("a host that is updating keeps its own line instead of folding", () => {
    const lines = agentStatusLines({
      local: host(ready),
      remotes: [{ ...host(checking), label: "box" }],
    });
    expect(lines.map((l) => l.host)).toEqual(["naiveintent", "box"]);
  });

  it("History: each machine's events, the updater's words, warn for a failure", () => {
    const rows = agentUpdateHistoryRows({
      profile: "vanilla",
      hosts: [
        {
          ago: AGO,
          label: "naiveintent",
          receipt: receipt({
            events: [
              {
                at: "2026-10-08T02:00:05Z",
                profile: "vanilla",
                kind: "updated",
                words: "Claude Code 2.1.286 → 2.1.291",
              },
            ],
          }),
        },
        {
          ago: AGO,
          label: "box",
          receipt: receipt({
            events: [
              {
                at: "2026-10-08T02:00:09Z",
                profile: "vanilla",
                kind: "failed",
                words: "nix build exit 1",
              },
            ],
          }),
        },
        { label: "zest", receipt: undefined, ago: AGO },
        {
          ago: AGO,
          label: "pu-3",
          receipt: receipt({ error: "history line is not …" }),
        },
      ],
    });
    expect(rows).toEqual([
      {
        host: "naiveintent",
        when: `@${Date.parse("2026-10-08T02:00:05Z")}`,
        kind: "updated",
        text: "updated: Claude Code 2.1.286 → 2.1.291",
        title:
          "updated — agent-distro's updater: Claude Code 2.1.286 → 2.1.291",
        tone: "muted",
      },
      {
        host: "box",
        when: `@${Date.parse("2026-10-08T02:00:09Z")}`,
        kind: "failed",
        text: "failed: nix build exit 1",
        title: "failed — agent-distro's updater: nix build exit 1",
        tone: "warn",
      },
      // A history that would not read is a row saying so — never "No
      // updates yet." for that host.
      {
        host: "pu-3",
        when: "",
        kind: "unreadable",
        text: AGENTS_RECEIPT_UNREADABLE,
        title: `${AGENTS_RECEIPT_UNREADABLE} — padi: history line is not …`,
        tone: "warn",
      },
    ]);
    // Only an unreadable history: the History is not empty.
    expect(
      agentUpdateHistoryRows({
        profile: "vanilla",
        hosts: [
          {
            ago: AGO,
            label: "naiveintent",
            receipt: receipt({ error: "boom" }),
          },
        ],
      }),
    ).toHaveLength(1);
  });

  it("the update toast quotes the updater and names the machine", () => {
    // The machine by its name — the host tab's — never "this machine".
    expect(
      agentToast.updated("naiveintent", "Claude Code 2.1.286 → 2.1.291"),
    ).toEqual({
      title: "Coding agents updated on naiveintent",
      description:
        "Claude Code 2.1.286 → 2.1.291 — new terminals on naiveintent start with them; open ones offer Restart.",
    });
  });

  it("Check now: only a ready host with no run can check; any run is busy", () => {
    expect(agentUpdateCheckable(ready)).toBe(true);
    expect(agentUpdateCheckable(checking)).toBe(false);
    expect(agentUpdateCheckable({ kind: "off" })).toBe(false);
    expect(agentUpdateCheckable(undefined)).toBe(false);
    // Any run on any host, for ANY profile — not only the selected one's.
    expect(agentUpdateRunning([receipt({}), undefined])).toBe(false);
    expect(
      agentUpdateRunning([receipt({}), receipt({ running: ["juspay"] })]),
    ).toBe(true);
    expect(AGENTS_CHECK_NOW.label).toBe("Check now");
    expect(AGENTS_HISTORY.title(0)).toBe("History");
    expect(AGENTS_HISTORY.title(4)).toBe("History (4)");
  });

  it("Check now is busy only when no connected host can be asked, and says Checking… only while one runs an update", () => {
    const firstDownload = {
      kind: "downloading",
      profile: "vanilla",
    } as const satisfies AgentDistroStatus;
    const at = (connected: boolean, status: AgentDistroStatus | undefined) => ({
      connected,
      status,
    });
    // A first download on a remote leaves the ready host askable: not busy.
    const fleet = [at(true, ready), at(true, firstDownload)];
    expect(agentHostCheckable(at(true, ready))).toBe(true);
    expect(agentCheckNowBusy(fleet)).toBe(false);
    expect(agentCheckNowLabel(fleet)).toBe(AGENTS_CHECK_NOW.label);
    // A disconnected host's last-known ready cannot answer.
    expect(agentHostCheckable(at(false, ready))).toBe(false);
    expect(agentCheckNowBusy([at(false, ready)])).toBe(true);
    // Every connected host updating: busy, and checking.
    const updating = [at(true, checking), at(true, downloading)];
    expect(agentCheckNowBusy(updating)).toBe(true);
    expect(agentCheckNowLabel(updating)).toBe(AGENTS_CHECK_NOW.busyLabel);
    // Busy with first downloads only: disabled, but nothing is checking.
    expect(agentCheckNowBusy([at(true, firstDownload)])).toBe(true);
    expect(agentCheckNowLabel([at(true, firstDownload)])).toBe(
      AGENTS_CHECK_NOW.label,
    );
  });

  it("the words beside a filling mark's bar: a first download's headline, an update's line", () => {
    expect(agentMarkFillWords(agentMarkOf(downloading, false), "box")).toBe(
      AGENTS_UPDATE_DOWNLOADING,
    );
    const first = agentMarkOf(
      {
        kind: "downloading",
        profile: "vanilla",
        progress: { done: 1, total: 4 },
      },
      false,
    );
    expect(agentMarkFillWords(first, "box")).toBe(
      agentMarkWords(first, "box")?.title,
    );
    expect(
      agentMarkFillWords(agentMarkOf(ready, false), "box"),
    ).toBeUndefined();
    expect(
      agentMarkFillWords(agentMarkOf(checking, false), "box"),
    ).toBeUndefined();
  });

  it("the hint names this machine's versions once it has them", () => {
    const hint = agentsHint({
      listing: LISTING,
      stored: VANILLA_ON,
      localReceipt: receipt({
        versions: [
          { name: "claude", title: "Claude Code", version: "2.1.299" },
        ],
      }),
    });
    expect(hint?.text).toBe(
      "Stock agents, your own API keys.\nClaude Code 2.1.299",
    );
    // A bundle with no versions file names none — never the floor's.
    expect(
      agentsHint({
        listing: LISTING,
        stored: VANILLA_ON,
        localReceipt: receipt({}),
      })?.text,
    ).toBe("Stock agents, your own API keys.");
    // Another profile's receipt (not caught up yet): the set kolu ships.
    expect(
      agentsHint({
        listing: LISTING,
        stored: VANILLA_ON,
        localReceipt: { ...receipt({}), profile: "juspay" },
      })?.text,
    ).toBe(
      "Stock agents, your own API keys.\nClaude Code 2.1.291 · Codex 0.160.1",
    );
  });
});
