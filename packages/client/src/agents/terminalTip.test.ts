import type { AgentInfo } from "@kolu/terminal-vocab/schema";
import { describe, expect, it } from "vitest";
import { tileTipSentence } from "../settings/tips";
import { type TerminalTipFacts, terminalTip } from "./terminalTip";

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
  skills: [KOLU],
  ...over,
});

/** The tip's id, words, chips and source, or `quiet: <why>`. */
function show(f: TerminalTipFacts) {
  const t = terminalTip(f);
  switch (t.kind) {
    case "tip":
      return {
        id: t.id,
        lead: t.copy.lead,
        rest: t.copy.rest,
        chips: t.chips,
        source: t.source,
      };
    case "quiet":
      return { quiet: t.why };
  }
}

describe("terminalTip — the rungs", () => {
  it("rung 1: a shell outside a repo is told to cd into one; the chip picks a recent repo", () => {
    expect(show(facts({ git: NO_REPO }))).toEqual({
      id: "tip-cd-repo",
      lead: "Start in a project",
      rest: "into a git repo",
      chips: [{ label: "cd", action: { kind: "pick-repo" } }],
      source: { kind: "none" },
    });
  });

  it("rung 1 shows with no agents too", () => {
    expect(show(facts({ git: NO_REPO, agents: undefined }))).toMatchObject({
      id: "tip-cd-repo",
    });
  });

  it("rung 2: one chip per harness of the profile, in the listing's order, each launching its own", () => {
    expect(show(facts())).toEqual({
      id: "tip-launch-agent",
      lead: "Launch an agent",
      rest: "",
      chips: ["claude", "codex", "opencode", "pi", "omp"].map((harness) => ({
        label: harness,
        action: { kind: "launch", harness },
      })),
      source: { kind: "agent-distro", profile: "vanilla" },
    });
  });

  it("rung 2 offers only the terminal's own profile", () => {
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

  it("rung 3, Claude Code: the chip inserts the slash command, no Enter", () => {
    expect(show(facts({ agent: agent("claude-code", "waiting") }))).toEqual({
      id: "tip-skill:claude-code",
      lead: "Try a skill",
      rest: "— drive one AI agent from another through kolu's terminals",
      chips: [{ label: "/kolu", action: { kind: "insert", text: "/kolu " } }],
      source: { kind: "kolu-plugin" },
    });
  });

  it("rung 3, every other agent: the chip, labelled with the skill's name, inserts the start of a request in words, no Enter", () => {
    for (const kind of [
      "codex",
      "opencode",
      "grok",
      "pi",
      "omp",
      "xyne",
    ] as const)
      expect(show(facts({ agent: agent(kind, "waiting") }))).toMatchObject({
        id: `tip-skill:${kind}`,
        chips: [
          {
            label: "kolu",
            action: { kind: "insert", text: "Use the kolu skill to " },
          },
        ],
      });
  });

  it("the whole sentence reads lead, chips, rest", () => {
    const t = terminalTip(facts());
    if (t.kind !== "tip") throw new Error("expected a tip");
    expect(tileTipSentence(t.copy)).toBe(
      "Launch an agent: claude, codex, opencode, pi, omp",
    );
    const t1 = terminalTip(facts({ git: NO_REPO }));
    if (t1.kind !== "tip") throw new Error("expected a tip");
    expect(tileTipSentence(t1.copy)).toBe(
      "Start in a project: cd into a git repo",
    );
  });
});

describe("terminalTip — the active tile only", () => {
  it("on every tile but the active one", () => {
    expect(show(facts({ active: false }))).toEqual({
      quiet: "not the active tile",
    });
    expect(
      show(facts({ active: false, agent: agent("claude-code", "waiting") })),
    ).toEqual({ quiet: "not the active tile" });
  });

  it("the state is asked first: no tip to show is quiet for that reason", () => {
    expect(show(facts({ active: false, git: { kind: "unresolved" } }))).toEqual(
      { quiet: "git not resolved yet" },
    );
  });
});

describe("terminalTip — the shell must be in front for rungs 1 and 2", () => {
  it("ssh or vim outside a repo hides rung 1", () => {
    for (const name of ["ssh", "vim"])
      expect(
        show(
          facts({
            git: NO_REPO,
            foreground: { name, title: null, shell: false },
          }),
        ),
      ).toEqual({ quiet: "a command is running" });
  });

  it("a running command in a repo hides rung 2", () => {
    expect(
      show(facts({ foreground: { name: "make", title: null, shell: false } })),
    ).toEqual({ quiet: "a command is running" });
  });

  it("before the foreground is first sampled", () => {
    expect(show(facts({ foreground: null }))).toEqual({
      quiet: "foreground not sampled yet",
    });
  });

  it("rung 3 does not ask about the shell", () => {
    expect(
      show(
        facts({
          agent: agent("claude-code", "waiting"),
          foreground: { name: "claude", title: null, shell: false },
        }),
      ),
    ).toMatchObject({ id: "tip-skill:claude-code" });
  });
});

describe("terminalTip — git not resolved is not 'no repo'", () => {
  it("an unresolved git is quiet, not rung 1", () => {
    expect(show(facts({ git: { kind: "unresolved" } }))).toEqual({
      quiet: "git not resolved yet",
    });
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

  it("no plugin skill at an agent's first prompt", () => {
    expect(() =>
      terminalTip(
        facts({ agent: agent("claude-code", "waiting"), skills: [] }),
      ),
    ).toThrow(/no plugin skill/);
  });
});

describe("terminalTip — quiet", () => {
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

  it("no agents on this terminal: rung 2 and rung 3 stay quiet", () => {
    expect(show(facts({ agents: undefined }))).toEqual({
      quiet: "no agents on this terminal",
    });
    expect(
      show(
        facts({ agents: undefined, agent: agent("claude-code", "waiting") }),
      ),
    ).toEqual({ quiet: "no agents on this terminal" });
  });

  it("an agent working, or asking you something", () => {
    for (const state of ["thinking", "tool_use", "running_background"] as const)
      expect(show(facts({ agent: agent("claude-code", state) }))).toEqual({
        quiet: "claude-code is working",
      });
    expect(
      show(facts({ agent: agent("claude-code", "awaiting_user") })),
    ).toEqual({ quiet: "claude-code is asking you something" });
  });

  it("an agent that already took its first prompt", () => {
    expect(
      show(facts({ agent: agent("claude-code", "waiting"), promptedAt: 1000 })),
    ).toEqual({ quiet: "the first prompt went out" });
  });
});
