import { GIB, MIB } from "@kolu/byte-units";
import { describe, expect, it } from "vitest";
import { agentBundleShortHash } from "./bundle.ts";
import { type AgentDistroListing, profileOfBundle } from "./listing.ts";
import type { AgentDistroReceipt, AgentDistroStatus } from "./schema.ts";
import {
  AGENTS_REPO_OVERRIDES,
  agentChipProfile,
  agentsProfileNotes,
  agentsResolvedLine,
  JUSPAY_PROFILE,
  profileSuggestions,
  RECENT_PROFILES_CAP,
  rememberProfile,
  selectedAgentProfile,
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
  agentStatusLines,
  agentToast,
  AGENTS_OFF_MEANS,
  agentsHint,
  downloadBytes,
  downloadEdge,
  downloadEdgeFacts,
  harnessLine,
  restartedLabel,
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
    const notes = (localReceipt: AgentDistroReceipt | undefined) =>
      agentsProfileNotes({ setting: VANILLA_ON, listing, localReceipt });
    // …and what it shows once the receipt is in (padi's read of the same file).
    const receipt: AgentDistroReceipt = {
      profile: "vanilla",
      bundle: "/s/v",
      versions: [...parseVersions(read(versionsFile("/s/v")))],
      events: [],
      running: [],
    };
    expect(notes(receipt)).toEqual(notes(undefined));
    expect(notes(undefined)).toEqual([
      "Claude Code 2.1.292 · OpenCode 1.18.35",
      AGENTS_REPO_OVERRIDES,
    ]);
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
const JUSPAY_ON = { enabled: true, profile: JUSPAY_PROFILE };
/** The opening both Agents hints share, as the reader sees it — typed once here
 *  so a reworded lead fails every test that pins it. */
const BARE_LEAD =
  "Kolu can bring AI coding agents along — kept up to date, nothing to install:";
const BUNDLE =
  "/nix/store/nd11nx5f1dkf02cr9dhxqq4axg23vzgc-agent-distro-vanilla";

describe("agentsHint — the row's words while agents are off", () => {
  const base = { listing: LISTING };

  it("off: what kolu can bring, which agents (the default bundle's, from the listing), what on and off do", () => {
    expect(
      agentsHint({ ...base, stored: { enabled: false, profile: "vanilla" } }),
    ).toEqual({
      tone: "muted",
      text: [
        BARE_LEAD,
        "Claude Code 2.1.291 · Codex 0.160.1",
        "Turn it on and new terminals start with those agents; what you installed yourself stays as a fallback.",
        `Off — ${AGENTS_OFF_MEANS}`,
      ].join("\n"),
    });
  });

  it("on: nothing — the profile field and its lines speak", () => {
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

describe("agentsProfileNotes — the lines under the profile field", () => {
  it("a reference: the agents of the bundle it rides, then that a repository overrides it", () => {
    expect(
      agentsProfileNotes({
        setting: JUSPAY_ON,
        listing: LISTING,
        localReceipt: undefined,
      }),
    ).toEqual(["Claude Code 2.1.291 · Codex 0.160.1", AGENTS_REPO_OVERRIDES]);
  });

  it("this machine's receipt names its own versions once it is in", () => {
    expect(
      agentsProfileNotes({
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
    ).toEqual(["Claude Code 3.0.0", AGENTS_REPO_OVERRIDES]);
  });

  it("a bundle with no agents listed names none, never an empty line", () => {
    expect(
      agentsProfileNotes({
        setting: { enabled: true, profile: "juspay" },
        listing: LISTING,
        localReceipt: undefined,
      }),
    ).toEqual([AGENTS_REPO_OVERRIDES]);
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

describe("the profile field's suggestions and memory", () => {
  it("suggests Juspay's profile first, then every shipped bundle, then what was set before", () => {
    expect(
      profileSuggestions({
        listing: LISTING,
        recent: ["github:ekala-project/ekala-ai-skills", JUSPAY_PROFILE],
      }),
    ).toEqual([
      { value: JUSPAY_PROFILE, note: "Juspay's profile — the default" },
      { value: "vanilla", note: "Upstream harnesses with your own provider" },
      { value: "juspay", note: "Juspay skills + Kolu" },
      { value: "github:ekala-project/ekala-ai-skills", note: "used before" },
    ]);
    expect(profileSuggestions({ listing: undefined, recent: [] })).toEqual([
      { value: JUSPAY_PROFILE, note: "Juspay's profile — the default" },
    ]);
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
  it("agentDistroSettingOf: null is off on Juspay's profile; a value is itself", () => {
    expect(agentDistroSettingOf(null)).toEqual({
      enabled: false,
      profile: JUSPAY_PROFILE,
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

  it("the switch writes the whole value and keeps the stored profile — Juspay's while nothing is chosen", () => {
    expect(agentDistroChoice({ on: true }, null)).toEqual(JUSPAY_ON);
    expect(agentDistroChoice({ on: false }, null)).toEqual({
      enabled: false,
      profile: JUSPAY_PROFILE,
    });
    expect(agentDistroChoice({ on: false }, VANILLA_ON)).toEqual({
      enabled: false,
      profile: "vanilla",
    });
    expect(
      agentDistroChoice({ on: true }, { enabled: false, profile: "vanilla" }),
    ).toEqual(VANILLA_ON);
  });

  it("the field writes its text, trimmed, with agents on — whatever it is; an empty field writes nothing", () => {
    expect(
      agentDistroChoice({ profile: "  github:nobody/nothing " }, VANILLA_ON),
    ).toEqual({ enabled: true, profile: "github:nobody/nothing" });
    expect(agentDistroChoice({ profile: "vanilla" }, null)).toEqual(VANILLA_ON);
    expect(agentDistroChoice({ profile: "   " }, VANILLA_ON)).toBeUndefined();
  });
});

describe("agentsStepHint — the welcome card's line", () => {
  it("the lead with the default bundle's agents on one line", () => {
    expect(agentsStepHint(LISTING)).toBe(
      `${BARE_LEAD} Claude Code 2.1.291 · Codex 0.160.1`,
    );
  });

  it("a bundle with no agents listed leaves the lead bare, never a dangling space", () => {
    expect(
      agentsStepHint({
        kind: "available",
        profiles: [{ name: "vanilla", description: "", harnesses: [] }],
      }),
    ).toBe(BARE_LEAD);
  });

  it("shares its lead with the Settings hint", () => {
    const settings = agentsHint({ listing: LISTING, stored: null })?.text ?? "";
    expect(settings.startsWith(BARE_LEAD)).toBe(true);
    expect(agentsStepHint(LISTING)?.startsWith(BARE_LEAD)).toBe(true);
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

  it("its done line names the chosen profile with a check once it resolves, and there is none while agents are off", () => {
    expect(agentsChosenLabel(VANILLA_ON, LISTING, resolvedFor("vanilla"))).toBe(
      "Agents: vanilla ✓",
    );
    expect(
      agentsChosenLabel(JUSPAY_ON, LISTING, resolvedFor(JUSPAY_PROFILE)),
    ).toBe("Agents: github:juspay/skills ✓");
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
        text: "ready · nd11nx5f",
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
        text: "ready · nd11nx5f · on 3 hosts",
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
        text: "ready · on 2 hosts",
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
        text: "ready · nd11nx5f",
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
        text: "ready · nd11nx5f",
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
          text: "ready · nd11nx5f",
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

  it("the profile notes name this machine's versions once it has them", () => {
    const notes = (localReceipt: AgentDistroReceipt) =>
      agentsProfileNotes({
        listing: LISTING,
        setting: VANILLA_ON,
        localReceipt,
      });
    expect(
      notes(
        receipt({
          versions: [
            { name: "claude", title: "Claude Code", version: "2.1.299" },
          ],
        }),
      ),
    ).toEqual(["Claude Code 2.1.299", AGENTS_REPO_OVERRIDES]);
    // A bundle with no versions file names none — never the floor's.
    expect(notes(receipt({}))).toEqual([AGENTS_REPO_OVERRIDES]);
    // Another profile's receipt (not caught up yet): the set kolu ships.
    expect(notes({ ...receipt({}), profile: "juspay" })).toEqual([
      "Claude Code 2.1.291 · Codex 0.160.1",
      AGENTS_REPO_OVERRIDES,
    ]);
  });
});
