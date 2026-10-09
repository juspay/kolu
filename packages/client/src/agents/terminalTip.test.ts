import type { AgentInfo } from "@kolu/terminal-vocab/schema";
import { describe, expect, it } from "vitest";
import {
  type TerminalTipFacts,
  terminalTip,
  tileTipSentence,
} from "./terminalTip";

const KOLU = {
  name: "kolu",
  blurb: "drive one AI agent from another through kolu's terminals",
};

const LISTING: TerminalTipFacts["listing"] = {
  kind: "available",
  profiles: [
    {
      name: "vanilla",
      description: "Upstream harnesses",
      harnesses: [
        { name: "claude", title: "Claude Code", version: "2.1.292" },
        { name: "codex", title: "Codex", version: "0.112.0" },
        { name: "opencode", title: "opencode", version: "1.0.0" },
        { name: "pi", title: "Pi", version: "0.9.0" },
        { name: "omp", title: "Oh My Pi", version: "0.3.0" },
        { name: "opencode2", title: "OpenCode v2", version: "2.0.25" },
      ],
    },
  ],
};

const AGENTS = { profile: "vanilla", bundle: "/nix/store/abc-vanilla" };
const REPO: TerminalTipFacts["git"] = {
  kind: "repo",
  info: {
    repoRoot: "/src/kolu",
    repoName: "kolu",
    worktreePath: "/src/kolu",
    branch: "master",
    isWorktree: false,
    mainRepoRoot: "/src/kolu",
    remoteUrl: null,
  },
};
const NO_REPO: TerminalTipFacts["git"] = { kind: "none" };
const SHELL: TerminalTipFacts["foreground"] = {
  name: "zsh",
  title: null,
  shell: true,
};

/** `name` in front of the shell — a harness, or any other program. */
const running = (name: string): TerminalTipFacts["foreground"] => ({
  name,
  title: null,
  shell: false,
});

const agent = (
  kind: AgentInfo["kind"],
  state: AgentInfo["state"],
): TerminalTipFacts["agent"] => ({ kind, state });

const facts = (over: Partial<TerminalTipFacts> = {}): TerminalTipFacts => ({
  active: true,
  git: REPO,
  foreground: SHELL,
  agent: null,
  promptedAt: null,
  agents: AGENTS,
  listing: LISTING,
  skill: KOLU,
  ...over,
});

/** The tip's id, words, chips and source, or `quiet: <why>`. */
function show(f: TerminalTipFacts) {
  const t = terminalTip(f);
  switch (t.kind) {
    case "tip":
      return {
        id: t.id,
        lead: t.lead,
        rest: t.rest,
        chips: t.chips,
        source: t.source,
      };
    case "quiet":
      return { quiet: t.why };
  }
}

const HARNESSES = ["claude", "codex", "opencode", "pi", "omp", "opencode2"];

describe("terminalTip — launch an agent (the shell in front, in a repo)", () => {
  it("one chip per harness of the profile, in the listing's order, each launching its own", () => {
    expect(show(facts())).toEqual({
      id: "tip-launch-agent",
      lead: "Launch an agent",
      rest: "",
      chips: HARNESSES.map((harness) => ({
        label: harness,
        action: { kind: "launch", harness },
      })),
      source: { kind: "agent-distro", profile: "vanilla" },
    });
  });

  it("offers only the terminal's own profile", () => {
    const listing: TerminalTipFacts["listing"] = {
      kind: "available",
      profiles: [
        ...(LISTING.kind === "available" ? LISTING.profiles : []),
        {
          name: "juspay",
          description: "Juspay's set",
          harnesses: [{ name: "omp", title: "Oh My Pi", version: "0.3.0" }],
        },
      ],
    };
    expect(
      show(
        facts({
          listing,
          agents: { profile: "juspay", bundle: "/nix/store/x" },
        }),
      ),
    ).toMatchObject({
      chips: [{ label: "omp", action: { kind: "launch", harness: "omp" } }],
      source: { kind: "agent-distro", profile: "juspay" },
    });
  });

  it("the whole sentence reads lead, then the chips", () => {
    const t = terminalTip(facts());
    if (t.kind !== "tip") throw new Error("expected a tip");
    expect(tileTipSentence(t)).toBe(
      "Launch an agent: claude, codex, opencode, pi, omp, opencode2",
    );
  });

  it("outside a repo there is no tip (the cd tip is gone)", () => {
    expect(show(facts({ git: NO_REPO }))).toEqual({
      quiet: "not in a git repo",
    });
  });

  it("an unresolved git is quiet", () => {
    expect(show(facts({ git: { kind: "unresolved" } }))).toEqual({
      quiet: "git not resolved yet",
    });
  });
});

