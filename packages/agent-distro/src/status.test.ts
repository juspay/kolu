import { GIB, MIB } from "@kolu/byte-units";
import { describe, expect, it } from "vitest";
import { agentBundleShortHash } from "./bundle.ts";
import { type AgentDistroListing, profileOfBundle } from "./listing.ts";
import type { AgentDistroReceipt, AgentDistroStatus } from "./schema.ts";
import {
  AGENTS_CUSTOM,
  AGENTS_REPO_OVERRIDES,
  agentChipProfile,
  agentChips,
  agentFleetSummary,
  agentHostDetail,
  agentProfileCards,
  agentProfileTitle,
  agentSelectedCard,
  agentsResolvedLine,
  JUSPAY_DESCRIPTION,
  JUSPAY_PROFILE,
  profileSuggestions,
  RECENT_PROFILES_CAP,
  rememberProfile,
  selectedAgentProfile,
  AGENTS_CHECK_NOW,
  agentHostCheckable,
  agentMarkFillWords,
  AGENTS_RECEIPT_UNREADABLE,
  AGENTS_UPDATE_CHECKING,
  agentMarkFill,
  agentMarkUpdate,
  AGENTS_UPDATE_DOWNLOADING,
  agentUpdateCheckable,
  agentUpdateRunning,
  agentsStepHint,
  agentDistroChoice,
  agentDistroSettingOf,
  agentsChosen,
  agentsChosenLabel,
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
  agentToast,
  AGENTS_OFF_MEANS,
  agentsHint,
  downloadBytes,
  downloadEdge,
  downloadEdgeFacts,
  restartedLabel,
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

const VANILLA_PROFILE = {
  name: "vanilla",
  description: "Upstream harnesses with your own provider",
  harnesses: [
    { name: "claude", title: "Claude Code", version: "2.1.291" },
    { name: "codex", title: "Codex", version: "0.160.1" },
  ],
};
const LISTING: AgentDistroListing = {
  kind: "available",
  profiles: [
    VANILLA_PROFILE,
    { name: "juspay", description: "Juspay skills + Kolu", harnesses: [] },
  ],
};
/** A build that ships the default bundle only — what kolu ships today, where
 *  Juspay is a reference kolu names itself. */
const VANILLA_ONLY: AgentDistroListing = {
  kind: "available",
  profiles: [VANILLA_PROFILE],
};
const VANILLA_ON = { enabled: true, profile: "vanilla" };
const JUSPAY_ON = { enabled: true, profile: JUSPAY_PROFILE };
const BUNDLE =
  "/nix/store/nd11nx5f1dkf02cr9dhxqq4axg23vzgc-agent-distro-vanilla";

describe("the picker's cards", () => {
  it("names a shipped bundle by its own name, Juspay by name, a reference as itself", () => {
    expect(agentProfileTitle("vanilla", LISTING)).toBe("Vanilla");
    expect(agentProfileTitle(JUSPAY_PROFILE, LISTING)).toBe("Juspay");
    expect(agentProfileTitle("github:me/mine", LISTING)).toBe("github:me/mine");
    // Before the listing arrives nothing is known to be shipped: the stored
    // value is all there is to show.
    expect(agentProfileTitle("vanilla", undefined)).toBe("vanilla");
  });

  it("leads with the default bundle, marks it Default, and ends with Custom…", () => {
    expect(agentProfileCards(VANILLA_ONLY)).toEqual([
      {
        profile: "vanilla",
        title: "Vanilla",
        description: "Upstream harnesses with your own provider",
        isDefault: true,
      },
      {
        profile: JUSPAY_PROFILE,
        title: "Juspay",
        description: JUSPAY_DESCRIPTION,
        reference: JUSPAY_PROFILE,
        isDefault: false,
      },
      {
        profile: undefined,
        title: AGENTS_CUSTOM.title,
        description: AGENTS_CUSTOM.description,
        isDefault: false,
      },
    ]);
  });

  it("a build that ships Juspay describes itself — kolu does not add a second card by that name", () => {
    const cards = agentProfileCards(LISTING);
    expect(cards.filter((c) => c.title === "Juspay")).toEqual([
      {
        profile: "juspay",
        title: "Juspay",
        description: "Juspay skills + Kolu",
        isDefault: false,
      },
    ]);
  });

  it("has no cards until the listing arrives, or in a kolu built without agents", () => {
    expect(agentProfileCards(undefined)).toEqual([]);
    expect(agentProfileCards({ kind: "unavailable" })).toEqual([]);
  });

  it("a reference of the user's own selects Custom…", () => {
    expect(agentSelectedCard(VANILLA_ON, VANILLA_ONLY)?.profile).toBe(
      "vanilla",
    );
    expect(agentSelectedCard(JUSPAY_ON, VANILLA_ONLY)?.profile).toBe(
      JUSPAY_PROFILE,
    );
    expect(
      agentSelectedCard({ enabled: true, profile: "github:me/mine" }, LISTING)
        ?.title,
    ).toBe(AGENTS_CUSTOM.title);
    expect(agentSelectedCard(VANILLA_ON, undefined)).toBeUndefined();
  });
});

describe("agentsHint — the row's words while agents are off", () => {
  const base = { listing: LISTING };

  it("off: one sentence — what off means, and that turning it on brings the chips under it", () => {
    expect(
      agentsHint({ ...base, stored: { enabled: false, profile: "vanilla" } }),
    ).toEqual({
      tone: "muted",
      text: `Off. ${AGENTS_OFF_MEANS} Turn on and they start with these, kept up to date:`,
    });
  });

  it("on: nothing — the picker and its chips speak", () => {
    expect(agentsHint({ ...base, stored: JUSPAY_ON })).toBeUndefined();
  });

  it("says nothing until the listing arrives, and says why in a kolu built without agents", () => {
    expect(
      agentsHint({ listing: undefined, stored: VANILLA_ON }),
    ).toBeUndefined();
    expect(
      agentsHint({ listing: { kind: "unavailable" }, stored: null })?.text,
    ).toMatch(/built without coding agents/);
  });

  it("nothing chosen reads exactly as switched off — the welcome card carries that state", () => {
    expect(agentsHint({ ...base, stored: null })).toEqual(
      agentsHint({ ...base, stored: { enabled: false, profile: "vanilla" } }),
    );
  });
});

describe("agentChips — the agents the Agents row names", () => {
  it("off: the default bundle's agents by name, with no version — nothing is installed", () => {
    expect(
      agentChips({
        setting: { enabled: false, profile: "vanilla" },
        listing: LISTING,
        localReceipt: undefined,
      }),
    ).toEqual([{ title: "Claude Code" }, { title: "Codex" }]);
  });

  it("on, a reference: the agents of the bundle it rides, with versions", () => {
    expect(
      agentChips({
        setting: JUSPAY_ON,
        listing: LISTING,
        localReceipt: undefined,
      }),
    ).toEqual([
      { title: "Claude Code", version: "2.1.291" },
      { title: "Codex", version: "0.160.1" },
    ]);
  });

  it("this machine's receipt names its own versions once it is in", () => {
    expect(
      agentChips({
        setting: JUSPAY_ON,
        listing: LISTING,
        localReceipt: {
          profile: JUSPAY_PROFILE,
          versions: [
            { name: "claude", title: "Claude Code", version: "3.0.0" },
          ],
          events: [],
          running: [],
        },
      }),
    ).toEqual([{ title: "Claude Code", version: "3.0.0" }]);
  });

  it("a bundle with no agents listed names none", () => {
    expect(
      agentChips({
        setting: { enabled: true, profile: "juspay" },
        listing: LISTING,
        localReceipt: undefined,
      }),
    ).toEqual([]);
  });

  it("cuts each version's `+` revision suffix, as agent-distro's own picker shows it — from the listing and from a receipt alike", () => {
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
    // What the row shows before this machine's receipt (kolu-server's read)…
    const listing: AgentDistroListing = {
      kind: "available",
      profiles: [profileOfBundle("vanilla", "/s/v", read)],
    };
    const chips = (localReceipt: AgentDistroReceipt | undefined) =>
      agentChips({ setting: VANILLA_ON, listing, localReceipt });
    // …and once the receipt is in (padi's read of the same file).
    const receipt: AgentDistroReceipt = {
      profile: "vanilla",
      bundle: "/s/v",
      versions: [...parseVersions(read(versionsFile("/s/v")))],
      events: [],
      running: [],
    };
    expect(chips(receipt)).toEqual(chips(undefined));
    expect(chips(undefined)).toEqual([
      { title: "Claude Code", version: "2.1.292" },
      { title: "OpenCode", version: "1.18.35" },
    ]);
    // The raw string is kept where it is parsed; only the chip cuts it.
    expect(
      parseVersions("opencode\tOpenCode\t1.18.35+53d1eab")[0]?.version,
    ).toBe("1.18.35+53d1eab");
  });
});

describe("agentsResolvedLine — does the profile resolve on this machine", () => {
  const ref = "github:nobody/nothing";
  const on = { enabled: true, profile: ref };

  it("pending until this machine's padi answers for THIS profile", () => {
    const pending = { kind: "pending", text: `resolving ${ref}…` };
    expect(agentsResolvedLine(on, undefined)).toEqual(pending);
    expect(agentsResolvedLine(on, { kind: "none" })).toEqual(pending);
    expect(agentsResolvedLine(on, { kind: "pending", profile: ref })).toEqual(
      pending,
    );
    // An answer about the previous profile is one padi has not caught up from.
    expect(
      agentsResolvedLine(on, {
        kind: "resolved",
        profile: JUSPAY_PROFILE,
        name: "juspay",
        description: "d",
      }),
    ).toEqual(pending);
    expect(
      agentsResolvedLine(on, {
        kind: "failed",
        profile: JUSPAY_PROFILE,
        message: "m",
      }),
    ).toEqual(pending);
  });

  it("resolved: agent-distro's name and description", () => {
    expect(
      agentsResolvedLine(JUSPAY_ON, {
        kind: "resolved",
        profile: JUSPAY_PROFILE,
        name: "juspay",
        description: "Juspay skills + Kolu",
      }),
    ).toEqual({ kind: "resolved", text: "juspay · Juspay skills + Kolu" });
    expect(
      agentsResolvedLine(JUSPAY_ON, {
        kind: "resolved",
        profile: JUSPAY_PROFILE,
        name: "juspay",
        description: "",
      }),
    ).toEqual({ kind: "resolved", text: "juspay" });
  });

  it("failed: agent-distro's own words, then what it means for new terminals", () => {
    expect(
      agentsResolvedLine(on, {
        kind: "failed",
        profile: ref,
        message: `cannot fetch ${ref}: HTTP error 404`,
      }),
    ).toEqual({
      kind: "failed",
      text: `cannot fetch ${ref}: HTTP error 404`,
    });
  });

  it("says nothing while agents are off", () => {
    expect(
      agentsResolvedLine({ enabled: false, profile: ref }, undefined),
    ).toBeUndefined();
  });
});

describe("the Custom field's suggestions and memory", () => {
  it("suggests what was set before, most recent first — never a card's own profile", () => {
    expect(
      profileSuggestions({
        recent: ["github:ekala-project/ekala-ai-skills", JUSPAY_PROFILE],
      }),
    ).toEqual([
      { value: "github:ekala-project/ekala-ai-skills", note: "used before" },
      { value: JUSPAY_PROFILE, note: "used before" },
    ]);
    expect(profileSuggestions({ recent: [] })).toEqual([]);
  });

  it("remembers a profile most recent first, once, at most eight — never a shipped bundle", () => {
    expect(rememberProfile(["a/1", "b/2"], "b/2", LISTING)).toEqual([
      "b/2",
      "a/1",
    ]);
    expect(rememberProfile(["a/1"], "vanilla", LISTING)).toEqual(["a/1"]);
    const full = Array.from(
      { length: RECENT_PROFILES_CAP },
      (_, i) => `r/${i}`,
    );
    const next = rememberProfile(full, "new/1", LISTING);
    expect(next).toHaveLength(RECENT_PROFILES_CAP);
    expect(next[0]).toBe("new/1");
    expect(next).not.toContain(`r/${RECENT_PROFILES_CAP - 1}`);
  });
});

describe("the stored Agents value — `null` is never chosen", () => {
  it("agentDistroSettingOf: null is off on the default bundle; a value is itself", () => {
    expect(agentDistroSettingOf(null)).toEqual({
      enabled: false,
      profile: "vanilla",
    });
    expect(JUSPAY_PROFILE).toBe("github:juspay/skills");
    // One shared value, so a memo over the fold never re-notifies on null.
    expect(agentDistroSettingOf(null)).toBe(agentDistroSettingOf(null));
    const vanillaOff = { enabled: false, profile: "vanilla" };
    expect(agentDistroSettingOf(vanillaOff)).toBe(vanillaOff);
    expect(agentDistroSettingOf(VANILLA_ON)).toBe(VANILLA_ON);
  });

  it("agentsChosen is the absence of a value, and nothing else", () => {
    expect(agentsChosen(null)).toBe(false);
    expect(agentsChosen({ enabled: false, profile: "vanilla" })).toBe(true);
    expect(agentsChosen(VANILLA_ON)).toBe(true);
  });

  it("the switch writes the whole value and keeps the stored profile — the default bundle while nothing is chosen", () => {
    expect(agentDistroChoice({ on: true }, null)).toEqual(VANILLA_ON);
    expect(agentDistroChoice({ on: false }, null)).toEqual({
      enabled: false,
      profile: "vanilla",
    });
    expect(agentDistroChoice({ on: false }, JUSPAY_ON)).toEqual({
      enabled: false,
      profile: JUSPAY_PROFILE,
    });
    expect(
      agentDistroChoice({ on: true }, { enabled: false, profile: "vanilla" }),
    ).toEqual(VANILLA_ON);
  });

  it("a pick writes its profile, trimmed, with agents on — whatever it is; an empty field writes nothing", () => {
    expect(
      agentDistroChoice({ profile: "  github:nobody/nothing " }, VANILLA_ON),
    ).toEqual({ enabled: true, profile: "github:nobody/nothing" });
    expect(agentDistroChoice({ profile: "vanilla" }, null)).toEqual(VANILLA_ON);
    expect(agentDistroChoice({ profile: "   " }, VANILLA_ON)).toBeUndefined();
  });
});

describe("agentsStepHint — the welcome card's line", () => {
  it("the default bundle's agents by name, then what kolu does with them", () => {
    expect(agentsStepHint(LISTING)).toBe(
      "Claude Code and Codex in every new terminal. Kept up to date, nothing to install.",
    );
  });

  it("three or more agents read as a list", () => {
    expect(
      agentsStepHint({
        kind: "available",
        profiles: [
          {
            name: "vanilla",
            description: "",
            harnesses: [
              { name: "claude", title: "Claude Code", version: "1" },
              { name: "codex", title: "Codex", version: "1" },
              { name: "omp", title: "Oh My Pi", version: "1" },
            ],
          },
        ],
      }),
    ).toBe(
      "Claude Code, Codex and Oh My Pi in every new terminal. Kept up to date, nothing to install.",
    );
  });

  it("a bundle with no agents listed says coding agents, never a dangling space", () => {
    expect(
      agentsStepHint({
        kind: "available",
        profiles: [{ name: "vanilla", description: "", harnesses: [] }],
      }),
    ).toBe(
      "Coding agents in every new terminal. Kept up to date, nothing to install.",
    );
  });

  it("says nothing before the listing, or in a kolu built without agents", () => {
    expect(agentsStepHint(undefined)).toBeUndefined();
    expect(agentsStepHint({ kind: "unavailable" })).toBeUndefined();
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

  /** This machine's answer for `profile`: it resolved. */
  const resolvedFor = (profile: string) =>
    ({ kind: "resolved", profile, name: "n", description: "" }) as const;

  it("its done line names the chosen profile BY NAME with a check once it resolves, and there is none while agents are off", () => {
    expect(agentsChosenLabel(VANILLA_ON, LISTING, resolvedFor("vanilla"))).toBe(
      "Agents: Vanilla ✓",
    );
    // A reference is named, never shown: "Agents: Juspay ✓".
    expect(
      agentsChosenLabel(JUSPAY_ON, VANILLA_ONLY, resolvedFor(JUSPAY_PROFILE)),
    ).toBe("Agents: Juspay ✓");
    // One kolu does not name: its own reference is the honest answer.
    expect(
      agentsChosenLabel(
        { enabled: true, profile: "github:me/mine" },
        LISTING,
        resolvedFor("github:me/mine"),
      ),
    ).toBe("Agents: github:me/mine ✓");
    expect(
      agentsChosenLabel(OFF, LISTING, resolvedFor("vanilla")),
    ).toBeUndefined();
  });

  it("no check for a profile that failed to resolve — agent-distro's words instead", () => {
    const ref = "github:nobody/nothing";
    expect(
      agentsChosenLabel({ enabled: true, profile: ref }, LISTING, {
        kind: "failed",
        profile: ref,
        message: `cannot fetch ${ref}: HTTP error 404`,
      }),
    ).toBe(`Agents: ${ref} — cannot fetch ${ref}: HTTP error 404`);
  });

  it("nothing yet while the answer is pending — or is about another profile", () => {
    for (const resolved of [
      undefined,
      { kind: "none" } as const,
      { kind: "pending", profile: JUSPAY_PROFILE } as const,
      resolvedFor("vanilla"),
    ])
      expect(agentsChosenLabel(JUSPAY_ON, LISTING, resolved)).toBeUndefined();
  });

  it("has no done line in a kolu built without agents — nobody chose anything", () => {
    expect(
      agentsChosenLabel(OFF, { kind: "unavailable" }, undefined),
    ).toBeUndefined();
    expect(
      agentsChosenLabel(
        VANILLA_ON,
        { kind: "unavailable" },
        resolvedFor("vanilla"),
      ),
    ).toBeUndefined();
  });
});

/** A fixed "ago" phrase, so a line's words do not hang on the clock. */
const AGO = (at: number) => `@${at}`;

describe("agentFleetSummary — the ONE fleet line in Settings", () => {
  const ready = { kind: "ready", profile: "vanilla", bundle: BUNDLE } as const;
  const host = (
    label: string,
    status: AgentDistroStatus | undefined,
    checking = false,
  ) => ({ label, status, checking, receipt: undefined, ago: AGO });
  /** The groups as the line reads, machines by name. */
  const said = <H extends { label: string }>(
    groups: readonly {
      tone: string;
      lead: string;
      hosts: readonly H[];
      trail: string;
    }[],
  ) =>
    groups.map((g) => ({
      tone: g.tone,
      lead: g.lead,
      hosts: g.hosts.map((h) => h.label),
      trail: g.trail,
    }));

  it("one ready machine: Ready on it, and its last run beside", () => {
    expect(
      said(
        agentFleetSummary([
          {
            ...host("naiveintent", ready),
            receipt: {
              profile: "vanilla",
              bundle: BUNDLE,
              versions: [],
              events: [],
              running: [],
              lastRun: { at: 7, outcome: "updated", by: "updater", words: "w" },
            },
          },
        ]),
      ),
    ).toEqual([
      { tone: "ok", lead: "Ready on", hosts: ["naiveintent"], trail: "" },
      { tone: "muted", lead: "", hosts: [], trail: "updated @7" },
    ]);
  });

  it("one ready machine that has run nothing: the line is just Ready on it", () => {
    expect(said(agentFleetSummary([host("naiveintent", ready)]))).toEqual([
      { tone: "ok", lead: "Ready on", hosts: ["naiveintent"], trail: "" },
    ]);
  });

  it("one group per state, each naming two machines and counting the rest", () => {
    const groups = agentFleetSummary([
      host("naiveintent", ready),
      host("box", ready),
      host("zest", ready),
      host("buildbox", {
        kind: "downloading",
        profile: "vanilla",
        progress: { done: 1.1 * GIB, total: 2 * GIB },
      }),
      host("devbox", {
        kind: "error",
        profile: "vanilla",
        reason: "updater",
        message: "cache not usable",
      }),
    ]);
    expect(said(groups)).toEqual([
      {
        tone: "ok",
        lead: "Ready on",
        hosts: ["naiveintent", "box"],
        trail: "and 1 more",
      },
      { tone: "busy", lead: "", hosts: ["buildbox"], trail: "downloading" },
      { tone: "warn", lead: "", hosts: ["devbox"], trail: "failed" },
    ]);
    // With more than one machine no run is named here: each machine's runs
    // live in its own host details.
    expect(groups.some((g) => g.hosts.length === 0)).toBe(false);
  });

  it("a machine with no agents says why, and two reasons never share a group", () => {
    expect(
      said(
        agentFleetSummary([
          host("naiveintent", { kind: "off" }),
          host("box", undefined),
          host("zest", { kind: "unavailable" }),
          host("ci-2", undefined, true),
        ]),
      ).map(({ hosts, trail }) => ({ hosts, trail })),
    ).toEqual([
      { hosts: ["naiveintent"], trail: "agents off" },
      { hosts: ["box"], trail: "not connected" },
      { hosts: ["zest"], trail: "no coding agents in this build" },
      { hosts: ["ci-2"], trail: "checking…" },
    ]);
  });
});

describe("agentHostDetail — one machine's agents, in its host details", () => {
  const ready = { kind: "ready", profile: "vanilla", bundle: BUNDLE } as const;
  const detail = (
    status: AgentDistroStatus | undefined,
    receipt?: AgentDistroReceipt,
    setting = VANILLA_ON,
  ) =>
    agentHostDetail({
      host: { label: "devbox", status, checking: false, receipt, ago: AGO },
      setting,
      listing: LISTING,
    });

  it("ready: the profile by name with its build, the state, and a check to run", () => {
    expect(detail(ready)).toEqual({
      profile: "Vanilla",
      hash: "nd11nx5f",
      state: { text: "ready", title: "ready", tone: "muted" },
      cause: [],
      events: [],
      action: "check",
    });
  });

  it("ready: the last run joins the state line, and the events are that machine's", () => {
    const d = detail(ready, {
      profile: "vanilla",
      bundle: BUNDLE,
      versions: [],
      running: [],
      lastRun: { at: 3, outcome: "updated", by: "updater", words: "C 1 → 2" },
      events: [
        {
          at: "1970-01-01T00:00:00.003Z",
          profile: "vanilla",
          kind: "updated",
          words: "C 1 → 2",
        },
      ],
    });
    expect(d?.state.text).toBe("ready · updated @3");
    expect(d?.events).toEqual([
      {
        when: "@3",
        kind: "updated",
        text: "C 1 → 2",
        title: "updated — agent-distro's updater: C 1 → 2",
        tone: "muted",
      },
    ]);
  });

  it("a run in flight says so, and offers no check while it runs", () => {
    expect(detail({ ...ready, update: {} })?.state.text).toBe(
      `ready · ${AGENTS_UPDATE_CHECKING}`,
    );
    expect(detail({ ...ready, update: {} })?.action).toBeUndefined();
    expect(
      detail({
        ...ready,
        update: { progress: { done: 1.1 * GIB, total: 2 * GIB } },
      })?.state.text,
    ).toBe("ready · updating · 1.1 GiB of 2.0 GiB");
  });

  it("failed: the cause in agent-distro's words, what it means there, and a retry", () => {
    expect(
      detail({
        kind: "error",
        profile: "vanilla",
        reason: "nixMissing",
        message: "nix is not on padi's PATH",
      }),
    ).toEqual({
      profile: "Vanilla",
      state: {
        text: "download failed",
        title: "nix is not on padi's PATH",
        tone: "warn",
      },
      cause: ["nix is not on padi's PATH", agentFailureRemedy("nixMissing")],
      means: "New terminals on devbox get no coding agents until this is fixed.",
      events: [],
      action: "retry",
    });
  });

  it("downloading and off say what they are, with nothing to do from here", () => {
    expect(
      detail({
        kind: "downloading",
        profile: "vanilla",
        progress: { done: 1.1 * GIB, total: 2 * GIB },
      }),
    ).toMatchObject({
      state: { text: "downloading · 1.1 GiB of 2.0 GiB" },
      action: undefined,
    });
    expect(detail({ kind: "off" })).toMatchObject({
      state: { text: "agents off" },
      action: undefined,
    });
  });

  it("a padi without agents, or a machine we cannot hear from, has no section", () => {
    expect(detail({ kind: "unavailable" })).toBeUndefined();
    expect(detail(undefined)).toBeUndefined();
  });

  it("names the SETTING's profile even before the machine catches up", () => {
    expect(detail({ kind: "off" }, undefined, JUSPAY_ON)?.profile).toBe(
      "Juspay",
    );
  });

  it("a history that would not read is one event saying so, in padi's words", () => {
    expect(
      detail(ready, {
        profile: "vanilla",
        bundle: BUNDLE,
        versions: [],
        running: [],
        events: [],
        error: "the history file is not a history",
      })?.events,
    ).toEqual([
      {
        when: "",
        kind: "unreadable",
        text: AGENTS_RECEIPT_UNREADABLE,
        title: `${AGENTS_RECEIPT_UNREADABLE} — padi: the history file is not a history`,
        tone: "warn",
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

  it("a reference switch on the same bundle is stale: its AI_PROFILE changed", () => {
    expect(
      agentStalenessOf({
        terminal: { agents: { profile: "github:a/p", bundle: OLD } },
        status: ready("github:b/p", OLD),
        setting: on("github:b/p"),
      }),
    ).toEqual({
      kind: "stale",
      had: { profile: "github:a/p", hash: "nd11nx5f" },
      now: { kind: "profile", profile: "github:b/p", hash: "nd11nx5f" },
    });
    expect(
      agentStalenessOf({
        terminal: { agents: { profile: "github:a/p", bundle: OLD } },
        status: ready("github:a/p", OLD),
        setting: on("github:a/p"),
      }),
    ).toEqual({ kind: "current" });
  });

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

describe("selectedAgentProfile — the bundle the setting rides", () => {
  it("a shipped bundle's name is its own; anything else rides vanilla", () => {
    for (const profile of [JUSPAY_PROFILE, "~/p", "ekala"])
      expect(
        selectedAgentProfile({ enabled: true, profile }, LISTING)?.name,
      ).toBe("vanilla");
    expect(
      selectedAgentProfile({ enabled: true, profile: "juspay" }, LISTING)?.name,
    ).toBe("juspay");
    expect(
      selectedAgentProfile({ enabled: false, profile: "juspay" }, LISTING),
    ).toBeUndefined();
  });
});

describe("the tile pill's name", () => {
  it("the pill names the profile in effect, else the setting's", () => {
    const bundle = READY_BUNDLE;
    expect(agentChipProfile({ profile: "github:me/p", bundle })).toBe(
      "github:me/p",
    );
    expect(
      agentChipProfile({
        profile: "github:me/p",
        bundle,
        effective: {
          name: "mine",
          description: "",
          origin: "github:me/p",
        },
      }),
    ).toBe("mine");
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
      agentChipLabel({
        profile: "vanilla",
        bundle:
          "/nix/store/nd11nx5f1dkf02cr9dhxqq4axg23vzgc-agent-distro-vanilla",
      }),
    ).toBe(
      "This terminal started with the vanilla coding agents (nd11nx5f). Click to choose what new terminals get.",
    );
    expect(
      agentChipLabel({
        profile: "github:me/profile",
        bundle:
          "/nix/store/nd11nx5f1dkf02cr9dhxqq4axg23vzgc-agent-distro-vanilla",
        effective: {
          name: "ekala",
          description: "Ekala's agents",
          origin: "/home/me/ekala/agent-distro.nix",
        },
      }),
    ).toBe(
      "This terminal started with the ekala profile (nd11nx5f), from /home/me/ekala/agent-distro.nix. Click to choose what new terminals get.",
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
    expect(agentToast.on(JUSPAY_PROFILE)).toBe(
      "New terminals get the github:juspay/skills profile",
    );
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
  it("a failure with nix's own line: the toast's title is the cause and nix's line, on one line", () => {
    const message =
      "cannot resolve flake: unable to download 'https://api.github.com/repos/o/r/commits/HEAD': HTTP error 401";
    const words = agentMarkWords(
      { kind: "failed", reason: "updater", message },
      "nix-infra@idli-01",
    );
    expect(words).toEqual({
      title: `The coding agents could not be downloaded to nix-infra@idli-01: ${message}`,
      detail: [AGENTS_RETRY],
    });
  });
  it("the hover, the toast and the machine's own section say the same words", () => {
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
    // The machine's own host-details section: the cause and the remedy, with
    // the retry its BUTTON rather than a sentence.
    const detail = agentHostDetail({
      host: {
        label: "box",
        status: { kind: "error", profile: "vanilla", ...failure },
        checking: false,
        receipt: undefined,
        ago: AGO,
      },
      setting: VANILLA_ON,
      listing: LISTING,
    });
    expect(detail?.cause).toEqual([failure.message, lines[1]]);
    expect(lines.at(-1)).toBe(AGENTS_RETRY);
    expect(detail?.action).toBe("retry");
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

  it("a ready machine's state line says its last run, in its own outcome's words", () => {
    const state = (r: AgentDistroReceipt) =>
      agentHostDetail({
        host: host(ready, r),
        setting: VANILLA_ON,
        listing: LISTING,
      })?.state;
    expect(
      state(
        receipt({
          lastRun: { at: 1, outcome: "updated", words: "x", by: "updater" },
        }),
      ),
    ).toEqual({
      text: "ready · updated @1",
      title: "updated @1 — agent-distro's updater: x",
      tone: "muted",
    });
    expect(
      state(
        receipt({
          lastRun: { at: 2, outcome: "unchanged", words: "", by: "updater" },
        }),
      ),
    ).toEqual({
      text: "ready · checked @2, up to date",
      title: "checked @2, up to date",
      tone: "muted",
    });
    // A skip claims no cause: the reason rides in the hover, with its author.
    const reason =
      "cache https://cache.example not usable; add it to nix.settings substituters/trusted-public-keys";
    expect(
      state(
        receipt({
          lastRun: { at: 3, outcome: "skipped", words: reason, by: "updater" },
        }),
      ),
    ).toEqual({
      text: "ready · checked @3, skipped",
      title: `checked @3, skipped — agent-distro's updater: ${reason}`,
      tone: "muted",
    });
    // padi's own words are labelled padi's, never the updater's.
    expect(
      state(
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
      text: "ready · last update failed @4",
      title:
        "last update failed @4 — padi: the updater exited 3 without a result: TypeError: boom",
      tone: "warn",
    });
    // Files that would not read say so on the line.
    expect(state(receipt({ error: "history line is not …" }))).toEqual({
      text: `ready · ${AGENTS_RECEIPT_UNREADABLE}`,
      title: `${AGENTS_RECEIPT_UNREADABLE} — padi: history line is not …`,
      tone: "warn",
    });
    // A receipt for another profile is one padi has not caught up from.
    expect(
      state({
        ...receipt({
          lastRun: { at: 1, outcome: "updated", words: "x", by: "updater" },
        }),
        profile: "juspay",
      })?.text,
    ).toBe("ready");
  });

  it("a machine's events are its own, in the updater's words, warn for a failure", () => {
    expect(
      agentHostDetail({
        host: host(
          ready,
          receipt({
            events: [
              {
                at: "2026-10-08T02:00:05Z",
                profile: "vanilla",
                kind: "updated",
                words: "Claude Code 2.1.286 → 2.1.291",
              },
              {
                at: "2026-10-08T02:00:09Z",
                profile: "vanilla",
                kind: "failed",
                words: "nix build exit 1",
              },
            ],
          }),
        ),
        setting: VANILLA_ON,
        listing: LISTING,
      })?.events,
    ).toEqual([
      {
        when: `@${Date.parse("2026-10-08T02:00:05Z")}`,
        kind: "updated",
        text: "Claude Code 2.1.286 → 2.1.291",
        title:
          "updated — agent-distro's updater: Claude Code 2.1.286 → 2.1.291",
        tone: "muted",
      },
      {
        when: `@${Date.parse("2026-10-08T02:00:09Z")}`,
        kind: "failed",
        text: "nix build exit 1",
        title: "failed — agent-distro's updater: nix build exit 1",
        tone: "warn",
      },
    ]);
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
    // A disconnected host's last-known ready cannot answer.
    expect(agentHostCheckable({ connected: true, status: ready })).toBe(true);
    expect(agentHostCheckable({ connected: false, status: ready })).toBe(false);
    expect(agentHostCheckable({ connected: true, status: checking })).toBe(
      false,
    );
    // The fleet-wide check is a palette command now: its words, and the note
    // that says it asks every machine.
    expect(AGENTS_CHECK_NOW.label).toBe("Check for newer coding agents");
    expect(AGENTS_CHECK_NOW.note).toBe("every machine");
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

  it("the chips name this machine's versions once it has them", () => {
    const chips = (localReceipt: AgentDistroReceipt) =>
      agentChips({ listing: LISTING, setting: VANILLA_ON, localReceipt });
    expect(
      chips(
        receipt({
          versions: [
            { name: "claude", title: "Claude Code", version: "2.1.299" },
          ],
        }),
      ),
    ).toEqual([{ title: "Claude Code", version: "2.1.299" }]);
    // A bundle with no versions file names none — never the floor's.
    expect(chips(receipt({}))).toEqual([]);
    // Another profile's receipt (not caught up yet): the set kolu ships.
    expect(chips({ ...receipt({}), profile: "juspay" })).toEqual([
      { title: "Claude Code", version: "2.1.291" },
      { title: "Codex", version: "0.160.1" },
    ]);
  });
});
