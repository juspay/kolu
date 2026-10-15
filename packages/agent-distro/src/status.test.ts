import { describe, expect, it } from "vitest";
import type { DeliveredProfile } from "./landing.ts";
import type { AgentDistroListing } from "./listing.ts";
import { lastRunOf, recentEvents } from "./receipt.ts";
import type {
  AgentDistroReceipt,
  AgentDistroSetting,
  AgentDistroStatus,
  AgentProfiles,
  TerminalAgents,
} from "./schema.ts";
import {
  AGENTS_CHECK_NOW,
  AGENTS_DELIVERY_AGAIN,
  AGENTS_OFF_MEANS,
  AGENTS_READY_DELIVERING,
  AGENTS_RECEIPT_UNREADABLE,
  AGENTS_UPDATE_DOWNLOADING,
  type AgentStaleness,
  agentCheckFailed,
  agentChipLabel,
  agentChipProfile,
  agentChips,
  agentDistroChoice,
  agentDistroSettingOf,
  agentFailureLines,
  agentFleetSummary,
  agentHostDetail,
  agentMarkLabel,
  agentMarkOf,
  agentProfileRows,
  agentProfileTitle,
  agentRestartAction,
  agentRestartReady,
  agentStaleLabel,
  agentStalenessOf,
  agentToast,
  agentsChosen,
  agentsChosenLabel,
  agentsHint,
  agentsResolvedLine,
  agentsStepHint,
  firstRunAgentsDone,
  JUSPAY_OFFER,
  JUSPAY_PROFILE,
  juspayOffered,
  landedFacts,
  receiptSet,
  profileSuggestions,
  profilesWithAdded,
  profilesWithMoved,
  profilesWithRemoved,
  RECENT_PROFILES_CAP,
  rememberProfiles,
  restartedLabel,
  stackTitle,
  updateLanded,
} from "./status.ts";

/** The package, and a newer one. */
const PKG = "/nix/store/nd11nx5f1dkf02cr9dhxqq4axg23vzgc-agent-distro";
const PKG_NEXT = "/nix/store/8rcmf6rdyyyyyyyyyyyyyyyyyyyyyyyy-agent-distro";

const EKALA_REF = "~/ekala";

/** Juspay's profile as built and delivered, and a newer build of it. */
const JUSPAY: DeliveredProfile = {
  reference: JUSPAY_PROFILE,
  name: "juspay",
  rev: "a1b2c3d4e5f6",
  path: "/nix/store/jjjjjjjj1111111111111111111111-profile-juspay",
};
const JUSPAY_REBUILT: DeliveredProfile = {
  ...JUSPAY,
  rev: "d4e5f6a7b8c9",
  path: "/nix/store/kkkkkkkk2222222222222222222222-profile-juspay",
};
const EKALA: DeliveredProfile = {
  reference: EKALA_REF,
  name: "ekala",
  path: "/nix/store/9f8e7d6c3333333333333333333333-profile-ekala",
};

const LISTING: AgentDistroListing = {
  kind: "available",
  harnesses: [
    { name: "claude", title: "Claude Code", version: "2.1.291" },
    { name: "codex", title: "Codex", version: "0.160.1" },
  ],
};
const UNAVAILABLE: AgentDistroListing = { kind: "unavailable" };

const on = (...profiles: string[]): AgentDistroSetting => ({
  enabled: true,
  profiles,
});
const off = (...profiles: string[]): AgentDistroSetting => ({
  enabled: false,
  profiles,
});

/** A ready status for `profiles`' stack, serving `bundle` with them. */
const ready = (
  delivered: DeliveredProfile[],
  bundle = PKG,
  delivering = false,
): Extract<AgentDistroStatus, { kind: "ready" }> => ({
  kind: "ready",
  profiles: delivered.map((p) => p.reference),
  bundle,
  delivered,
  delivering,
});

/** The client's relative-time phrase, made visible. */
const AGO = (at: number) => `@${at}`;

describe("the stored Agents value — `null` is never chosen", () => {
  it("agentDistroSettingOf: null is off with no profiles; a value is itself", () => {
    expect(agentDistroSettingOf(null)).toEqual({
      enabled: false,
      profiles: [],
    });
    // ONE shared value, so an unrelated preference write changes nothing.
    expect(agentDistroSettingOf(null)).toBe(agentDistroSettingOf(null));
    const chosen = on(JUSPAY_PROFILE);
    expect(agentDistroSettingOf(chosen)).toBe(chosen);
  });

  it("agentsChosen is the absence of a value, and nothing else", () => {
    expect(agentsChosen(null)).toBe(false);
    expect(agentsChosen(off())).toBe(true);
  });
});

describe("agentDistroChoice — the one writer of the Agents value", () => {
  it("a change that names nothing writes nothing", () => {
    expect(agentDistroChoice({}, on(JUSPAY_PROFILE))).toBeUndefined();
  });

  it("the switch keeps the stored list — none while nothing is chosen", () => {
    expect(agentDistroChoice({ on: true }, null)).toEqual(on());
    expect(agentDistroChoice({ on: false }, on(JUSPAY_PROFILE))).toEqual(
      off(JUSPAY_PROFILE),
    );
  });

  it("an edit of the list keeps the switch — off while nothing is chosen", () => {
    expect(
      agentDistroChoice({ profiles: [EKALA_REF] }, on(JUSPAY_PROFILE)),
    ).toEqual(on(EKALA_REF));
    expect(agentDistroChoice({ profiles: [EKALA_REF] }, null)).toEqual(
      off(EKALA_REF),
    );
  });

  it("both at once: the welcome step's Turn on with its profiles", () => {
    expect(
      agentDistroChoice({ on: true, profiles: [JUSPAY_PROFILE] }, null),
    ).toEqual(on(JUSPAY_PROFILE));
  });

  it("writes the list trimmed, without empty entries, each reference once where it first appears", () => {
    expect(
      agentDistroChoice(
        {
          on: true,
          profiles: [
            "  github:juspay/skills ",
            "",
            "   ",
            "~/ekala",
            "github:juspay/skills",
            "~/ekala ",
          ],
        },
        null,
      ),
    ).toEqual(on(JUSPAY_PROFILE, EKALA_REF));
  });

  it("writes any reference — whether it builds is its resolution line's to say", () => {
    expect(
      agentDistroChoice({ profiles: ["not a flake ref at all"] }, on()),
    ).toEqual(on("not a flake ref at all"));
  });
});