describe("terminalTip — try a skill (a harness of the profile in front, no live turn yet)", () => {
  const SKILL = {
    lead: "Try a skill",
    rest: "— drive one AI agent from another through kolu's terminals",
    chips: [{ label: "/kolu", action: { kind: "insert", text: "/kolu " } }],
    source: { kind: "kolu-plugin" },
  };

  it("a harness in front with no agent detected yet: shows (the moment it starts)", () => {
    expect(show(facts({ foreground: running("omp") }))).toEqual({
      id: "tip-skill:omp",
      ...SKILL,
    });
  });

  it("a harness in front, the agent detected waiting and never prompted: shows", () => {
    expect(
      show(
        facts({
          foreground: running("claude"),
          agent: agent("claude-code", "waiting"),
        }),
      ),
    ).toEqual({ id: "tip-skill:claude", ...SKILL });
  });

  it("promptedAt stamped: quiet", () => {
    expect(
      show(
        facts({
          foreground: running("claude"),
          agent: agent("claude-code", "waiting"),
          promptedAt: 1000,
        }),
      ),
    ).toEqual({ quiet: "the first prompt went out" });
  });

  it("the agent at work or asking: quiet", () => {
    for (const state of ["thinking", "tool_use", "running_background"] as const)
      expect(
        show(
          facts({
            foreground: running("claude"),
            agent: agent("claude-code", state),
          }),
        ),
      ).toEqual({ quiet: "claude is working" });
    expect(
      show(
        facts({
          foreground: running("claude"),
          agent: agent("claude-code", "awaiting_user"),
        }),
      ),
    ).toEqual({ quiet: "claude is asking you something" });
  });

  it("the foreground back to the shell: the skill tip goes (the launch tip returns in a repo)", () => {
    expect(
      show(facts({ foreground: SHELL, git: NO_REPO, agent: null })),
    ).toEqual({ quiet: "not in a git repo" });
    expect(show(facts({ foreground: SHELL }))).toMatchObject({
      id: "tip-launch-agent",
    });
  });

  it("a program that is not a harness of the profile in front: quiet", () => {
    for (const name of ["vim", "ssh", "make"])
      expect(show(facts({ foreground: running(name) }))).toEqual({
        quiet: `${name} is running`,
      });
  });

  it("a harness of another profile in front: quiet", () => {
    const listing: TerminalTipFacts["listing"] = {
      kind: "available",
      profiles: [
        {
          name: "juspay",
          description: "Juspay's set",
          harnesses: [{ name: "omp", title: "Oh My Pi", version: "0.3.0" }],
        },
      ],
    };
    expect(
      show(
        facts({
          listing,
          agents: { profile: "juspay", bundle: "/nix/store/x" },
          foreground: running("claude"),
        }),
      ),
    ).toEqual({ quiet: "claude is running" });
  });

  it("does not need a repo", () => {
    expect(
      show(facts({ foreground: running("pi"), git: NO_REPO })),
    ).toMatchObject({ id: "tip-skill:pi" });
  });

  it("every harness the listing names inserts the slash command, no Enter", () => {
    for (const harness of HARNESSES)
      expect(show(facts({ foreground: running(harness) }))).toEqual({
        id: `tip-skill:${harness}`,
        ...SKILL,
      });
  });

  it("a harness name with no invocation decided throws rather than guess", () => {
    const listing: TerminalTipFacts["listing"] = {
      kind: "available",
      profiles: [
        {
          name: "vanilla",
          description: "d",
          harnesses: [{ name: "newagent", title: "New", version: "1" }],
        },
      ],
    };
    expect(() =>
      terminalTip(facts({ listing, foreground: running("newagent") })),
    ).toThrow(/no invocation decided for harness newagent/);
  });
});

describe("terminalTip — the active tile only", () => {
  it("on every tile but the active one", () => {
    expect(show(facts({ active: false }))).toEqual({
      quiet: "not the active tile",
    });
    expect(
      show(facts({ active: false, foreground: running("claude") })),
    ).toEqual({ quiet: "not the active tile" });
  });

  it("the state is asked first: no tip to show is quiet for that reason", () => {
    expect(show(facts({ active: false, git: { kind: "unresolved" } }))).toEqual(
      { quiet: "git not resolved yet" },
    );
  });
});

describe("terminalTip — quiet", () => {
  it("before the foreground is first sampled", () => {
    expect(show(facts({ foreground: null }))).toEqual({
      quiet: "foreground not sampled yet",
    });
  });

  it("listing pending", () => {
    expect(show(facts({ listing: undefined }))).toEqual({
      quiet: "the agents listing is pending",
    });
  });

  it("built without agents", () => {
    expect(show(facts({ listing: { kind: "unavailable" } }))).toMatchObject({
      quiet: expect.stringContaining("without agents"),
    });
  });

  it("profile unknown to the listing", () => {
    expect(
      show(facts({ agents: { profile: "juspay", bundle: "/nix/store/x" } })),
    ).toEqual({ quiet: "profile juspay is not in the listing" });
  });

  it("no agents on this terminal: neither tip", () => {
    expect(show(facts({ agents: undefined }))).toEqual({
      quiet: "no agents on this terminal",
    });
    expect(
      show(facts({ agents: undefined, foreground: running("claude") })),
    ).toEqual({ quiet: "no agents on this terminal" });
  });
});

describe("terminalTip — broken invariants throw", () => {
  it("a listed profile with no harness", () => {
    const empty: TerminalTipFacts["listing"] = {
      kind: "available",
      profiles: [{ name: "vanilla", description: "d", harnesses: [] as never }],
    };
    expect(() => terminalTip(facts({ listing: empty }))).toThrow(/no harness/);
  });
});
