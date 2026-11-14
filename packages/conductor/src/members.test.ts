/**
 * The three pure pieces a work's watch is made of: what is HELD while a turn
 * runs, what is WORTH ringing about, and what the agent is actually handed.
 *
 * Pure, so this is the lane where the rules are pinned — every one of them is
 * otherwise reachable only by running two daemons and an agent, which is what
 * made the blocking loop it replaces untestable.
 *
 * The rules are stated per MEMBER now ({@link MemberState}: the watch
 * bookkeeping that is written down, plus the two fields this process keeps).
 * The cases below read a member as ONE flat value, through {@link flat}, for
 * the reason the module splits them in the first place: what is under test is
 * the DECISION, and the decision reads the two halves together.
 */

import type { ConductorWakeLevel } from "kolu-common/conductor";
import { describe, expect, it, vi } from "vitest";
import { holding } from "./held.ts";
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

/** A member as ONE value — the saved bookkeeping and the two runtime fields
 *  in one record, which is how every rule below reads it and how the host
 *  holds it. */
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

/** HOW EACH MEMBER STANDS, as the works view publishes it — the same fold the
 *  host runs over its runtime readings, written here over the flat entries
 *  these cases hold. */
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

describe("the held news", () => {
  it("replaces one terminal's slot IN PLACE, keeping the position it first took", () => {
    const held = holding<string>();
    held.hold(REF, "stopped");
    held.hold(OTHER, "asking");
    held.hold(REF, "gone");
    expect(held.refs()).toEqual([REF, OTHER]);
    expect(held.waiting().map((slot) => slot.value)).toEqual([
      "gone",
      "asking",
    ]);
  });

  it("withdraws a terminal that went back to working", () => {
    const held = holding<string>();
    held.hold(REF, "stopped");
    expect(held.withdraw(REF)).toBe(true);
    expect(held.withdraw(REF)).toBe(false);
    expect(held.refs()).toEqual([]);
  });

  it("takes BY IDENTITY, so news that landed mid-delivery is not dropped", () => {
    const held = holding<string>();
    held.hold(REF, "stopped");
    const taken = held.waiting();
    // The wake is on the wire, and that terminal rings again with newer news.
    held.hold(REF, "gone");
    held.took(taken);
    expect(held.waiting().map((slot) => slot.value)).toEqual(["gone"]);
  });
});

