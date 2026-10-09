import type { AgentInfo } from "@kolu/terminal-vocab/schema";
import { describe, expect, it } from "vitest";
import { tileTipText } from "../settings/tips";
import {
  type TerminalTipFacts,
  TIP_MIN_SLOT_PX,
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
  onScreen: true,
  slotPx: 400,
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

/** The tip's id and pill text, `hidden: <why>` (with the tip it holds back),
 *  or `quiet: <why>`. */
function show(
  f: TerminalTipFacts,
  seen: ReadonlySet<string> = NONE,
  showing: string | null = null,
) {
  const t = terminalTip(f, seen, showing);
  switch (t.kind) {
    case "tip":
      return { id: t.id, text: tileTipText(t.copy.parts) };
    case "hidden":
      return { hidden: t.why, id: t.id };
    case "quiet":
      return { quiet: t.why };
  }
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
      text: "Launch claude or agent-distro",
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

describe("terminalTip — the hover sentence", () => {
  const sentence = (f: TerminalTipFacts) => {
    const t = terminalTip(f, NONE, null);
    if (t.kind !== "tip") throw new Error(`no tip: ${t.why}`);
    return t.copy.sentence;
  };
  it("each rung's hover says the whole thing", () => {
    expect(sentence(facts({ git: NO_REPO }))).toBe(
      "Start in a project: cd into a git repo",
    );
    expect(sentence(facts())).toBe(
      "Launch an agent: claude, or agent-distro to pick one",
    );
    expect(sentence(facts({ agent: agent("claude-code", "waiting") }))).toBe(
      "Try a skill: type /kolu at the prompt — drive one AI agent from another through kolu's terminals",
    );
    expect(sentence(facts({ agent: agent("codex", "waiting") }))).toBe(
      "Try a skill: ask the agent to use the kolu skill — drive one AI agent from another through kolu's terminals",
    );
  });
});

describe("terminalTip — hidden: the tip is there, but nobody could see it", () => {
  const at = (place: Partial<TerminalTipFacts["place"]>) =>
    show(facts({ place: { ...PLACE, ...place } }));

  it("until the saved seen-list has arrived (it cannot say seen yet)", () => {
    expect(at({ seenTipsLoaded: false })).toEqual({
      hidden: "preferences pending",
      id: "tip-launch-agent",
    });
  });

  it("on every tile but the active one", () => {
    expect(at({ active: false })).toEqual({
      hidden: "not the active tile",
      id: "tip-launch-agent",
    });
  });

  it("on a tile off-screen", () => {
    expect(at({ onScreen: false })).toEqual({
      hidden: "off-screen",
      id: "tip-launch-agent",
    });
  });

  it("in a slot too narrow to read, and before it is measured", () => {
    expect(at({ slotPx: TIP_MIN_SLOT_PX - 1 })).toEqual({
      hidden: "too narrow",
      id: "tip-launch-agent",
    });
    expect(at({ slotPx: TIP_MIN_SLOT_PX })).toMatchObject({
      id: "tip-launch-agent",
      text: expect.any(String),
    });
    expect(at({ slotPx: null })).toEqual({
      hidden: "tip slot not measured yet",
      id: "tip-launch-agent",
    });
  });

  it("is asked before seen: a seen tip out of sight is hidden, not quiet", () => {
    // So a tile showing a tip keeps it while out of sight.
    expect(
      show(
        facts({ place: { ...PLACE, active: false } }),
        new Set(["tip-launch-agent"]),
      ),
    ).toEqual({ hidden: "not the active tile", id: "tip-launch-agent" });
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
      ).toEqual({ hidden: "a command is running", id: "tip-cd-repo" });
  });

  it("a running command in a repo hides rung 2", () => {
    expect(
      show(facts({ foreground: { name: "make", title: null, shell: false } })),
    ).toEqual({ hidden: "a command is running", id: "tip-launch-agent" });
  });

  it("before the foreground is first sampled", () => {
    expect(show(facts({ foreground: null }))).toEqual({
      hidden: "foreground not sampled yet",
      id: "tip-launch-agent",
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
    ).toMatchObject({ id: "tip-skill:claude-code", text: expect.any(String) });
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
