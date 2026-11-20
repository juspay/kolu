import type { ConductorWakeLevel } from "kolu-common/conductor";
import { describe, expect, it, vi } from "vitest";
import { holding } from "@kolu/acp-harness";
import { wakeText } from "./wakeText.ts";
import type { WatchLevel } from "./observation.ts";
import {
  joinedMember,
  type MemberState,
  type MemberWatch,
  observed as observedMember,
  restoredMember,
  spokenTo as spokenToMember,
  type WatchJoin,
} from "./members.ts";

const REF = "local/11111111-1111-4111-8111-111111111111";
const OTHER = "remote:prod/22222222-2222-4222-8222-222222222222";

type WatchEntry = MemberState;

const watchEntry = (_ref: string, joined: WatchJoin): WatchEntry =>
  joinedMember(joined);

const restoredEntry = (saved: MemberWatch): WatchEntry => restoredMember(saved);

const spokenTo = (entry: WatchEntry): WatchEntry => spokenToMember(entry);

const observed = (
  entry: WatchEntry,
  seen: Parameters<typeof observedMember>[1],
): { entry: WatchEntry; ring: ConductorWakeLevel | null; drop: boolean } => {
  const read = observedMember(entry, seen);
  return { entry: read.member, ring: read.ring, drop: read.drop };
};

const seenOf = (
  entries: Iterable<[string, WatchEntry]>,
): ReadonlyArray<{ terminal: string; level: WatchLevel; since: string }> => {
  const rows: { terminal: string; level: WatchLevel; since: string }[] = [];
  for (const [terminal, entry] of entries) {
    if (entry.last === null) continue;
    rows.push({ terminal, level: entry.last.level, since: entry.last.since });
  }
  return rows;
};

const seeing = (
  ref: string,
  level: WatchLevel,
  over: {
    name?: string;
    agent?: string | null;
    foregroundShell?: boolean | null;
    worktree?: string;
  } = {},
) => ({
  ref,
  host: ref.slice(0, ref.lastIndexOf("/")),
  terminalId: ref.slice(ref.lastIndexOf("/") + 1),
  hostName: "box",
  name: over.name ?? "fix the parser",
  agent: over.agent === undefined ? "claude-code" : over.agent,
  level,
  foregroundShell: over.foregroundShell ?? null,
  git:
    over.worktree === undefined
      ? null
      : { worktree: over.worktree, branch: "work", repo: "/repo" },
  pr: null,
});

const HERE = "the conversation";

const put = (
  held: ReturnType<typeof holding<string, string>>,
  ref: string,
  value: string,
): void => held.hold(HERE, ref, value, ref);

describe("the held news", () => {
  it("replaces one terminal's slot IN PLACE, keeping the position it first took", () => {
    const held = holding<string, string>({ keyOf: () => HERE });
    put(held, REF, "stopped");
    put(held, OTHER, "asking");
    put(held, REF, "gone");
    expect(held.refs(HERE)).toEqual([REF, OTHER]);
    expect(held.waiting(HERE).map((slot) => slot.value)).toEqual([
      "gone",
      "asking",
    ]);
  });

  it("withdraws a terminal that went back to working", () => {
    const held = holding<string, string>({ keyOf: () => HERE });
    put(held, REF, "stopped");
    expect(held.withdraw(HERE, REF)).toBe(true);
    expect(held.withdraw(HERE, REF)).toBe(false);
    expect(held.refs(HERE)).toEqual([]);
  });

  it("takes BY IDENTITY, so news that landed mid-delivery is not dropped", () => {
    const held = holding<string, string>({ keyOf: () => HERE });
    put(held, REF, "stopped");
    const taken = held.waiting(HERE);

    put(held, REF, "gone");
    held.took(HERE, taken);
    expect(held.waiting(HERE).map((slot) => slot.value)).toEqual(["gone"]);
  });
});