describe("what is worth waking the Conductor about", () => {
  const fresh = (joined: WatchJoin = "created"): WatchEntry =>
    watchEntry(REF, joined);
  /** A terminal the Conductor has already briefed — the ordinary state of a
   *  watched agent, and the one every `stopped` rule is written about. */
  const briefed = (): WatchEntry =>
    spokenTo(observed(fresh(), seeing(REF, "working")).entry);

  it("rings READY for an idle agent nobody has briefed — the INFERENCE", () => {
    // The resumed-session case: kolu's first sight of this agent is an idle,
    // never a `fresh`, so readiness is concluded from "idle and nobody has
    // spoken to it" rather than read off the record.
    const up = observed(fresh(), seeing(REF, "stopped"));
    // NOT `stopped`: this agent's turn did not end, it has not been given one.
    expect(up.ring).toBe("ready");
    // `told` is the DELIVERY's to set, so a second reading of an entry that
    // was never told still rings.
    expect(up.entry.told).toBeNull();
    const toldAlready: WatchEntry = { ...up.entry, told: "ready" };
    expect(observed(toldAlready, seeing(REF, "stopped")).ring).toBeNull();
  });

  it("says nothing while an agent is COMING UP, and rings READY once it is", () => {
    // padi publishes the agent the moment its program takes the foreground.
    // "A process appeared" is not news a Conductor can act on — there is
    // nothing to say to an agent still drawing its screen.
    const coming = observed(fresh(), seeing(REF, "starting"));
    expect(coming.ring).toBeNull();
    // The reading still MOVES the entry: the agent sticks from here on.
    expect(coming.entry.agent).toBe("claude-code");
    // ... and the settled screen is the ring, read straight off the record.
    const up = observed(coming.entry, seeing(REF, "fresh"));
    expect(up.ring).toBe("ready");
    // ONCE: a second `fresh` reading of a terminal already told is silent.
    const toldAlready: WatchEntry = { ...up.entry, told: "ready" };
    expect(observed(toldAlready, seeing(REF, "fresh")).ring).toBeNull();
  });

  it("does not ring a SECOND ready when the fresh agent's transcript lands", () => {
    // The agent came up, rang `ready`, and nobody has said anything to it yet.
    // Its transcript arriving puts it in padi's finished list, which reads as
    // a stop — and the inference above would call that `ready` all over again
    // if `told` did not already say it.
    const up = observed(fresh(), seeing(REF, "fresh"));
    expect(up.ring).toBe("ready");
    const told: WatchEntry = { ...up.entry, told: "ready" };
    expect(observed(told, seeing(REF, "stopped")).ring).toBeNull();
  });

  it("says nothing about a FRESH agent the Conductor has just spoken to", () => {
    // `agent_say` answers on the keystrokes, so padi still reads the agent as
    // fresh for a moment. A fresh agent somebody has spoken to stands as
    // STOPPED, and the re-baseline lands there, so the say cannot ring about
    // itself.
    const up = observed(fresh(), seeing(REF, "fresh"));
    const said = spokenTo({ ...up.entry, told: "ready" });
    expect(said.spoken).toBe(true);
    expect(said.told).toBe("stopped");
    expect(observed(said, seeing(REF, "fresh")).ring).toBeNull();
    // ... and once it has worked, the stop that follows IS news.
    const worked = observed(said, seeing(REF, "working")).entry;
    expect(observed(worked, seeing(REF, "stopped")).ring).toBe("stopped");
  });

  it("a submit that came to nothing is a STOP, never a second `ready`", () => {
    // Briefed, padi read the submit (`prompted`, a working reading), and the
    // screen settled back to `fresh` with no transcript — a slash command, an
    // Enter the TUI ate. "Up and not told anything yet" would be a lie: it was
    // told something, and this idle is the answer.
    const up = observed(fresh(), seeing(REF, "fresh"));
    const said = spokenTo({ ...up.entry, told: "ready" });
    const prompted = observed(said, seeing(REF, "working")).entry;
    expect(observed(prompted, seeing(REF, "fresh")).ring).toBe("stopped");
  });

  it("BASELINES an asked terminal whose agent has only just come up", () => {
    // An agent already present counts as spoken to — it is somebody else's
    // conversation — and the rule reads the AGENT, not its state, so a
    // presence baselines exactly as a session-backed agent does.
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
    // The agent came up and rang ready; the Conductor briefed it. `agent_say`
    // answers as soon as the keys are pressed, so the agent is still sitting
    // in the same idle it rang about.
    const ready = observed(fresh(), seeing(REF, "stopped")).entry;
    const said = spokenTo({ ...ready, told: "ready" });
    expect(said.spoken).toBe(true);
    // Re-baselined at where it STANDS, which now that something has been said
    // to it is a stop and not a readiness.
    expect(said.told).toBe("stopped");
    expect(observed(said, seeing(REF, "stopped")).ring).toBeNull();
    // ... and the next real stop, after it has worked, is news again.
    const worked = observed(said, seeing(REF, "working")).entry;
    expect(observed(worked, seeing(REF, "stopped")).ring).toBe("stopped");
  });

  it("BASELINES a terminal somebody asked to watch, and rings after that", () => {
    const asked = observed(fresh("asked"), seeing(REF, "stopped"));
    // The state it was FOUND in is the tool's answer, not a wake a second
    // later.
    expect(asked.ring).toBeNull();
    expect(asked.entry.told).toBe("stopped");
    // An agent already in it is somebody else's conversation: its next idle is
    // not this conversation's briefing landing.
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
    // ... so the NEXT stop is news again.
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
    // The entry STAYS: waking the terminal puts it back on the ordinary
    // levels, so there is nothing to drop.
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
    // The terminal kolu opened and typed `omp …` at. Its first reading is the
    // shell, before the command has taken the foreground.
    const made = fresh("created-run");
    const atPrompt = observed(
      made,
      seeing(REF, "shell", { agent: null, foregroundShell: true }),
    );
    expect(atPrompt.ring).toBeNull();
    expect(atPrompt.entry.ran).toBe(false);
    // The command is in front of the shell.
    const running = observed(
      atPrompt.entry,
      seeing(REF, "shell", { agent: null, foregroundShell: false }),
    );
    expect(running.ring).toBeNull();
    expect(running.entry.ran).toBe(true);
    // ... and it is over, with no agent ever detected: the brief never
    // started.
    const ended = observed(
      running.entry,
      seeing(REF, "shell", { agent: null, foregroundShell: true }),
    );
    expect(ended.ring).toBe("ended");
    expect(ended.drop).toBe(false);
    // Once.
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
    // Not `ended`: an agent WAS in there, so this is that agent's death and
    // not a brief that never started. It rings whatever the terminal was
    // created as, because the thing the Conductor was waiting for — a stop,
    // a question — can never arrive now.
    const made = fresh("created-run");
    const agentUp = observed(made, seeing(REF, "working")).entry;
    expect(agentUp.ran).toBe(false);
    const exited = observed(
      agentUp,
      seeing(REF, "shell", { agent: null, foregroundShell: true }),
    );
    expect(exited.ring).toBe("exited");
    // The terminal is still there, so there is nothing to drop — and the
    // agent stays remembered, which is what made this `exited` and not
    // `ended`.
    expect(exited.drop).toBe(false);
    expect(exited.entry.agent).toBe("claude-code");
    // ONCE: a restart re-reading the same shell is the same ending twice.
    const toldAlready: WatchEntry = { ...exited.entry, told: "exited" };
    expect(
      observed(
        toldAlready,
        seeing(REF, "shell", { agent: null, foregroundShell: true }),
      ).ring,
    ).toBeNull();
  });

  it("rings EXITED for an agent seen only as a PRESENCE that then died", () => {
    // Presence makes the agent stick EARLIER than a transcript ever did: a
    // `starting` reading alone is kolu having seen an agent in there. That
    // used to leave a hole with no way out — not `ended` (an agent was seen),
    // not `gone` (the terminal is still on its host) — and the Conductor
    // waited forever for a turn that could never come.
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
    // A shell reading whose foreground is not the shell is something running
    // in that terminal — the agent's own `$EDITOR`, a `less` it opened. The
    // agent has not left: the prompt is not back.
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
    // What a restart holds is the saved entry: the level it was told, the name
    // and agent it last saw, and how it is to be read from here.
    const restored = restoredEntry({
      name: "fix the parser",
      agent: "claude-code",
      told: "asking",
      joined: "created",
      spoken: true,
      ran: false,
    });
    expect(observed(restored, seeing(REF, "asking")).ring).toBeNull();
    // ... and a terminal that moved on while kolu was down still rings.
    expect(observed(restored, seeing(REF, "stopped")).ring).toBe("stopped");
  });

  it("does NOT baseline a restored entry — news that never went is still owed", () => {
    // The record a kolu-server left behind after a wake that could not be
    // delivered: watched, asked for, and told nothing.
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

/**
 * EVERY WAIT HAS A WAY OUT — the invariant, as a table.
 *
 * The Conductor's whole design is "say what you are watching and end your
 * turn", which is only safe if every state a watched terminal can be left in
 * has an observable next reading that RINGS. The hole this table was written
 * for was exactly one missing cell: an agent that came up and then fell over
 * left a terminal that was not `gone` and could not be `ended`, so nothing
 * rang ever again.
 *
 * So the table IS the test. Down the side, every state the Conductor can be
 * left waiting in; across the top, every reading that can come next. Each cell
 * is the wake level that reading rings, or a SILENCE with the reason written
 * out — and because it is a `Record` of both, a state or a reading added to
 * the vocabulary without a row or a column fails to compile here rather than
 * going untested.
 */
describe("every state the Conductor can wait in has a way out that rings", () => {
  /** A silence, with the reason it is one. Spelled as an object so a cell
   *  cannot say "nothing rings" without saying why. */
  interface Silent {
    readonly silent: string;
  }
  type Outcome = ConductorWakeLevel | Silent;

  /** THE STATES one can be left waiting in. `prompted` is padi's third
   *  presence state — something was submitted and no transcript has spoken
   *  yet — and it is in this table as the `working` READING, which is what it
   *  reaches the watch as (`agentBucket("prompted")` is `working`): there is
   *  no separate reading for it to arrive by, and that is the point of the
   *  row. `stoppedSpoken` and `stoppedUnspoken` are two rows because the one
   *  rule that reads `spoken` splits them: the first stopped, the second
   *  never started. */
  type FromState =
    | "starting"
    | "fresh"
    | "prompted"
    | "working"
    | "asking"
    | "stoppedSpoken"
    | "stoppedUnspoken"
    | "asleep";

  /** THE READINGS that can come next. The two `shell` columns are one level
   *  split by padi's foreground answer, because that one boolean is the whole
   *  difference between an agent that left and a program it started. */
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

  /** A terminal the Conductor created WITH a command — the join that makes
   *  `ended` reachable at all, so no cell below is silent merely because the
   *  terminal was the wrong kind. */
  const created = (): WatchEntry => watchEntry(REF, "created-run");

  /** One reading, taken and ITS WAKE DELIVERED: `told` moves when the turn
   *  carrying a ring starts, never when the ring is decided, so driving a
   *  from-state means writing down what the Conductor was actually handed. */
  const read = (entry: WatchEntry, way: WayOut): WatchEntry => {
    const seen = observed(entry, reading(way));
    return seen.ring === null ? seen.entry : { ...seen.entry, told: seen.ring };
  };

  /** One way out, as a reading. An agent that has left the foreground, a
   *  terminal that is asleep and one that is gone all report no agent — the
   *  entry is what remembers there was one. */
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

  /** Each from-state, driven there through REAL readings rather than built by
   *  hand: a state nobody can reach is not a state worth a row. */
  const FROM: Readonly<Record<FromState, () => WatchEntry>> = {
    starting: () => read(created(), "starting"),
    fresh: () => read(read(created(), "starting"), "fresh"),
    // Something was submitted to the fresh agent, and it is moving.
    prompted: () => read(spokenTo(FROM.fresh()), "working"),
    working: () => read(spokenTo(FROM.fresh()), "working"),
    asking: () => read(FROM.working(), "asking"),
    stoppedSpoken: () => read(FROM.working(), "stopped"),
    // The resumed session: kolu's first sight of this agent is an idle, and
    // nothing in this conversation has ever spoken to it, so it was told
    // `ready` rather than `stopped`.
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
        // Nothing has been said to it, so an idle is an arrival.
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
      // Prompted READS AS WORKING, so this row and the one below it are the
      // same row — which is the invariant being asserted, not a duplication:
      // an agent that was given something to do has every ending available to
      // it, including the one where it dies before saying a word, and the one
      // where the submit came to nothing (`fresh` again: a stop, since it was
      // spoken to — never a second "not told anything yet").
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
        // A terminal that was woken goes back on the ordinary levels, and
        // every one of them is news again.
        starting: STILL_DRAWING,
        // `spoken` belongs to the terminal, not to one agent process in it, so
        // a fresh agent in a woken terminal reads as stopped — the same rule
        // the `stopped` reading has always followed there.
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
    // The invariant itself, read straight off the table: whatever a watched
    // terminal is doing, SOMETHING that can happen next rings.
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
  /** The entry a restart hands back: everything the record kept, nothing that
   *  was only ever in memory. */
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

      // FOUR MINUTES OF POLLING, saying the same thing each time. The stamp is
      // the one the first of those readings made: a duration that restarted on
      // every reading would count the watcher, not the terminal.
      vi.setSystemTime(new Date("2026-02-01T10:04:00.000Z"));
      const still = observed(up, seeing(REF, "working")).entry;
      expect(still.last).toEqual({
        level: "working",
        foregroundShell: null,
        since: "2026-02-01T10:00:00.000Z",
      });

      // ... and the level CHANGING is what moves it.
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
    // A RESTART remembers the list and no reading at all, so there is no
    // duration to draw until kolu looks at the terminal again — at which
    // point the stamp is its own first sight of the state, which is the only
    // instant it can honestly claim.
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
  /** What each terminal IS: the work it belongs to and the part it plays —
   *  looked up by the host, because a member that left between the ring and
   *  the wake must be described as it stands. */
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
    // The work and the role, because that is what the Conductor acts ON: a
    // bare reference says nothing about which brief this terminal holds.
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
    // The second one left its work between the ring and the wake, and the
    // line says so rather than naming a work it is no longer part of.
    expect(text).toContain("no longer a member of any work in progress");
  });

  it("words the three levels this watch learned to tell apart", () => {
    expect(wakeText([{ ...event, level: "ready" }], about)).toContain("UP");
    expect(wakeText([{ ...event, level: "asleep" }], about)).toContain(
      "PUT TO SLEEP",
    );
    const ended = wakeText([{ ...event, level: "ended", agent: "" }], about);
    expect(ended).toContain("ENDED");
    // No agent was ever in it, so none is named.
    expect(ended).toContain("no agent in it");
    expect(ended).not.toContain("running ");
  });

  it("says a terminal is UNNAMED rather than quoting an empty name", () => {
    // Nothing kolu has read says what this one is for — no intent, no branch.
    // A pair of empty quotes reads as a terminal somebody called "", which is
    // a name the agent would then try to use.
    const text = wakeText([{ ...event, name: "" }], about);
    expect(text).toContain("an unnamed terminal");
    expect(text).not.toContain("“”");
  });
});
