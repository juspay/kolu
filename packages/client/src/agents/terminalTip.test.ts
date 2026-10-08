import { describe, expect, it } from "vitest";
import type { AgentInfo } from "@kolu/terminal-vocab/schema";
import { tileTipText } from "../settings/tips";
import {
  TIP_MIN_TITLE_BAR_PX,
  type TerminalTipFacts,
  terminalTip,
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
const PLACE: TerminalTipFacts["place"] = {
  seenTipsLoaded: true,
  active: true,
  titleBarPx: 800,
};

const agent = (
  kind: AgentInfo["kind"],
  state: AgentInfo["state"],
): TerminalTipFacts["agent"] => ({ kind, state });

const facts = (over: Partial<TerminalTipFacts> = {}): TerminalTipFacts => ({
  place: PLACE,
  git: REPO,
  foreground: SHELL,
  agent: null,
  promptedAt: null,
  agents: AGENTS,
  listing: LISTING,
  skills: [KOLU],
  ...over,
});

const NONE = new Set<string>();

/** The tip's id and plain text, or `quiet: <why>`. */
function show(
  f: TerminalTipFacts,
  seen: ReadonlySet<string> = NONE,
  showing: string | null = null,
) {
  const t = terminalTip(f, seen, showing);
  return t.kind === "tip"
    ? { id: t.id, text: tileTipText(t.parts) }
    : { quiet: t.why };
}

describe("terminalTip — the rungs", () => {
  it("rung 1: a shell outside a repo is told to cd into one", () => {
    expect(show(facts({ git: NO_REPO }))).toEqual({
      id: "tip-cd-repo",
      text: "Start in a project: cd into a git repo",
    });
  });

  it("rung 1 shows with no agents too", () => {
    expect(show(facts({ git: NO_REPO, agents: undefined }))).toMatchObject({
      id: "tip-cd-repo",
    });
  });

  it("rung 2: a shell in a repo with agents is told the first harness", () => {
    expect(show(facts())).toEqual({
      id: "tip-launch-agent",
      text: "Launch claude, or agent-distro to pick",
    });
  });

  it("rung 3, Claude Code: the skill as a slash command", () => {
    expect(show(facts({ agent: agent("claude-code", "waiting") }))).toEqual({
      id: "tip-skill:claude-code",
      text: "Try a skill: /kolu — drive one AI agent from another through kolu's terminals",
    });
  });

  it("rung 3, any other agent: the skill asked for in words", () => {
    expect(show(facts({ agent: agent("codex", "waiting") }))).toEqual({
      id: "tip-skill:codex",
      text: "Try a skill: ask it to use the kolu skill — drive one AI agent from another through kolu's terminals",
    });
  });
});

describe("terminalTip — where it would show", () => {
  it("is quiet until the saved seen-list has arrived (it cannot say seen yet)", () => {
    expect(show(facts({ place: { ...PLACE, seenTipsLoaded: false } }))).toEqual(
      { quiet: "preferences pending" },
    );
  });

  it("is quiet on every tile but the active one", () => {
    expect(show(facts({ place: { ...PLACE, active: false } }))).toEqual({
      quiet: "not the active tile",
    });
  });

  it("is quiet on a title bar too narrow for it, and before it is measured", () => {
    expect(
      show(
        facts({ place: { ...PLACE, titleBarPx: TIP_MIN_TITLE_BAR_PX - 1 } }),
      ),
    ).toEqual({ quiet: "too narrow" });
    expect(
      show(facts({ place: { ...PLACE, titleBarPx: TIP_MIN_TITLE_BAR_PX } })),
    ).toMatchObject({ id: "tip-launch-agent" });
    expect(show(facts({ place: { ...PLACE, titleBarPx: null } }))).toEqual({
      quiet: "title bar not measured yet",
    });
  });
});

describe("terminalTip — the shell must be in front for rungs 1 and 2", () => {
  it("ssh or vim outside a repo is not told to cd", () => {
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

  it("a running command in a repo is not told to launch an agent", () => {
    expect(
      show(facts({ foreground: { name: "make", title: null, shell: false } })),
    ).toEqual({ quiet: "a command is running" });
  });

  it("is quiet before the foreground is first sampled", () => {
    expect(show(facts({ foreground: null }))).toEqual({
      quiet: "foreground not sampled yet",
    });
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
    expect(() => terminalTip(facts({ listing: empty }), NONE, null)).toThrow(
      /no harness/,
    );
  });

  it("no plugin skill at an agent's first prompt", () => {
    expect(() =>
      terminalTip(
        facts({ agent: agent("claude-code", "waiting"), skills: [] }),
        NONE,
        null,
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

describe("terminalTip — once", () => {
  it("each rung is quiet once seen", () => {
    expect(show(facts({ git: NO_REPO }), new Set(["tip-cd-repo"]))).toEqual({
      quiet: "tip-cd-repo already seen",
    });
    expect(show(facts(), new Set(["tip-launch-agent"]))).toEqual({
      quiet: "tip-launch-agent already seen",
    });
    expect(
      show(
        facts({ agent: agent("claude-code", "waiting") }),
        new Set(["tip-skill:claude-code"]),
      ),
    ).toEqual({ quiet: "tip-skill:claude-code already seen" });
  });

  it("dismissing rung 1 does not skip rung 2", () => {
    expect(show(facts(), new Set(["tip-cd-repo"]))).toMatchObject({
      id: "tip-launch-agent",
    });
  });

  it("the tip a tile is showing is exempt from its own seen mark", () => {
    expect(
      show(facts(), new Set(["tip-launch-agent"]), "tip-launch-agent"),
    ).toMatchObject({ id: "tip-launch-agent" });
    // ...but only that one: showing rung 1 does not exempt rung 2.
    expect(show(facts(), new Set(["tip-launch-agent"]), "tip-cd-repo")).toEqual(
      { quiet: "tip-launch-agent already seen" },
    );
  });

  it("rung 3 is once per agent kind: Claude Code seen, Codex still shows", () => {
    const seen = new Set(["tip-skill:claude-code"]);
    expect(
      show(facts({ agent: agent("codex", "waiting") }), seen),
    ).toMatchObject({ id: "tip-skill:codex" });
  });
});