describe("what is worth waking the Conductor about", () => {
  const fresh = (joined: WatchJoin = "created"): WatchEntry =>
    watchEntry(REF, joined);

  const briefed = (): WatchEntry =>
    spokenTo(observed(fresh(), seeing(REF, "working")).entry);

  it("rings READY for an idle agent nobody has briefed — the INFERENCE", () => {
    const up = observed(fresh(), seeing(REF, "stopped"));

    expect(up.ring).toBe("ready");

    expect(up.entry.told).toBeNull();
    const toldAlready: WatchEntry = { ...up.entry, told: "ready" };
    expect(observed(toldAlready, seeing(REF, "stopped")).ring).toBeNull();
  });

  it("says nothing while an agent is COMING UP, and rings READY once it is", () => {
    const coming = observed(fresh(), seeing(REF, "starting"));
    expect(coming.ring).toBeNull();

    expect(coming.entry.agent).toBe("claude-code");

    const up = observed(coming.entry, seeing(REF, "fresh"));
    expect(up.ring).toBe("ready");

    const toldAlready: WatchEntry = { ...up.entry, told: "ready" };
    expect(observed(toldAlready, seeing(REF, "fresh")).ring).toBeNull();
  });

  it("does not ring a SECOND ready when the fresh agent's transcript lands", () => {
    const up = observed(fresh(), seeing(REF, "fresh"));
    expect(up.ring).toBe("ready");
    const told: WatchEntry = { ...up.entry, told: "ready" };
    expect(observed(told, seeing(REF, "stopped")).ring).toBeNull();
  });

  it("says nothing about a FRESH agent the Conductor has just spoken to", () => {
    const up = observed(fresh(), seeing(REF, "fresh"));
    const said = spokenTo({ ...up.entry, told: "ready" });
    expect(said.spoken).toBe(true);
    expect(said.told).toBe("stopped");
    expect(observed(said, seeing(REF, "fresh")).ring).toBeNull();

    const worked = observed(said, seeing(REF, "working")).entry;
    expect(observed(worked, seeing(REF, "stopped")).ring).toBe("stopped");
  });

  it("a submit that came to nothing is a STOP, never a second `ready`", () => {
    const up = observed(fresh(), seeing(REF, "fresh"));
    const said = spokenTo({ ...up.entry, told: "ready" });
    const prompted = observed(said, seeing(REF, "working")).entry;
    expect(observed(prompted, seeing(REF, "fresh")).ring).toBe("stopped");
  });

  it("BASELINES an asked terminal whose agent has only just come up", () => {
    const asked = observed(fresh("asked"), seeing(REF, "fresh"));
    expect(asked.ring).toBeNull();
    expect(asked.entry.spoken).toBe(true);
    expect(asked.entry.told).toBe("stopped");
  });

  it("rings on a stop once the agent has been spoken to, and not twice", () => {
    const first = observed(briefed(), seeing(REF, "stopped"));
    expect(first.ring).toBe("stopped");
    const toldAlready: WatchEntry = { ...first.entry, told: "stopped" };
    expect(observed(toldAlready, seeing(REF, "stopped")).ring).toBeNull();
  });

  it("says nothing about the state a terminal was in when it was spoken to", () => {
    const ready = observed(fresh(), seeing(REF, "stopped")).entry;
    const said = spokenTo({ ...ready, told: "ready" });
    expect(said.spoken).toBe(true);

    expect(said.told).toBe("stopped");
    expect(observed(said, seeing(REF, "stopped")).ring).toBeNull();

    const worked = observed(said, seeing(REF, "working")).entry;
    expect(observed(worked, seeing(REF, "stopped")).ring).toBe("stopped");
  });

  it("BASELINES a terminal somebody asked to watch, and rings after that", () => {
    const asked = observed(fresh("asked"), seeing(REF, "stopped"));

    expect(asked.ring).toBeNull();
    expect(asked.entry.told).toBe("stopped");

    expect(asked.entry.spoken).toBe(true);
    expect(observed(asked.entry, seeing(REF, "asking")).ring).toBe("asking");
  });

  it("baselines an ASKED terminal with no agent in it without claiming one was spoken to", () => {
    const asked = observed(
      fresh("asked"),
      seeing(REF, "shell", { agent: null, foregroundShell: true }),
    );
    expect(asked.ring).toBeNull();
    expect(asked.entry.spoken).toBe(false);
    expect(asked.entry.told).toBeNull();
  });

  it("rings on a question, even for a terminal already told about a stop", () => {
    const stopped: WatchEntry = { ...briefed(), told: "stopped" };
    expect(observed(stopped, seeing(REF, "asking")).ring).toBe("asking");
  });

  it("forgets what it was told when the agent goes back to work", () => {
    const stopped: WatchEntry = { ...briefed(), told: "stopped" };
    const back = observed(stopped, seeing(REF, "working"));
    expect(back.ring).toBeNull();
    expect(back.entry.told).toBeNull();

    expect(observed(back.entry, seeing(REF, "stopped")).ring).toBe("stopped");
  });

  it("never rings about a shell, and never forgets the agent that was there", () => {
    const seenOnce = observed(briefed(), seeing(REF, "stopped")).entry;
    const shell = observed(seenOnce, seeing(REF, "shell", { agent: null }));
    expect(shell.ring).toBeNull();
    expect(shell.entry.agent).toBe("claude-code");
  });

  it("rings ASLEEP once for a terminal an agent was seen in, and keeps it listed", () => {
    const seenOnce = observed(briefed(), seeing(REF, "stopped")).entry;
    const slept = observed(seenOnce, seeing(REF, "asleep", { agent: null }));
    expect(slept.ring).toBe("asleep");

    expect(slept.drop).toBe(false);
    const toldAlready: WatchEntry = { ...slept.entry, told: "asleep" };
    expect(
      observed(toldAlready, seeing(REF, "asleep", { agent: null })).ring,
    ).toBeNull();
  });

  it("is silent about a terminal that was put to sleep with no agent in it", () => {
    const shell = observed(
      fresh(),
      seeing(REF, "shell", { agent: null, foregroundShell: true }),
    ).entry;
    expect(observed(shell, seeing(REF, "asleep", { agent: null })).ring).toBe(
      null,
    );
  });

  it("rings ENDED when a created command ran and came back to the prompt", () => {
    const made = fresh("created-run");
    const atPrompt = observed(
      made,
      seeing(REF, "shell", { agent: null, foregroundShell: true }),
    );
    expect(atPrompt.ring).toBeNull();
    expect(atPrompt.entry.ran).toBe(false);

    const running = observed(
      atPrompt.entry,
      seeing(REF, "shell", { agent: null, foregroundShell: false }),
    );
    expect(running.ring).toBeNull();
    expect(running.entry.ran).toBe(true);

    const ended = observed(
      running.entry,
      seeing(REF, "shell", { agent: null, foregroundShell: true }),
    );
    expect(ended.ring).toBe("ended");
    expect(ended.drop).toBe(false);

    const toldAlready: WatchEntry = { ...ended.entry, told: "ended" };
    expect(
      observed(
        toldAlready,
        seeing(REF, "shell", { agent: null, foregroundShell: true }),
      ).ring,
    ).toBeNull();
  });

  it("never rings ENDED for a terminal nobody ran a command in", () => {
    const made = fresh("created");
    const running = observed(
      made,
      seeing(REF, "shell", { agent: null, foregroundShell: false }),
    ).entry;
    expect(
      observed(
        running,
        seeing(REF, "shell", { agent: null, foregroundShell: true }),
      ).ring,
    ).toBeNull();
  });

  it("rings EXITED when an agent that was seen leaves the foreground", () => {
    const made = fresh("created-run");
    const agentUp = observed(made, seeing(REF, "working")).entry;
    expect(agentUp.ran).toBe(false);
    const exited = observed(
      agentUp,
      seeing(REF, "shell", { agent: null, foregroundShell: true }),
    );
    expect(exited.ring).toBe("exited");

    expect(exited.drop).toBe(false);
    expect(exited.entry.agent).toBe("claude-code");

    const toldAlready: WatchEntry = { ...exited.entry, told: "exited" };
    expect(
      observed(
        toldAlready,
        seeing(REF, "shell", { agent: null, foregroundShell: true }),
      ).ring,
    ).toBeNull();
  });

  it("rings EXITED for an agent seen only as a PRESENCE that then died", () => {
    const made = fresh("created-run");
    const coming = observed(made, seeing(REF, "starting")).entry;
    expect(coming.agent).toBe("claude-code");
    const exited = observed(
      coming,
      seeing(REF, "shell", { agent: null, foregroundShell: true }),
    );
    expect(exited.ring).toBe("exited");
  });

  it("says nothing when some OTHER program takes the foreground", () => {
    const made = fresh("created-run");
    const agentUp = observed(made, seeing(REF, "working")).entry;
    expect(
      observed(
        agentUp,
        seeing(REF, "shell", { agent: null, foregroundShell: false }),
      ).ring,
    ).toBeNull();
  });

  it("rings when a terminal that HELD an agent goes away, and drops it", () => {
    const seenOnce = observed(briefed(), seeing(REF, "stopped")).entry;
    const gone = observed(seenOnce, seeing(REF, "gone", { agent: null }));
    expect(gone.ring).toBe("gone");
    expect(gone.drop).toBe(true);
  });

  it("drops a terminal no agent was ever seen in, in silence", () => {
    const shell = observed(
      fresh(),
      seeing(REF, "shell", { agent: null }),
    ).entry;
    const gone = observed(shell, seeing(REF, "gone", { agent: null }));
    expect(gone.ring).toBeNull();
    expect(gone.drop).toBe(true);
  });

  it("is quiet across a restart about a state it has already been told", () => {
    const restored = restoredEntry({
      name: "fix the parser",
      agent: "claude-code",
      told: "asking",
      joined: "created",
      spoken: true,
      ran: false,
    });
    expect(observed(restored, seeing(REF, "asking")).ring).toBeNull();

    expect(observed(restored, seeing(REF, "stopped")).ring).toBe("stopped");
  });

  it("does NOT baseline a restored entry — news that never went is still owed", () => {
    const restored = restoredEntry({
      name: "fix the parser",
      agent: "claude-code",
      told: null,
      joined: "asked",
      spoken: true,
      ran: false,
    });
    expect(observed(restored, seeing(REF, "stopped")).ring).toBe("stopped");
  });

  it("remembers across a restart that nothing has been said to the agent yet", () => {
    const restored = restoredEntry({
      name: "fix the parser",
      agent: "claude-code",
      told: null,
      joined: "created",
      spoken: false,
      ran: true,
    });
    expect(observed(restored, seeing(REF, "stopped")).ring).toBe("ready");
  });
});

