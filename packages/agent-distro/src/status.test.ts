import { describe, expect, it } from "vitest";
import { agentBundleShortHash } from "./bundle.ts";
import { type AgentDistroListing, profileOfBundle } from "./listing.ts";
import { lastRunOf, recentEvents } from "./history.ts";
import type { AgentDistroReceipt, AgentDistroStatus } from "./schema.ts";
import {
  AGENTS_CUSTOM,
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
  AGENTS_CHECK_NOW,
  AGENTS_RECEIPT_UNREADABLE,
  AGENTS_UPDATE_DOWNLOADING,
  agentsStepHint,
  agentDistroChoice,
  agentDistroSettingOf,
  agentsChosen,
  agentsChosenLabel,
  firstRunAgentsDone,
  AGENTS_DELIVERY_AGAIN,
  AGENTS_REFUSED_FIX,
  AGENTS_REFUSED_MEANS,
  AGENTS_BINDER_REFUSED_FIX,
  AGENTS_BINDER_REFUSED_MEANS,
  agentFailureLines,
  agentFailureRemedy,
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
  landedFacts,
  updateLanded,
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
      {
        kind: "ready",
        profile: "vanilla",
        bundle: READY_BUNDLE,
        delivering: false,
      },
      {
        kind: "ready",
        profile: "vanilla",
        hash: "nd11nx5f",
        delivering: false,
      },
    ],
    [
      "ready, delivering a newer set",
      {
        kind: "ready",
        profile: "vanilla",
        bundle: READY_BUNDLE,
        delivering: true,
      },
      {
        kind: "ready",
        profile: "vanilla",
        hash: "nd11nx5f",
        delivering: true,
      },
    ],
    [
      "undelivered: no mark, nothing turning",
      { kind: "undelivered", profile: "vanilla" },
      { kind: "none", why: "undelivered" },
    ],
    [
      "downloading",
      { kind: "downloading", profile: "vanilla" },
      { kind: "downloading" },
    ],
    [
      "error",
      {
        kind: "error",
        profile: "vanilla",
        reason: "delivery",
        message: "cache not usable",
      },
      { kind: "failed", reason: "delivery", message: "cache not usable" },
    ],
  ];
  for (const [name, status, mark] of cases)
    it(name, () => expect(agentMarkOf(status, false)).toEqual(mark));

  it("checking wins until the first frame — derived on the client, no server state", () => {
    expect(agentMarkOf(undefined, true)).toEqual({ kind: "checking" });
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
        {
          kind: "ready",
          profile: "vanilla",
          hash: "8rcmf6rd",
          delivering: false,
        },
        "box",
      ),
    ).toBe(
      "Coding agents ready on box: vanilla (8rcmf6rd) — new terminals on box start with them",
    );
    expect(
      agentMarkLabel(
        {
          kind: "ready",
          profile: "vanilla",
          hash: "8rcmf6rd",
          delivering: true,
        },
        "box",
      ),
    ).toBe(
      `Coding agents ready on box: vanilla (8rcmf6rd) — new terminals on box start with them\n${AGENTS_UPDATE_DOWNLOADING}`,
    );
    expect(agentMarkLabel({ kind: "downloading" }, "naiveintent")).toBe(
      "Delivering the coding agents to naiveintent…",
    );
    expect(
      agentMarkLabel(
        { kind: "failed", reason: "delivery", message: "nix missing" },
        "box",
      ),
    ).toBe(
      `The coding agents could not be delivered to box: nix missing\n${AGENTS_DELIVERY_AGAIN}`,
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
/** A build that ships more than one bundle — kolu's pin ships only
 *  `vanilla`, but the fold must order and name whatever it is handed. */
const LISTING: AgentDistroListing = {
  kind: "available",
  profiles: [
    VANILLA_PROFILE,
    { name: "ekala", description: "Ekala's skills", harnesses: [] },
  ],
};
/** What kolu ships at its pin: ONE bundle, `vanilla`. Juspay's set is the
 *  reference kolu names itself. */
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

  it("the build's bundle, then Juspay's reference under its name, then Custom…", () => {
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

  it("a build that ships several leads with the default, and Juspay's card still follows them", () => {
    expect(agentProfileCards(LISTING).map((c) => [c.profile, c.title])).toEqual(
      [
        ["vanilla", "Vanilla"],
        ["ekala", "Ekala"],
        [JUSPAY_PROFILE, "Juspay"],
        [undefined, AGENTS_CUSTOM.title],
      ],
    );
  });

  it("has no cards until the listing arrives, or in a kolu built without agents", () => {
    expect(agentProfileCards(undefined)).toEqual([]);
    expect(agentProfileCards({ kind: "unavailable" })).toEqual([]);
  });

  it("a reference of the user's own selects Custom… — or the default card in a list without one", () => {
    const settings = agentProfileCards(VANILLA_ONLY);
    expect(agentSelectedCard(VANILLA_ON, settings)?.profile).toBe("vanilla");
    expect(agentSelectedCard(JUSPAY_ON, settings)?.profile).toBe(
      JUSPAY_PROFILE,
    );
    expect(
      agentSelectedCard(
        { enabled: true, profile: "github:me/mine" },
        agentProfileCards(LISTING),
      )?.title,
    ).toBe(AGENTS_CUSTOM.title);
    // The welcome step's picker offers no Custom… card, so a reference there
    // selects the default one — there is always something to turn on.
    const welcome = settings.filter((c) => c.profile !== undefined);
    expect(
      agentSelectedCard({ enabled: true, profile: "github:me/mine" }, welcome)
        ?.profile,
    ).toBe("vanilla");
    expect(agentSelectedCard(VANILLA_ON, [])).toBeUndefined();
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
  it("off: the SETTING's bundle, by name with no version — nothing is installed", () => {
    expect(
      agentChips({
        setting: { enabled: false, profile: "vanilla" },
        listing: LISTING,
        localReceipt: undefined,
      }),
    ).toEqual([{ title: "Claude Code" }, { title: "Codex" }]);
    // The switch words the chips; it never changes WHICH bundle they are —
    // turning on would start `ekala`'s agents, so off names those.
    expect(
      agentChips({
        setting: { enabled: false, profile: "ekala" },
        listing: LISTING,
        localReceipt: undefined,
      }),
    ).toEqual([]);
    // A reference rides the default bundle, on or off alike.
    expect(
      agentChips({
        setting: { enabled: false, profile: JUSPAY_PROFILE },
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
        },
      }),
    ).toEqual([{ title: "Claude Code", version: "3.0.0" }]);
  });

  it("a bundle with no agents listed names none", () => {
    expect(
      agentChips({
        setting: { enabled: true, profile: "ekala" },
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
    undelivered: { kind: "undelivered", profile: "vanilla" },
    downloading: { kind: "downloading", profile: "vanilla" },
    ready: {
      kind: "ready",
      profile: "vanilla",
      bundle: BUNDLE,
      delivering: false,
    },
    error: {
      kind: "error",
      profile: "vanilla",
      reason: "delivery",
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
      undelivered: false,
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

  it("names the profile at once while the answer is pending — the check follows it", () => {
    expect(agentsChosenLabel(VANILLA_ON, LISTING, undefined)).toBe(
      "Agents: Vanilla",
    );
    // An answer about another profile is one padi has not caught up from.
    for (const resolved of [
      undefined,
      { kind: "none" } as const,
      { kind: "pending", profile: JUSPAY_PROFILE } as const,
      resolvedFor("vanilla"),
    ])
      expect(agentsChosenLabel(JUSPAY_ON, LISTING, resolved)).toBe(
        "Agents: Juspay",
      );
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
  const ready = {
    kind: "ready",
    profile: "vanilla",
    bundle: BUNDLE,
    delivering: false,
  } as const;
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

  it("one ready machine: Ready on it — and nothing of its own beside", () => {
    expect(said(agentFleetSummary([host("naiveintent", ready)]))).toEqual([
      { tone: "ok", lead: "Ready on", hosts: ["naiveintent"], trail: "" },
    ]);
  });

  it("one group per state, each naming two machines and counting the rest", () => {
    const groups = agentFleetSummary([
      host("naiveintent", ready),
      host("box", ready),
      host("zest", ready),
      host("buildbox", { kind: "downloading", profile: "vanilla" }),
      host("devbox", {
        kind: "error",
        profile: "vanilla",
        reason: "delivery",
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
      { tone: "busy", lead: "", hosts: ["buildbox"], trail: "delivering" },
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
  const ready = {
    kind: "ready",
    profile: "vanilla",
    bundle: BUNDLE,
    delivering: false,
  } as const;
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
      hasFix: false,
      events: [],
      canCheck: true,
    });
  });

  it("undelivered: the profile and a still state line, and no check to run", () => {
    expect(detail({ kind: "undelivered", profile: "vanilla" })).toEqual({
      profile: "Vanilla",
      state: {
        text: "no coding agents delivered",
        title: "no coding agents delivered",
        tone: "muted",
      },
      cause: [],
      hasFix: false,
      events: [],
      canCheck: false,
    });
  });

  it("ready: the last run joins the state line, and the events are that machine's", () => {
    const d = detail(ready, {
      profile: "vanilla",
      bundle: BUNDLE,
      versions: [],
      lastRun: { at: 3, outcome: "updated", by: "log", words: "C 1 → 2" },
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
        title: "updated — the host's update log: C 1 → 2",
        tone: "muted",
      },
    ]);
  });

  it("a delivery in flight says so, and offers no check while it runs", () => {
    const d = detail({ ...ready, delivering: true });
    expect(d?.state.text).toBe("ready · delivering newer agents…");
    expect(d?.canCheck).toBe(false);
  });

  it("failed: the cause in kolu-server's words, what it means there, and a check to try again", () => {
    expect(
      detail({
        kind: "error",
        profile: "vanilla",
        reason: "delivery",
        message: "the cache does not hold this bundle",
      }),
    ).toEqual({
      profile: "Vanilla",
      state: {
        text: "delivery failed",
        title: "the cache does not hold this bundle",
        tone: "warn",
      },
      cause: ["the cache does not hold this bundle"],
      // Nothing to fix in a machine's Nix settings: no docs link.
      hasFix: false,
      means: `New terminals on devbox get no coding agents until this is fixed. ${AGENTS_DELIVERY_AGAIN}`,
      events: [],
      canCheck: true,
    });
  });

  it("refused: names the host's Nix, with what it means and the fix", () => {
    const d = detail({
      kind: "error",
      profile: "vanilla",
      reason: "refused",
      message: "cannot add path because it lacks a signature by a trusted key",
    });
    expect(d?.state.text).toBe("refused by its Nix");
    expect(d?.cause).toEqual([
      "cannot add path because it lacks a signature by a trusted key",
      AGENTS_REFUSED_MEANS,
      AGENTS_REFUSED_FIX,
    ]);
    expect(d?.hasFix).toBe(true);
    expect(d?.canCheck).toBe(true);
  });

  it("binderRefused: names kolu's own Nix, with what it means and the fix there", () => {
    const d = detail({
      kind: "error",
      profile: "vanilla",
      reason: "binderRefused",
      message: "cannot add path because it lacks a signature by a trusted key",
    });
    expect(d?.state.text).toBe("refused by kolu's own Nix");
    expect(d?.cause).toEqual([
      "cannot add path because it lacks a signature by a trusted key",
      AGENTS_BINDER_REFUSED_MEANS,
      AGENTS_BINDER_REFUSED_FIX,
    ]);
    expect(d?.hasFix).toBe(true);
    expect(d?.canCheck).toBe(true);
  });

  it("delivering and off say what they are, with nothing to do from here", () => {
    expect(detail({ kind: "downloading", profile: "vanilla" })).toMatchObject({
      state: { text: "delivering…" },
      canCheck: false,
    });
    expect(detail({ kind: "off" })).toMatchObject({
      state: { text: "agents off" },
      canCheck: false,
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
    ({ kind: "ready", profile, bundle, delivering: false }) as const;

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
          reason: "delivery",
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
          reason: "delivery",
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
  it("the new profile still being delivered: says so, no Restart yet", () => {
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
      "This terminal has the vanilla coding agents (nd11nx5f). New terminals get juspay, which is still being delivered to naiveintent; Restart appears once it is ready.",
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
      "This terminal has the vanilla coding agents (nd11nx5f). vanilla could not be delivered to naiveintent, so new terminals get no coding agents; Restart appears once it is ready.",
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

describe("updateLanded — the moment a delivery is worth the updated toast", () => {
  const ready = (bundle: string, profile = "vanilla") =>
    landedFacts({ kind: "ready", profile, bundle, delivering: false });

  it("a new bundle of the SAME profile on a ready host is an update", () => {
    expect(updateLanded(ready("/a"), ready("/b"))).toBe(true);
    expect(updateLanded(ready("/a"), ready("/a"))).toBe(false);
  });
  it("a first delivery, a profile switch, or a host going off is not", () => {
    expect(updateLanded(undefined, ready("/a"))).toBe(false);
    expect(updateLanded(ready("/a"), ready("/b", "juspay"))).toBe(false);
    expect(updateLanded(ready("/a"), landedFacts({ kind: "off" }))).toBe(false);
  });
  it("reads its facts off a ready status, by value — an update in flight changes nothing", () => {
    expect(
      landedFacts({
        kind: "ready",
        profile: "vanilla",
        bundle: "/a",
        delivering: true,
      }),
    ).toEqual({ profile: "vanilla", bundle: "/a" });
    expect(
      landedFacts({ kind: "downloading", profile: "vanilla" }),
    ).toBeUndefined();
    expect(landedFacts(undefined)).toBeUndefined();
  });
});

describe("a failure's words: cause, then remedy (by reason), then when kolu tries again — each once", () => {
  const REFUSED =
    "cannot add path '/nix/store/x' because it lacks a signature by a trusted key";

  it("refused carries what it means and the host-side fix; try-again appears exactly once", () => {
    const lines = (
      agentMarkLabel(
        { kind: "failed", reason: "refused", message: REFUSED },
        "box",
      ) ?? ""
    ).split("\n");
    expect(lines).toEqual([
      `The coding agents could not be delivered to box: ${REFUSED}`,
      AGENTS_REFUSED_MEANS,
      AGENTS_REFUSED_FIX,
      AGENTS_DELIVERY_AGAIN,
    ]);
  });
  it("a delivery failure is its own words, then when kolu tries again", () => {
    expect(agentFailureRemedy("delivery")).toEqual([]);
    expect(
      agentFailureLines(
        { reason: "delivery", message: "cache not usable" },
        "box",
      ),
    ).toEqual([
      "The coding agents could not be delivered to box: cache not usable",
      AGENTS_DELIVERY_AGAIN,
    ]);
  });
  it("the hover and the machine's own section say the same words", () => {
    const failure = { reason: "refused", message: REFUSED } as const;
    const lines = agentFailureLines(failure, "box");
    const mark = { kind: "failed", ...failure } as const;
    // Hover / accessible name.
    expect(agentMarkLabel(mark, "box")).toBe(lines.join("\n"));
    // The machine's own host-details section: the cause and the remedy, with
    // trying again its check BUTTON beside the one sentence of when.
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
    expect(detail?.cause).toEqual([failure.message, ...lines.slice(1, -1)]);
    expect(detail?.means?.endsWith(AGENTS_DELIVERY_AGAIN)).toBe(true);
    expect(detail?.canCheck).toBe(true);
  });
  it("binderRefused carries what it means and the fix on the machine running kolu", () => {
    expect(agentFailureRemedy("binderRefused")).toEqual([
      AGENTS_BINDER_REFUSED_MEANS,
      AGENTS_BINDER_REFUSED_FIX,
    ]);
    expect(
      agentFailureLines({ reason: "binderRefused", message: REFUSED }, "box"),
    ).toEqual([
      `The coding agents could not be delivered to box: ${REFUSED}`,
      AGENTS_BINDER_REFUSED_MEANS,
      AGENTS_BINDER_REFUSED_FIX,
      AGENTS_DELIVERY_AGAIN,
    ]);
  });
});

describe("K3 — updates while a bundle serves", () => {
  const ready = {
    kind: "ready",
    profile: "vanilla",
    bundle: BUNDLE,
    delivering: false,
  } as const;
  const delivering = { ...ready, delivering: true } as const;
  const receipt = (over: Partial<AgentDistroReceipt>): AgentDistroReceipt => ({
    profile: "vanilla",
    versions: [],
    events: [],
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

  it("the mark stays ready while a newer set is delivered, and says so", () => {
    const mark = agentMarkOf(delivering, false);
    expect(mark).toEqual({
      kind: "ready",
      profile: "vanilla",
      hash: "nd11nx5f",
      delivering: true,
    });
    expect(agentMarkLabel(mark, "box")?.split("\n").slice(1)).toEqual([
      AGENTS_UPDATE_DOWNLOADING,
    ]);
    expect(agentMarkLabel(agentMarkOf(ready, false), "box")).not.toContain(
      "\n",
    );
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
          lastRun: { at: 1, outcome: "updated", words: "x", by: "log" },
        }),
      ),
    ).toEqual({
      text: "ready · updated @1",
      title: "updated @1 — the host's update log: x",
      tone: "muted",
    });
    expect(
      state(
        receipt({
          lastRun: { at: 2, outcome: "unchanged", words: "", by: "log" },
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
          lastRun: {
            at: 3,
            outcome: "skipped",
            words: reason,
            by: "agent-distro",
          },
        }),
      ),
    ).toEqual({
      text: "ready · checked @3, skipped",
      title: `checked @3, skipped — agent-distro's updater: ${reason}`,
      tone: "muted",
    });
    // padi's own words are labelled padi's, never the delivery's.
    expect(
      state(
        receipt({
          lastRun: {
            at: 4,
            outcome: "failed",
            words: "the delivered bundle is not in the store",
            by: "padi",
          },
        }),
      ),
    ).toEqual({
      text: "ready · last update failed @4",
      title:
        "last update failed @4 — padi: the delivered bundle is not in the store",
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
          lastRun: { at: 1, outcome: "updated", words: "x", by: "delivery" },
        }),
        profile: "juspay",
      })?.text,
    ).toBe("ready");
  });

  it("a mixed history log names each line's writer by what it says, never kolu's delivery", () => {
    // One shared log: padi's `updated:` line for a delivery that landed, then
    // agent-distro's own updater (its Home Manager module) failing and
    // skipping. Only the updater writes `failed:`/`skipped:`; an `updated:`
    // line may be either's, so it is the log's.
    const log = [
      "2026-10-08T02:00:05+00:00 vanilla updated: Claude Code 2.1.286 → 2.1.291",
      "2026-10-08T02:00:09+00:00 vanilla failed: nix build exit 1",
      "2026-10-08T08:00:03+00:00 vanilla skipped: cache https://cache.example not usable",
    ].join("\n");
    const events = recentEvents(log, "vanilla");
    const detail = agentHostDetail({
      host: host(ready, receipt({ events, lastRun: lastRunOf(events, null) })),
      setting: VANILLA_ON,
      listing: LISTING,
    });
    expect(detail?.state?.title).toBe(
      `checked @${Date.parse("2026-10-08T08:00:03Z")}, skipped — agent-distro's updater: cache https://cache.example not usable`,
    );
    expect(detail?.events.map((e) => [e.title, e.tone])).toEqual([
      [
        "skipped — agent-distro's updater: cache https://cache.example not usable",
        "muted",
      ],
      ["failed — agent-distro's updater: nix build exit 1", "warn"],
      [
        "updated — the host's update log: Claude Code 2.1.286 → 2.1.291",
        "muted",
      ],
    ]);
  });

  it("the update toast quotes the history and names the machine", () => {
    // The machine by its name — the host tab's — never "this machine".
    expect(
      agentToast.updated("naiveintent", "Claude Code 2.1.286 → 2.1.291"),
    ).toEqual({
      title: "Coding agents updated on naiveintent",
      description:
        "Claude Code 2.1.286 → 2.1.291 — new terminals on naiveintent start with them; open ones offer Restart.",
    });
  });

  it("Check now: the palette command's words", () => {
    // The fleet-wide check is a palette command now: its words, and the note
    // that says it asks every machine.
    expect(AGENTS_CHECK_NOW.label).toBe("Check for newer coding agents");
    expect(AGENTS_CHECK_NOW.note).toBe("every machine");
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