describe("the profile list's edits", () => {
  it("profilesWithAdded appends a trimmed reference — nothing for an empty field or a repeat", () => {
    expect(profilesWithAdded([JUSPAY_PROFILE], "  ~/ekala ")).toEqual([
      JUSPAY_PROFILE,
      EKALA_REF,
    ]);
    expect(profilesWithAdded([JUSPAY_PROFILE], "   ")).toBeUndefined();
    expect(
      profilesWithAdded([JUSPAY_PROFILE], ` ${JUSPAY_PROFILE}`),
    ).toBeUndefined();
  });

  it("profilesWithRemoved drops the entry at an index", () => {
    expect(profilesWithRemoved(["a", "b", "c"], 1)).toEqual(["a", "c"]);
    expect(profilesWithRemoved(["a", "b"], 5)).toEqual(["a", "b"]);
  });

  it("profilesWithMoved moves an entry, clamping both ends into the list", () => {
    expect(profilesWithMoved(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(profilesWithMoved(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(profilesWithMoved(["a", "b", "c"], 1, 99)).toEqual(["a", "c", "b"]);
    expect(profilesWithMoved(["a", "b", "c"], -4, 1)).toEqual(["b", "a", "c"]);
  });

  it("a move that goes nowhere hands back the same list", () => {
    const list = ["a", "b"];
    expect(profilesWithMoved(list, 1, 1)).toBe(list);
    expect(profilesWithMoved(list, 1, 7)).toBe(list);
    const empty: string[] = [];
    expect(profilesWithMoved(empty, 0, 1)).toBe(empty);
  });
});

describe("firstRunAgentsDone — the first-run step's done-predicate", () => {
  const done = (
    stored: AgentDistroSetting | null,
    local: AgentDistroStatus | undefined,
    listing: AgentDistroListing | undefined | "none" = LISTING,
  ) =>
    firstRunAgentsDone({
      stored,
      listing: listing === "none" ? undefined : listing,
      local,
    });

  it("is not known until the listing arrives", () => {
    expect(done(on(), ready([]), "none")).toBeUndefined();
  });

  it("is done at once in a kolu built without agents — there is nothing to choose", () => {
    expect(done(null, undefined, UNAVAILABLE)).toBe(true);
  });

  it("is never done while nothing is chosen, or while Off is chosen", () => {
    expect(done(null, ready([]))).toBe(false);
    expect(done(off(JUSPAY_PROFILE), ready([JUSPAY]))).toBe(false);
  });

  it("agents on: not known until this machine's status catches up", () => {
    expect(done(on(), undefined)).toBeUndefined();
    expect(done(on(), { kind: "off" })).toBeUndefined();
  });

  it("agents on: done once this machine is ready with the setting's stack — or has nothing to fetch", () => {
    expect(done(on(), ready([]))).toBe(true);
    expect(done(on(JUSPAY_PROFILE, EKALA_REF), ready([JUSPAY, EKALA]))).toBe(
      true,
    );
    expect(done(on(JUSPAY_PROFILE), { kind: "unavailable" })).toBe(true);
  });

  it("agents on: not done while this machine is being delivered the stack, or the delivery failed", () => {
    const profiles = [JUSPAY_PROFILE];
    expect(done(on(...profiles), { kind: "downloading", profiles })).toBe(
      false,
    );
    expect(done(on(...profiles), { kind: "undelivered", profiles })).toBe(
      false,
    );
    expect(
      done(on(...profiles), { kind: "error", profiles, message: "nope" }),
    ).toBe(false);
  });

  it("a status for another stack — even the same profiles reordered — is one padi has not caught up from", () => {
    expect(done(on(JUSPAY_PROFILE), ready([]))).toBeUndefined();
    expect(done(on(EKALA_REF, JUSPAY_PROFILE), ready([JUSPAY, EKALA]))).toBe(
      undefined,
    );
    expect(
      done(on(), { kind: "error", profiles: [JUSPAY_PROFILE], message: "x" }),
    ).toBeUndefined();
  });
});

describe("naming profiles", () => {
  it("agentProfileTitle: Juspay's reference by name, anything else as itself", () => {
    expect(agentProfileTitle(JUSPAY_PROFILE)).toBe(JUSPAY_OFFER.title);
    expect(agentProfileTitle(EKALA_REF)).toBe(EKALA_REF);
  });

  it("stackTitle: each built profile by its own name, bottom to top", () => {
    expect(stackTitle([JUSPAY, EKALA])).toBe("juspay + ekala");
    expect(stackTitle([])).toBe("");
  });
});

describe("agentsResolvedLine — does the profile build", () => {
  const profiles = (
    resolution: AgentProfiles[number]["resolution"],
    reference = JUSPAY_PROFILE,
  ): AgentProfiles => [{ reference, resolution }];

  it("pending until kolu-server has answered for THIS reference", () => {
    const pending = {
      kind: "pending",
      text: `resolving ${JUSPAY_PROFILE}…`,
    };
    expect(agentsResolvedLine(JUSPAY_PROFILE, undefined)).toEqual(pending);
    expect(
      agentsResolvedLine(JUSPAY_PROFILE, profiles({ kind: "pending" })),
    ).toEqual(pending);
    expect(
      agentsResolvedLine(
        JUSPAY_PROFILE,
        profiles(
          { kind: "resolved", name: "ekala", description: "" },
          EKALA_REF,
        ),
      ),
    ).toEqual(pending);
  });

  it("resolved: the name its build gives itself, its short revision, and its description", () => {
    expect(
      agentsResolvedLine(
        JUSPAY_PROFILE,
        profiles({
          kind: "resolved",
          name: "juspay",
          description: "Juspay skills",
          rev: "a1b2c3d4e5f6",
        }),
      ),
    ).toEqual({ kind: "resolved", text: "juspay (a1b2c3d) · Juspay skills" });
    // A path has no revision; an empty description adds nothing.
    expect(
      agentsResolvedLine(
        EKALA_REF,
        profiles(
          { kind: "resolved", name: "ekala", description: "" },
          EKALA_REF,
        ),
      ),
    ).toEqual({ kind: "resolved", text: "ekala" });
  });

  it("failed: Nix's or agent-distro's own words", () => {
    expect(
      agentsResolvedLine(
        JUSPAY_PROFILE,
        profiles({ kind: "failed", message: "error: flake has no lib" }),
      ),
    ).toEqual({ kind: "failed", text: "error: flake has no lib" });
  });
});

describe("the profile list's rows and Juspay's one-click entry", () => {
  it("one row per reference, in stack order, each named and resolved", () => {
    const profiles: AgentProfiles = [
      {
        reference: EKALA_REF,
        resolution: { kind: "failed", message: "no agent-distro.nix" },
      },
    ];
    expect(agentProfileRows(on(JUSPAY_PROFILE, EKALA_REF), profiles)).toEqual([
      {
        reference: JUSPAY_PROFILE,
        title: "Juspay",
        line: { kind: "pending", text: `resolving ${JUSPAY_PROFILE}…` },
      },
      {
        reference: EKALA_REF,
        title: EKALA_REF,
        line: { kind: "failed", text: "no agent-distro.nix" },
      },
    ]);
    expect(agentProfileRows(on(), profiles)).toEqual([]);
  });

  it("Juspay is offered only while the list does not hold it", () => {
    expect(juspayOffered(on().profiles)).toBe(true);
    expect(juspayOffered(off(EKALA_REF).profiles)).toBe(true);
    expect(juspayOffered(on(EKALA_REF, JUSPAY_PROFILE).profiles)).toBe(false);
  });
});

describe("agentsChosenLabel — the welcome card's done line", () => {
  const juspayResolved: AgentProfiles[number] = {
    reference: JUSPAY_PROFILE,
    resolution: { kind: "resolved", name: "juspay", description: "" },
  };

  it("none while agents are off, or in a kolu built without agents", () => {
    expect(agentsChosenLabel(off(), LISTING, undefined)).toBeUndefined();
    expect(agentsChosenLabel(on(), UNAVAILABLE, undefined)).toBeUndefined();
  });

  it("on with no profiles: Agents: on", () => {
    expect(agentsChosenLabel(on(), LISTING, undefined)).toBe("Agents: on");
  });

  it("names the stack at once while it resolves, by its references' titles", () => {
    expect(
      agentsChosenLabel(on(JUSPAY_PROFILE, EKALA_REF), LISTING, undefined),
    ).toBe(`Agents: Juspay + ${EKALA_REF}`);
  });

  it("a check once every profile built, each by the name its build gave it", () => {
    expect(
      agentsChosenLabel(on(JUSPAY_PROFILE, EKALA_REF), LISTING, [
        juspayResolved,
        {
          reference: EKALA_REF,
          resolution: { kind: "resolved", name: "ekala", description: "d" },
        },
      ]),
    ).toBe("Agents: juspay + ekala ✓");
    // One still pending: no check yet.
    expect(
      agentsChosenLabel(on(JUSPAY_PROFILE, EKALA_REF), LISTING, [
        juspayResolved,
      ]),
    ).toBe(`Agents: juspay + ${EKALA_REF}`);
  });

  it("the first failure's words instead of the check", () => {
    expect(
      agentsChosenLabel(on(JUSPAY_PROFILE, EKALA_REF), LISTING, [
        juspayResolved,
        {
          reference: EKALA_REF,
          resolution: { kind: "failed", message: "no such path" },
        },
      ]),
    ).toBe(`Agents: juspay + ${EKALA_REF} — no such path`);
  });
});

describe("agentMarkOf — the one status → treatment fold", () => {
  const profiles = [JUSPAY_PROFILE];
  const cases: [string, AgentDistroStatus | undefined, unknown][] = [
    ["no frame yet, not checking", undefined, { kind: "none", why: "unheard" }],
    ["off", { kind: "off" }, { kind: "none", why: "off" }],
    [
      "unavailable",
      { kind: "unavailable" },
      { kind: "none", why: "unavailable" },
    ],
    [
      "undelivered: no mark, nothing turning",
      { kind: "undelivered", profiles },
      { kind: "none", why: "undelivered" },
    ],
    [
      "ready with a stack: its profiles by name and the package's hash",
      ready([JUSPAY, EKALA]),
      {
        kind: "ready",
        stack: "juspay + ekala",
        hash: "nd11nx5f",
        delivering: false,
      },
    ],
    [
      "ready with no profiles",
      ready([]),
      { kind: "ready", stack: "", hash: "nd11nx5f", delivering: false },
    ],
    [
      "ready, delivering a newer set",
      ready([JUSPAY], PKG, true),
      { kind: "ready", stack: "juspay", hash: "nd11nx5f", delivering: true },
    ],
    ["downloading", { kind: "downloading", profiles }, { kind: "downloading" }],
    [
      "error",
      { kind: "error", profiles, message: "cache not usable" },
      { kind: "failed", message: "cache not usable" },
    ],
  ];
  for (const [name, status, mark] of cases)
    it(name, () => expect(agentMarkOf(status, false)).toEqual(mark));

  it("checking wins — derived on the client, no server state", () => {
    expect(agentMarkOf(undefined, true)).toEqual({ kind: "checking" });
    expect(agentMarkOf(ready([]), true)).toEqual({ kind: "checking" });
  });
});

describe("agentMarkLabel", () => {
  it("words each treatment; none has no words", () => {
    expect(agentMarkLabel({ kind: "none", why: "off" }, "box")).toBeUndefined();
    expect(agentMarkLabel({ kind: "checking" }, "box")).toBe(
      "Coding agents: checking box…",
    );
    expect(agentMarkLabel({ kind: "downloading" }, "box")).toBe(
      "Delivering the coding agents to box…",
    );
    expect(
      agentMarkLabel({ kind: "failed", message: "nix missing" }, "box"),
    ).toBe(
      `The coding agents could not be delivered to box: nix missing\n${AGENTS_DELIVERY_AGAIN}`,
    );
  });

  it("ready: the package's hash, with its profiles when it has any", () => {
    expect(
      agentMarkLabel(agentMarkOf(ready([JUSPAY, EKALA]), false), "box"),
    ).toBe(
      "Coding agents ready on box: nd11nx5f with juspay + ekala — new terminals on box start with them",
    );
    expect(agentMarkLabel(agentMarkOf(ready([]), false), "box")).toBe(
      "Coding agents ready on box: nd11nx5f — new terminals on box start with them",
    );
  });

  it("ready while a newer set is delivered: a second line says so", () => {
    expect(
      agentMarkLabel(agentMarkOf(ready([], PKG, true), false), "box")
        ?.split("\n")
        .slice(1),
    ).toEqual([AGENTS_UPDATE_DOWNLOADING]);
  });

  it("a failure is its cause, then when kolu tries again — each once", () => {
    expect(
      agentFailureLines({ message: "cache not usable" }, "devbox"),
    ).toEqual([
      "The coding agents could not be delivered to devbox: cache not usable",
      AGENTS_DELIVERY_AGAIN,
    ]);
  });
});

describe("the add field's suggestions and memory", () => {
  it("remembers references most recent first, once, at most the cap — never Juspay's", () => {
    expect(rememberProfiles(["a", "b"], ["b", JUSPAY_PROFILE, "c"])).toEqual([
      "b",
      "c",
      "a",
    ]);
    const many = Array.from({ length: 20 }, (_, i) => `ref${i}`);
    expect(rememberProfiles([], many)).toHaveLength(RECENT_PROFILES_CAP);
  });

  it("suggests what was used before, without what the list already holds", () => {
    expect(
      profileSuggestions({ recent: ["a", "b", "c"], profiles: ["b"] }),
    ).toEqual([
      { value: "a", note: "used before" },
      { value: "c", note: "used before" },
    ]);
  });
});

describe("agentFleetSummary — the ONE fleet line in Settings", () => {
  const host = (
    label: string,
    status: AgentDistroStatus | undefined,
    checking = false,
  ) => ({ label, status, checking, receipt: undefined, ago: AGO });
  /** The groups as the line reads, machines by name. */
  const said = (groups: ReturnType<typeof agentFleetSummary>) =>
    groups.map((g) => ({
      key: g.key,
      tone: g.tone,
      lead: g.lead,
      hosts: g.hosts.map((h) => h.label),
      trail: g.trail,
    }));

  it("one ready machine: Ready on it — and nothing of its own beside", () => {
    expect(said(agentFleetSummary([host("naiveintent", ready([]))]))).toEqual([
      {
        key: "ready",
        tone: "ok",
        lead: "Ready on",
        hosts: ["naiveintent"],
        trail: "",
      },
    ]);
  });

  it("one group per state, in the order handed in, each naming two machines and counting the rest", () => {
    const profiles = [JUSPAY_PROFILE];
    const groups = agentFleetSummary([
      host("naiveintent", ready([JUSPAY])),
      host("buildbox", { kind: "downloading", profiles }),
      host("box", ready([JUSPAY])),
      host("zest", ready([JUSPAY], PKG, true)),
      host("devbox", { kind: "error", profiles, message: "cache not usable" }),
    ]);
    expect(said(groups)).toEqual([
      {
        key: "ready",
        tone: "ok",
        lead: "Ready on",
        hosts: ["naiveintent", "box"],
        trail: "and 1 more",
      },
      {
        key: "downloading",
        tone: "busy",
        lead: "",
        hosts: ["buildbox"],
        trail: "delivering",
      },
      {
        key: "failed",
        tone: "warn",
        lead: "",
        hosts: ["devbox"],
        trail: "failed",
      },
    ]);
  });

  it("a machine with no agents says why, and two reasons never share a group", () => {
    expect(
      said(
        agentFleetSummary([
          host("naiveintent", { kind: "off" }),
          host("box", undefined),
          host("zest", { kind: "unavailable" }),
          host("far", { kind: "undelivered", profiles: [] }),
          host("ci-2", undefined, true),
        ]),
      ).map(({ key, hosts, trail }) => ({ key, hosts, trail })),
    ).toEqual([
      { key: "none:off", hosts: ["naiveintent"], trail: "agents off" },
      { key: "none:unheard", hosts: ["box"], trail: "not connected" },
      {
        key: "none:unavailable",
        hosts: ["zest"],
        trail: "no coding agents in this build",
      },
      {
        key: "none:undelivered",
        hosts: ["far"],
        trail: "no coding agents delivered",
      },
      { key: "checking", hosts: ["ci-2"], trail: "checking…" },
    ]);
  });

  it("no machines, no groups", () => {
    expect(agentFleetSummary([])).toEqual([]);
  });
});

describe("agentHostDetail — one machine's agents, in its host details", () => {
  const receipt = (over: Partial<AgentDistroReceipt>): AgentDistroReceipt => ({
    bundle: PKG,
    versions: [],
    profiles: [JUSPAY],
    events: [],
    ...over,
  });
  const detail = (
    status: AgentDistroStatus | undefined,
    r?: AgentDistroReceipt,
    setting = on(JUSPAY_PROFILE),
  ) =>
    agentHostDetail({
      host: { label: "devbox", status, checking: false, receipt: r, ago: AGO },
      setting,
    });

  it("ready: the served stack by name with the package, the state, and a check to run", () => {
    expect(detail(ready([JUSPAY]))).toEqual({
      stack: "juspay",
      hash: "nd11nx5f",
      state: { text: "ready", title: "ready", tone: "muted" },
      events: [],
      canCheck: true,
    });
  });

  it("names the SETTING's stack until a set has landed", () => {
    const profiles = [JUSPAY_PROFILE, EKALA_REF];
    expect(
      detail({ kind: "undelivered", profiles }, undefined, on(...profiles)),
    ).toEqual({
      stack: `Juspay + ${EKALA_REF}`,
      state: {
        text: "no coding agents delivered",
        title: "no coding agents delivered",
        tone: "muted",
      },
      events: [],
      canCheck: false,
    });
    expect(detail({ kind: "off" }, undefined, off())?.stack).toBe("");
  });

  it("ready: the last run joins the state line, and the events are that machine's", () => {
    const d = detail(
      ready([JUSPAY]),
      receipt({
        lastRun: { at: 3, outcome: "updated", by: "log", words: "C 1 → 2" },
        events: [
          { at: "1970-01-01T00:00:00.003Z", kind: "updated", words: "C 1 → 2" },
        ],
      }),
    );
    expect(d?.state).toEqual({
      text: "ready · updated @3",
      title: "updated @3 — the host's update log: C 1 → 2",
      tone: "muted",
    });
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

  it("each last-run outcome in its own words; a skip or a failure quotes its reason with its author", () => {
    const state = (lastRun: AgentDistroReceipt["lastRun"]) =>
      detail(ready([JUSPAY]), receipt({ lastRun }))?.state;
    expect(
      state({ at: 2, outcome: "unchanged", words: "", by: "log" }),
    ).toEqual({
      text: "ready · checked @2, up to date",
      title: "checked @2, up to date",
      tone: "muted",
    });
    expect(
      state({
        at: 3,
        outcome: "skipped",
        words: "cache not usable",
        by: "agent-distro",
      }),
    ).toEqual({
      text: "ready · checked @3, skipped",
      title: "checked @3, skipped — agent-distro's updater: cache not usable",
      tone: "muted",
    });
    expect(
      state({
        at: 4,
        outcome: "failed",
        words: "the delivered package is not in the store",
        by: "padi",
      }),
    ).toEqual({
      text: "ready · last update failed @4",
      title:
        "last update failed @4 — padi: the delivered package is not in the store",
      tone: "warn",
    });
    expect(
      state({ at: 5, outcome: "failed", words: "no route", by: "delivery" })
        ?.title,
    ).toBe("last update failed @5 — kolu's delivery: no route");
  });

  it("a delivery in flight says so, and offers no check while it runs", () => {
    const d = detail(ready([JUSPAY], PKG, true));
    expect(d?.state.text).toBe(AGENTS_READY_DELIVERING);
    expect(d?.canCheck).toBe(false);
  });

  it("failed: the cause in kolu-server's words, what it means there, and a check to try again", () => {
    expect(
      detail({
        kind: "error",
        profiles: [JUSPAY_PROFILE],
        message: "the cache does not hold this package",
      }),
    ).toEqual({
      stack: "Juspay",
      state: {
        text: "delivery failed",
        title: "the cache does not hold this package",
        tone: "warn",
      },
      cause: "the cache does not hold this package",
      means: `New terminals on devbox get no coding agents until this is fixed. ${AGENTS_DELIVERY_AGAIN}`,
      events: [],
      canCheck: true,
    });
  });

  it("delivering, checking and off say what they are, with nothing to do from here", () => {
    expect(
      detail({ kind: "downloading", profiles: [JUSPAY_PROFILE] }),
    ).toMatchObject({ state: { text: "delivering…" }, canCheck: false });
    expect(detail({ kind: "off" })).toMatchObject({
      state: { text: "agents off" },
      canCheck: false,
    });
    expect(
      agentHostDetail({
        host: {
          label: "devbox",
          status: undefined,
          checking: true,
          receipt: undefined,
          ago: AGO,
        },
        setting: on(),
      }),
    ).toMatchObject({ state: { text: "checking…" }, canCheck: false });
  });

  it("a padi without agents, or a machine we cannot hear from, has no section", () => {
    expect(detail({ kind: "unavailable" })).toBeUndefined();
    expect(detail(undefined)).toBeUndefined();
  });

  it("a history that would not read says so on the state line and as its one event, in padi's words", () => {
    const d = detail(
      ready([JUSPAY]),
      receipt({ events: [], error: "the history file is not a history" }),
    );
    expect(d?.state).toEqual({
      text: `ready · ${AGENTS_RECEIPT_UNREADABLE}`,
      title: `${AGENTS_RECEIPT_UNREADABLE} — padi: the history file is not a history`,
      tone: "warn",
    });
    expect(d?.events).toEqual([
      {
        when: "",
        kind: "unreadable",
        text: AGENTS_RECEIPT_UNREADABLE,
        title: `${AGENTS_RECEIPT_UNREADABLE} — padi: the history file is not a history`,
        tone: "warn",
      },
    ]);
  });

  it("a mixed history log names each line's writer by what it says, never kolu's delivery", () => {
    // One shared log: padi's `updated:` line for a delivery that landed, then
    // agent-distro's own updater failing and skipping. Only the updater
    // writes `failed:`/`skipped:`; an `updated:` line may be either's, so it
    // is the log's.
    const events = recentEvents(
      [
        "2026-10-08T02:00:05+00:00 updated: Claude Code 2.1.286 → 2.1.291, juspay a1b2c3d → d4e5f6a",
        "2026-10-08T02:00:09+00:00 failed: nix build exit 1",
        "2026-10-08T08:00:03+00:00 skipped: cache https://cache.example not usable",
      ].join("\n"),
    );
    const d = detail(
      ready([JUSPAY]),
      receipt({ events, lastRun: lastRunOf(events, null) }),
    );
    expect(d?.state.title).toBe(
      `checked @${Date.parse("2026-10-08T08:00:03Z")}, skipped — agent-distro's updater: cache https://cache.example not usable`,
    );
    expect(d?.events.map((e) => [e.title, e.tone])).toEqual([
      [
        "skipped — agent-distro's updater: cache https://cache.example not usable",
        "muted",
      ],
      ["failed — agent-distro's updater: nix build exit 1", "warn"],
      [
        "updated — the host's update log: Claude Code 2.1.286 → 2.1.291, juspay a1b2c3d → d4e5f6a",
        "muted",
      ],
    ]);
  });
});

describe("the Agents row's words", () => {
  it("agentsStepHint: the harnesses by name, then what kolu does with them", () => {
    expect(agentsStepHint(LISTING)).toBe(
      "Claude Code and Codex in every new terminal. Kept up to date, nothing to install.",
    );
    expect(
      agentsStepHint({
        kind: "available",
        harnesses: [
          { name: "claude", title: "Claude Code", version: "1" },
          { name: "codex", title: "Codex", version: "1" },
          { name: "pi", title: "Pi", version: "1" },
        ],
      }),
    ).toBe(
      "Claude Code, Codex and Pi in every new terminal. Kept up to date, nothing to install.",
    );
    expect(
      agentsStepHint({
        kind: "available",
        harnesses: [{ name: "pi", title: "Pi", version: "1" }],
      }),
    ).toBe("Pi in every new terminal. Kept up to date, nothing to install.");
    expect(agentsStepHint(undefined)).toBeUndefined();
    expect(agentsStepHint(UNAVAILABLE)).toBeUndefined();
  });

  it("agentsHint: off is one sentence; on says nothing; nothing chosen reads as off", () => {
    const offHint = {
      text: `Off. ${AGENTS_OFF_MEANS} Turn on and they start with these, kept up to date:`,
      tone: "muted",
    };
    expect(agentsHint({ stored: off(), listing: LISTING })).toEqual(offHint);
    expect(agentsHint({ stored: null, listing: LISTING })).toEqual(offHint);
    expect(
      agentsHint({ stored: on(JUSPAY_PROFILE), listing: LISTING }),
    ).toBeUndefined();
  });

  it("agentsHint: nothing until the listing arrives, and why in a kolu built without agents", () => {
    expect(agentsHint({ stored: null, listing: undefined })).toBeUndefined();
    expect(agentsHint({ stored: null, listing: UNAVAILABLE })?.text).toMatch(
      /built without coding agents/,
    );
  });
});

describe("agentChips — the harnesses the Agents row names", () => {
  const chips = (
    setting: AgentDistroSetting,
    localReceipt?: AgentDistroReceipt,
    listing: AgentDistroListing | "none" = LISTING,
  ) =>
    agentChips({
      setting,
      listing: listing === "none" ? undefined : listing,
      localReceipt,
    });

  it("off: by name, no versions — nothing is installed", () => {
    expect(chips(off(JUSPAY_PROFILE))).toEqual([
      { title: "Claude Code" },
      { title: "Codex" },
    ]);
  });

  it("on: the listing's versions until this machine has a receipt for a package", () => {
    expect(chips(on())).toEqual([
      { title: "Claude Code", version: "2.1.291" },
      { title: "Codex", version: "0.160.1" },
    ]);
    // A receipt with no package serving is not this machine's versions.
    expect(
      chips(on(), {
        versions: [{ name: "claude", title: "Claude Code", version: "9" }],
        profiles: [],
        events: [],
      }),
    ).toEqual([
      { title: "Claude Code", version: "2.1.291" },
      { title: "Codex", version: "0.160.1" },
    ]);
  });

  it("on: this machine's own versions once its receipt names a package — none when it records none", () => {
    expect(
      chips(on(), {
        bundle: PKG,
        versions: [
          { name: "claude", title: "Claude Code", version: "2.1.299" },
        ],
        profiles: [],
        events: [],
      }),
    ).toEqual([{ title: "Claude Code", version: "2.1.299" }]);
    expect(
      chips(on(), { bundle: PKG, versions: [], profiles: [], events: [] }),
    ).toEqual([]);
  });

  it("cuts each version's `+` revision suffix, from the listing and from a receipt alike", () => {
    const plus: AgentDistroListing = {
      kind: "available",
      harnesses: [
        { name: "opencode", title: "OpenCode", version: "1.18.35+53d1eab" },
      ],
    };
    expect(chips(on(), undefined, plus)).toEqual([
      { title: "OpenCode", version: "1.18.35" },
    ]);
    expect(
      chips(on(), {
        bundle: PKG,
        versions: [
          { name: "opencode", title: "OpenCode", version: "1.18.36+aa" },
        ],
        profiles: [],
        events: [],
      }),
    ).toEqual([{ title: "OpenCode", version: "1.18.36" }]);
  });

  it("none until the listing arrives, or in a kolu built without agents", () => {
    expect(chips(on(), undefined, "none")).toEqual([]);
    expect(chips(on(), undefined, UNAVAILABLE)).toEqual([]);
  });
});

describe("agentStalenessOf — are a terminal's agents what a new one gets", () => {
  const terminal = (bundle: string, profiles: DeliveredProfile[]) => ({
    agents: { bundle, profiles },
  });
  const stale = (
    t: { agents?: TerminalAgents },
    status: AgentDistroStatus | undefined,
    setting: AgentDistroSetting,
  ) => agentStalenessOf({ terminal: t, status, setting });

  it("a terminal without agents is never stale", () => {
    expect(stale({}, ready([]), on())).toEqual({ kind: "current" });
    expect(stale({}, ready([]), off())).toEqual({ kind: "current" });
  });

  it("agents now off", () => {
    expect(
      stale(terminal(PKG, [JUSPAY]), { kind: "off" }, off(JUSPAY_PROFILE)),
    ).toEqual({
      kind: "stale",
      had: { stack: "juspay", hash: "nd11nx5f" },
      now: { kind: "off" },
    });
  });

  it("the same package and the same builds: current", () => {
    expect(
      stale(
        terminal(PKG, [JUSPAY, EKALA]),
        ready([JUSPAY, EKALA]),
        on(JUSPAY_PROFILE, EKALA_REF),
      ),
    ).toEqual({ kind: "current" });
    expect(stale(terminal(PKG, []), ready([]), on())).toEqual({
      kind: "current",
    });
  });

  it("the package changed: stale, with the set a new terminal gets", () => {
    expect(
      stale(
        terminal(PKG, [JUSPAY]),
        ready([JUSPAY], PKG_NEXT),
        on(JUSPAY_PROFILE),
      ),
    ).toEqual({
      kind: "stale",
      had: { stack: "juspay", hash: "nd11nx5f" },
      now: { kind: "set", stack: "juspay", hash: "8rcmf6rd" },
    });
  });

  it("a profile was rebuilt on the same package: stale", () => {
    expect(
      stale(
        terminal(PKG, [JUSPAY]),
        ready([JUSPAY_REBUILT]),
        on(JUSPAY_PROFILE),
      ),
    ).toEqual({
      kind: "stale",
      had: { stack: "juspay", hash: "nd11nx5f" },
      now: { kind: "set", stack: "juspay", hash: "nd11nx5f" },
    });
  });

  it("the stack changed and the host is ready with it: stale, naming the new stack", () => {
    expect(
      stale(
        terminal(PKG, [JUSPAY]),
        ready([JUSPAY, EKALA]),
        on(JUSPAY_PROFILE, EKALA_REF),
      ),
    ).toEqual({
      kind: "stale",
      had: { stack: "juspay", hash: "nd11nx5f" },
      now: { kind: "set", stack: "juspay + ekala", hash: "nd11nx5f" },
    });
  });

  it("the stack changed and the host has not caught up: stale, waiting on its delivery", () => {
    const waiting = {
      kind: "stale",
      had: { stack: "juspay", hash: "nd11nx5f" },
      now: {
        kind: "waiting",
        stack: `Juspay + ${EKALA_REF}`,
        on: "downloading",
      },
    };
    const setting = on(JUSPAY_PROFILE, EKALA_REF);
    // Still ready with the OLD stack — a status padi has not caught up from.
    expect(stale(terminal(PKG, [JUSPAY]), ready([JUSPAY]), setting)).toEqual(
      waiting,
    );
    // No word at all yet.
    expect(stale(terminal(PKG, [JUSPAY]), undefined, setting)).toEqual(waiting);
  });

  it("the same stack with no word from the host yet: current", () => {
    expect(
      stale(terminal(PKG, [JUSPAY]), undefined, on(JUSPAY_PROFILE)),
    ).toEqual({ kind: "current" });
    expect(
      stale(
        terminal(PKG, [JUSPAY]),
        { kind: "undelivered", profiles: [JUSPAY_PROFILE] },
        on(JUSPAY_PROFILE),
      ),
    ).toEqual({ kind: "current" });
  });

  it("the same stack while the host delivers it or failed to: stale — a new terminal there gets no agents", () => {
    const profiles = [JUSPAY_PROFILE];
    const t = terminal(PKG, [JUSPAY]);
    expect(
      stale(t, { kind: "downloading", profiles }, on(...profiles)),
    ).toEqual({
      kind: "stale",
      had: { stack: "juspay", hash: "nd11nx5f" },
      now: { kind: "waiting", stack: "Juspay", on: "downloading" },
    });
    expect(
      stale(t, { kind: "error", profiles, message: "x" }, on(...profiles)),
    ).toEqual({
      kind: "stale",
      had: { stack: "juspay", hash: "nd11nx5f" },
      now: { kind: "waiting", stack: "Juspay", on: "failed" },
    });
  });
});

describe("the stale pill: can it restart, what a restart does, and its words", () => {
  type Stale = Extract<AgentStaleness, { kind: "stale" }>;
  const had = { stack: "juspay", hash: "nd11nx5f" };
  const toOff: Stale = { kind: "stale", had, now: { kind: "off" } };
  const toSet: Stale = {
    kind: "stale",
    had,
    now: { kind: "set", stack: "juspay + ekala", hash: "8rcmf6rd" },
  };
  const waiting = (on: "downloading" | "failed", stack = "Juspay"): Stale => ({
    kind: "stale",
    had,
    now: { kind: "waiting", stack, on },
  });

  it("restarts into off or a ready set — never while waiting", () => {
    expect(agentRestartReady(toOff)).toBe(true);
    expect(agentRestartReady(toSet)).toBe(true);
    expect(agentRestartReady(waiting("downloading"))).toBe(false);
    expect(agentRestartReady(waiting("failed"))).toBe(false);
  });

  it("agents stay on: the conversation resumes — not destructive", () => {
    expect(agentRestartAction(toSet)).toEqual({
      label: "Restart",
      armedLabel: "Restart agent",
      destructive: false,
      outcome:
        "the agent's conversation resumes on the new agents, other programs end",
    });
  });

  it("agents now off: a plain shell, the agent ends — destructive", () => {
    expect(agentRestartAction(toOff)).toMatchObject({
      armedLabel: "Kill agent and restart",
      destructive: true,
      outcome: "it comes back as a plain shell, and running programs end",
    });
  });

  it("words what the terminal has, what a new one gets, and what a restart does", () => {
    const has = "This terminal has the coding agents nd11nx5f with juspay.";
    expect(agentStaleLabel(toSet, "box")).toBe(
      `${has} New terminals get 8rcmf6rd with juspay + ekala. Restart to switch; ${agentRestartAction(toSet).outcome}.`,
    );
    expect(agentStaleLabel(toOff, "box")).toBe(
      `${has} Coding agents are now off. Restart to switch; ${agentRestartAction(toOff).outcome}.`,
    );
    expect(agentStaleLabel(waiting("downloading"), "box")).toBe(
      `${has} New terminals get Juspay, which is still being delivered to box; Restart appears once it is ready.`,
    );
    expect(agentStaleLabel(waiting("failed"), "box")).toBe(
      `${has} Juspay could not be delivered to box, so new terminals get no coding agents; Restart appears once it is ready.`,
    );
    // Waiting on an empty stack: newer agents, never an empty name.
    expect(agentStaleLabel(waiting("downloading", ""), "box")).toContain(
      "New terminals get newer agents,",
    );
  });

  it("a terminal with no profiles is named by its package's hash alone", () => {
    expect(
      agentStaleLabel(
        {
          kind: "stale",
          had: { stack: "", hash: "nd11nx5f" },
          now: { kind: "off" },
        },
        "box",
      ),
    ).toMatch(/^This terminal has the coding agents nd11nx5f\. /);
  });
});

describe("the tile pill", () => {
  const effective = {
    name: "juspay + ekala",
    description: "Ekala's agents",
    source:
      "from /home/me/ekala/agent-distro.nix over AI_PROFILE=/nix/store/p-juspay",
  };

  it("names the profile in effect, else the stack it was spawned with, else nothing", () => {
    expect(
      agentChipProfile({ bundle: PKG, profiles: [JUSPAY], effective }),
    ).toBe("juspay + ekala");
    expect(agentChipProfile({ bundle: PKG, profiles: [JUSPAY, EKALA] })).toBe(
      "juspay + ekala",
    );
    expect(agentChipProfile({ bundle: PKG, profiles: [] })).toBeUndefined();
  });

  it("its hover: what the terminal started with, and what a click does", () => {
    expect(agentChipLabel({ bundle: PKG, profiles: [JUSPAY], effective })).toBe(
      `This terminal started with the juspay + ekala profile (nd11nx5f), ${effective.source}. Click to choose what new terminals get.`,
    );
    expect(agentChipLabel({ bundle: PKG, profiles: [JUSPAY] })).toBe(
      "This terminal started with the coding agents (nd11nx5f) and juspay. Click to choose what new terminals get.",
    );
    expect(agentChipLabel({ bundle: PKG, profiles: [] })).toBe(
      "This terminal started with the coding agents (nd11nx5f), no profile. Click to choose what new terminals get.",
    );
  });
});

describe("the words outside the folds", () => {
  it("restartedLabel: from what padi reports it did", () => {
    expect(restartedLabel({ agents: undefined, resumed: false })).toBe(
      "Restarted as a plain shell",
    );
    expect(restartedLabel({ agents: "", resumed: false })).toBe(
      "Restarted with the coding agents",
    );
    expect(restartedLabel({ agents: "juspay + ekala", resumed: true })).toBe(
      "Restarted with the coding agents and juspay + ekala; the conversation resumed",
    );
  });

  it("agentToast: on, off, and an update landing on a named machine", () => {
    expect(agentToast.on([])).toBe("New terminals get the coding agents");
    expect(agentToast.on([JUSPAY_PROFILE, EKALA_REF])).toBe(
      `New terminals get the coding agents with Juspay + ${EKALA_REF}`,
    );
    expect(agentToast.off).toBe("Coding agents off");
    expect(
      agentToast.updated("naiveintent", "Claude Code 2.1.286 → 2.1.291"),
    ).toEqual({
      title: "Coding agents updated on naiveintent",
      description:
        "Claude Code 2.1.286 → 2.1.291 — new terminals on naiveintent start with them; open ones offer Restart.",
    });
  });

  it("Check now: the palette command's words, and a check that would not run", () => {
    expect(AGENTS_CHECK_NOW.label).toBe("Check for newer coding agents");
    expect(AGENTS_CHECK_NOW.note).toBe("every machine");
    expect(agentCheckFailed("box", "a run is already going")).toBe(
      "Could not check for newer coding agents on box: a run is already going",
    );
  });
});

describe("updateLanded — the moment a delivery is worth the updated toast", () => {
  const facts = (status: AgentDistroStatus | undefined) => landedFacts(status);

  it("reads its facts off a ready status only", () => {
    expect(facts(ready([JUSPAY]))).toEqual({
      stack: JSON.stringify([JUSPAY_PROFILE]),
      set: JSON.stringify([PKG, JUSPAY.path]),
      bundle: PKG,
    });
    expect(facts({ kind: "off" })).toBeUndefined();
    expect(
      facts({ kind: "downloading", profiles: [JUSPAY_PROFILE] }),
    ).toBeUndefined();
    expect(facts(undefined)).toBeUndefined();
  });

  it("another package, or a rebuilt profile, of the SAME stack is an update", () => {
    expect(
      updateLanded(facts(ready([JUSPAY])), facts(ready([JUSPAY], PKG_NEXT))),
    ).toBe(true);
    expect(
      updateLanded(facts(ready([JUSPAY])), facts(ready([JUSPAY_REBUILT]))),
    ).toBe(true);
  });

  it("a first delivery, a change of the stack, the same set, or a host going off is not", () => {
    expect(updateLanded(undefined, facts(ready([JUSPAY])))).toBe(false);
    expect(
      updateLanded(facts(ready([JUSPAY])), facts(ready([JUSPAY, EKALA]))),
    ).toBe(false);
    expect(updateLanded(facts(ready([JUSPAY])), facts(ready([JUSPAY])))).toBe(
      false,
    );
    expect(updateLanded(facts(ready([JUSPAY])), facts({ kind: "off" }))).toBe(
      false,
    );
  });

  it("an update in flight changes nothing — the facts are the set that serves", () => {
    expect(
      updateLanded(facts(ready([JUSPAY])), facts(ready([JUSPAY], PKG, true))),
    ).toBe(false);
  });
});

describe("receiptSet — a receipt paired with the set that landed", () => {
  it("encodes a receipt's set as landedFacts encodes a ready status's", () => {
    const delivered = [
      {
        reference: JUSPAY_PROFILE,
        name: "juspay",
        rev: "a".repeat(40),
        path: "/nix/store/p-juspay",
      },
    ];
    const facts = landedFacts({
      kind: "ready",
      profiles: [JUSPAY_PROFILE],
      bundle: "/nix/store/b-agent-distro",
      delivered,
      delivering: false,
    });
    expect(
      receiptSet({
        bundle: "/nix/store/b-agent-distro",
        versions: [],
        profiles: delivered,
        events: [],
      }),
    ).toBe(facts?.set);
  });

  it("is undefined for a receipt with nothing serving", () => {
    expect(
      receiptSet({ versions: [], profiles: [], events: [] }),
    ).toBeUndefined();
  });
});

describe("a history line from before agent-distro was one package", () => {
  it("names the profile it was about, in the row and its hover", () => {
    const detail = agentHostDetail({
      host: {
        label: "box",
        status: {
          kind: "ready",
          profiles: [],
          bundle: "/nix/store/nd11nx5f1dkf02cr9dhxqq4axg23vzgc-agent-distro",
          delivered: [],
          delivering: false,
        },
        checking: false,
        receipt: {
          bundle: "/nix/store/nd11nx5f1dkf02cr9dhxqq4axg23vzgc-agent-distro",
          versions: [],
          profiles: [],
          events: [
            {
              at: "2026-10-06T22:07:03-04:00",
              kind: "updated",
              words: "Pi 1.0 → 1.1",
              profile: "vanilla",
            },
          ],
        },
        ago: () => "1d ago",
      },
      setting: { enabled: true, profiles: [] },
    });
    expect(detail?.events[0]?.text).toBe("vanilla · Pi 1.0 → 1.1");
    expect(detail?.events[0]?.title).toContain("vanilla · Pi 1.0 → 1.1");
  });
});