describe("every state the Conductor can wait in has a way out that rings", () => {
  interface Silent {
    readonly silent: string;
  }
  type Outcome = ConductorWakeLevel | Silent;

  type FromState =
    | "starting"
    | "fresh"
    | "prompted"
    | "working"
    | "asking"
    | "stoppedSpoken"
    | "stoppedUnspoken"
    | "asleep";

  type WayOut =
    | "starting"
    | "fresh"
    | "working"
    | "stopped"
    | "asking"
    | "shellAgentExited"
    | "shellOtherProgram"
    | "asleep"
    | "gone";

  const created = (): WatchEntry => watchEntry(REF, "created-run");

  const read = (entry: WatchEntry, way: WayOut): WatchEntry => {
    const seen = observed(entry, reading(way));
    return seen.ring === null ? seen.entry : { ...seen.entry, told: seen.ring };
  };

  const reading = (way: WayOut) => {
    switch (way) {
      case "shellAgentExited":
        return seeing(REF, "shell", { agent: null, foregroundShell: true });
      case "shellOtherProgram":
        return seeing(REF, "shell", { agent: null, foregroundShell: false });
      case "asleep":
        return seeing(REF, "asleep", { agent: null });
      case "gone":
        return seeing(REF, "gone", { agent: null });
      default:
        return seeing(REF, way);
    }
  };

  const FROM: Readonly<Record<FromState, () => WatchEntry>> = {
    starting: () => read(created(), "starting"),
    fresh: () => read(read(created(), "starting"), "fresh"),

    prompted: () => read(spokenTo(FROM.fresh()), "working"),
    working: () => read(spokenTo(FROM.fresh()), "working"),
    asking: () => read(FROM.working(), "asking"),
    stoppedSpoken: () => read(FROM.working(), "stopped"),

    stoppedUnspoken: () => read(created(), "stopped"),
    asleep: () => read(FROM.stoppedSpoken(), "asleep"),
  };

  const STILL_DRAWING: Silent = {
    silent: "a screen still being drawn is nothing anyone can act on",
  };
  const WORKING_IS_NOT_NEWS: Silent = {
    silent: "working is never news itself; it resets what we were told",
  };
  const OTHER_PROGRAM: Silent = {
    silent:
      "the agent did not leave — something it started is in front of it, and the prompt is not back",
  };
  const TOLD_READY: Silent = {
    silent: "the Conductor was already told this agent is up and unbriefed",
  };

  const TABLE: Readonly<Record<FromState, Readonly<Record<WayOut, Outcome>>>> =
    {
      starting: {
        starting: STILL_DRAWING,
        fresh: "ready",
        working: WORKING_IS_NOT_NEWS,

        stopped: "ready",
        asking: "asking",
        shellAgentExited: "exited",
        shellOtherProgram: OTHER_PROGRAM,
        asleep: "asleep",
        gone: "gone",
      },
      fresh: {
        starting: STILL_DRAWING,
        fresh: TOLD_READY,
        working: WORKING_IS_NOT_NEWS,
        stopped: TOLD_READY,
        asking: "asking",
        shellAgentExited: "exited",
        shellOtherProgram: OTHER_PROGRAM,
        asleep: "asleep",
        gone: "gone",
      },

      prompted: {
        starting: STILL_DRAWING,
        fresh: "stopped",
        working: WORKING_IS_NOT_NEWS,
        stopped: "stopped",
        asking: "asking",
        shellAgentExited: "exited",
        shellOtherProgram: OTHER_PROGRAM,
        asleep: "asleep",
        gone: "gone",
      },
      working: {
        starting: STILL_DRAWING,
        fresh: "stopped",
        working: WORKING_IS_NOT_NEWS,
        stopped: "stopped",
        asking: "asking",
        shellAgentExited: "exited",
        shellOtherProgram: OTHER_PROGRAM,
        asleep: "asleep",
        gone: "gone",
      },
      asking: {
        starting: STILL_DRAWING,
        fresh: "stopped",
        working: WORKING_IS_NOT_NEWS,
        stopped: "stopped",
        asking: { silent: "the same question, read again, is the same news" },
        shellAgentExited: "exited",
        shellOtherProgram: OTHER_PROGRAM,
        asleep: "asleep",
        gone: "gone",
      },
      stoppedSpoken: {
        starting: STILL_DRAWING,
        fresh: {
          silent:
            "idle again after what was said is the stop the Conductor was already told",
        },
        working: WORKING_IS_NOT_NEWS,
        stopped: { silent: "the same stop, read again, is the same news" },
        asking: "asking",
        shellAgentExited: "exited",
        shellOtherProgram: OTHER_PROGRAM,
        asleep: "asleep",
        gone: "gone",
      },
      stoppedUnspoken: {
        starting: STILL_DRAWING,
        fresh: TOLD_READY,
        working: WORKING_IS_NOT_NEWS,
        stopped: TOLD_READY,
        asking: "asking",
        shellAgentExited: "exited",
        shellOtherProgram: OTHER_PROGRAM,
        asleep: "asleep",
        gone: "gone",
      },
      asleep: {
        starting: STILL_DRAWING,

        fresh: "stopped",
        working: WORKING_IS_NOT_NEWS,
        stopped: "stopped",
        asking: "asking",
        shellAgentExited: "exited",
        shellOtherProgram: OTHER_PROGRAM,
        asleep: { silent: "it is still asleep; that was said when it slept" },
        gone: "gone",
      },
    };

  const STATES = Object.keys(TABLE) as ReadonlyArray<FromState>;

  for (const from of STATES) {
    const ways = TABLE[from];
    for (const way of Object.keys(ways) as ReadonlyArray<WayOut>) {
      const expected = ways[way];
      const said =
        typeof expected === "string"
          ? `rings ${expected}`
          : `is silent — ${expected.silent}`;
      it(`${from}, then ${way}: ${said}`, () => {
        const ring = observed(FROM[from](), reading(way)).ring;
        expect(ring).toBe(typeof expected === "string" ? expected : null);
      });
    }
  }

  it("leaves no state with nothing but silence ahead of it", () => {
    for (const from of STATES) {
      const rings = Object.values(TABLE[from]).filter(
        (outcome) => typeof outcome === "string",
      );
      expect(rings.length, `${from} has no way out that rings`).toBeGreaterThan(
        0,
      );
    }
  });
});

describe("how long a watched terminal has stood as it stands", () => {
  const restored = (): WatchEntry =>
    restoredEntry({
      name: "fix the parser",
      agent: "claude-code",
      told: "stopped",
      joined: "created",
      spoken: true,
      ran: false,
    });

  it("stamps the level a terminal ENTERED, and keeps the stamp while it stays there", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-02-01T10:00:00.000Z"));
      const up = observed(
        watchEntry(REF, "created"),
        seeing(REF, "working"),
      ).entry;
      expect(up.last?.since).toBe("2026-02-01T10:00:00.000Z");

      vi.setSystemTime(new Date("2026-02-01T10:04:00.000Z"));
      const still = observed(up, seeing(REF, "working")).entry;
      expect(still.last).toEqual({
        level: "working",
        foregroundShell: null,
        since: "2026-02-01T10:00:00.000Z",
      });

      const stopped = observed(still, seeing(REF, "stopped")).entry;
      expect(stopped.last?.since).toBe("2026-02-01T10:04:00.000Z");
      expect(seenOf([[REF, stopped]])).toEqual([
        {
          terminal: REF,
          level: "stopped",
          since: "2026-02-01T10:04:00.000Z",
        },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("has nothing to publish about a terminal nobody has read yet", () => {
    const back = restored();
    expect(back.last).toBeNull();
    expect(
      seenOf([
        [REF, back],
        [OTHER, watchEntry(OTHER, "asked")],
      ]),
    ).toEqual([]);

    const read = observed(back, seeing(REF, "asking")).entry;
    expect(seenOf([[REF, read]])).toEqual([
      { terminal: REF, level: "asking", since: read.last?.since },
    ]);
  });
});

describe("the account the agent is handed", () => {
  const event = {
    ref: REF,
    host: "local",
    terminalId: "11111111-1111-4111-8111-111111111111",
    hostName: "box",
    name: "fix the parser",
    agent: "claude-code",
    level: "stopped" as const,
    at: "2026-01-01T00:00:00.000Z",
  };

  const about = (ref: string) =>
    ref === REF
      ? { role: "implementor" as const, title: "a stored piece of work" }
      : null;

  it("says who speaks, which terminal, what work it is, how it stands, and to end the turn", () => {
    const text = wakeText([event], about);
    expect(text).toContain("[kolu]");
    expect(text).toContain(REF);
    expect(text).toContain("fix the parser");
    expect(text).toContain("box");
    expect(text).toContain("claude-code");
    expect(text).toContain("STOPPED");

    expect(text).toContain("the implementor of «a stored piece of work»");
    expect(text).toContain("agent_say");
    expect(text).toContain("END YOUR TURN");
  });

  it("counts the terminals when several rang together", () => {
    const text = wakeText(
      [event, { ...event, ref: OTHER, level: "gone" }],
      about,
    );
    expect(text).toContain("2 terminals");
    expect(text).toContain(OTHER);
    expect(text).toContain("GONE");

    expect(text).toContain("no longer a member of any work in progress");
  });

  it("words the three levels this watch learned to tell apart", () => {
    expect(wakeText([{ ...event, level: "ready" }], about)).toContain("UP");
    expect(wakeText([{ ...event, level: "asleep" }], about)).toContain(
      "PUT TO SLEEP",
    );
    const ended = wakeText([{ ...event, level: "ended", agent: "" }], about);
    expect(ended).toContain("ENDED");

    expect(ended).toContain("no agent in it");
    expect(ended).not.toContain("running ");
  });

  it("says a terminal is UNNAMED rather than quoting an empty name", () => {
    const text = wakeText([{ ...event, name: "" }], about);
    expect(text).toContain("an unnamed terminal");
    expect(text).not.toContain("“”");
  });
});
