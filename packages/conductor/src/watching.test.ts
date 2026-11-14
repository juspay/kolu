/**
 * The three pure pieces the watch is made of: what is HELD while a turn runs,
 * what is WORTH ringing about, and what the agent is actually handed.
 *
 * Pure, so this is the lane where the rules are pinned — every one of them is
 * otherwise reachable only by running two daemons and an agent, which is what
 * made the blocking loop it replaces untestable.
 */

import type { ConductorWakeLevel } from "kolu-common/conductor";
import { describe, expect, it, vi } from "vitest";
import { holding } from "./held.ts";
import { wakeText } from "./wakeText.ts";
import {
  observed,
  restoredEntry,
  seenOf,
  spokenTo,
  type WatchEntry,
  type WatchJoin,
  type WatchLevel,
  type WatchRoot,
  watchEntry,
  workOf,
} from "./watching.ts";

const REF = "local/11111111-1111-4111-8111-111111111111";
const OTHER = "remote:prod/22222222-2222-4222-8222-222222222222";

/** When a restored entry joined the watch list. A fixed instant, because the
 *  rules under test read it only as "the moment this terminal was watched" —
 *  the one reader that COUNTS from it is `workOf`, which has its own tests
 *  below. */
const JOINED_AT = "2026-01-01T00:00:00.000Z";

const seeing = (
  ref: string,
  level: WatchLevel,
  over: {
    name?: string;
    agent?: string | null;
    foregroundShell?: boolean | null;
    /** The piece of work it is in, as the watcher walked the parent edges on
     *  its host — the terminal ITSELF unless the reading says it is a split
     *  of something else. */
    root?: WatchRoot;
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
  root: over.root ?? { ref, name: over.name ?? "fix the parser" },
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
    // fresh for a moment. The re-baseline lands on the same `ready` it was
    // already told, so the say cannot ring about itself.
    const up = observed(fresh(), seeing(REF, "fresh"));
    const said = spokenTo({ ...up.entry, told: "ready" });
    expect(said.spoken).toBe(true);
    expect(said.told).toBe("ready");
    expect(observed(said, seeing(REF, "fresh")).ring).toBeNull();
    // ... and once it has worked, the stop that follows IS news.
    const worked = observed(said, seeing(REF, "working")).entry;
    expect(observed(worked, seeing(REF, "stopped")).ring).toBe("stopped");
  });

  it("BASELINES an asked terminal whose agent has only just come up", () => {
    // An agent already present counts as spoken to — it is somebody else's
    // conversation — and the rule reads the AGENT, not its state, so a
    // presence baselines exactly as a session-backed agent does.
    const asked = observed(fresh("asked"), seeing(REF, "fresh"));
    expect(asked.ring).toBeNull();
    expect(asked.entry.spoken).toBe(true);
    expect(asked.entry.told).toBe("ready");
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
      ref: REF,
      name: "fix the parser",
      agent: "claude-code",
      told: "asking",
      joined: "created",
      spoken: true,
      ran: false,
      since: JOINED_AT,
      root: null,
    });
    expect(observed(restored, seeing(REF, "asking")).ring).toBeNull();
    // ... and a terminal that moved on while kolu was down still rings.
    expect(observed(restored, seeing(REF, "stopped")).ring).toBe("stopped");
  });

  it("does NOT baseline a restored entry — news that never went is still owed", () => {
    // The record a kolu-server left behind after a wake that could not be
    // delivered: watched, asked for, and told nothing.
    const restored = restoredEntry({
      ref: REF,
      name: "fix the parser",
      agent: "claude-code",
      told: null,
      joined: "asked",
      spoken: true,
      ran: false,
      since: JOINED_AT,
      root: null,
    });
    expect(observed(restored, seeing(REF, "stopped")).ring).toBe("stopped");
  });

  it("remembers across a restart that nothing has been said to the agent yet", () => {
    const restored = restoredEntry({
      ref: REF,
      name: "fix the parser",
      agent: "claude-code",
      told: null,
      joined: "created",
      spoken: false,
      ran: true,
      since: JOINED_AT,
      root: null,
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
      // it, including the one where it dies before saying a word.
      prompted: {
        starting: STILL_DRAWING,
        fresh: "ready",
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
        fresh: "ready",
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
        fresh: "ready",
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
        fresh: "ready",
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
        fresh: "ready",
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
      ref: REF,
      name: "fix the parser",
      agent: "claude-code",
      told: "stopped",
      joined: "created",
      spoken: true,
      ran: false,
      since: JOINED_AT,
      root: null,
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
      expect(seenOf([stopped])).toEqual([
        { ref: REF, level: "stopped", since: "2026-02-01T10:04:00.000Z" },
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
    expect(seenOf([back, watchEntry(OTHER, "asked")])).toEqual([]);

    const read = observed(back, seeing(REF, "asking")).entry;
    expect(seenOf([read])).toEqual([
      { ref: REF, level: "asking", since: read.last?.since },
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

  it("says who speaks, which terminal, how it stands, and to end the turn", () => {
    const text = wakeText([event]);
    expect(text).toContain("[kolu]");
    expect(text).toContain(REF);
    expect(text).toContain("fix the parser");
    expect(text).toContain("box");
    expect(text).toContain("claude-code");
    expect(text).toContain("STOPPED");
    expect(text).toContain("agent_say");
    expect(text).toContain("END YOUR TURN");
  });

  it("counts the terminals when several rang together", () => {
    const text = wakeText([event, { ...event, ref: OTHER, level: "gone" }]);
    expect(text).toContain("2 terminals");
    expect(text).toContain(OTHER);
    expect(text).toContain("GONE");
  });

  it("words the three levels this watch learned to tell apart", () => {
    expect(wakeText([{ ...event, level: "ready" }])).toContain("UP");
    expect(wakeText([{ ...event, level: "asleep" }])).toContain("PUT TO SLEEP");
    const ended = wakeText([{ ...event, level: "ended", agent: "" }]);
    expect(ended).toContain("ENDED");
    // No agent was ever in it, so none is named.
    expect(ended).toContain("no agent in it");
    expect(ended).not.toContain("running ");
  });

  it("says a terminal is UNNAMED rather than quoting an empty name", () => {
    // Nothing kolu has read says what this one is for — no intent, no branch.
    // A pair of empty quotes reads as a terminal somebody called "", which is
    // a name the agent would then try to use.
    const text = wakeText([{ ...event, name: "" }]);
    expect(text).toContain("an unnamed terminal");
    expect(text).not.toContain("“”");
  });
});

describe("the pieces of work the watch list adds up to", () => {
  /** A third ref on the first host — the implementor split a planner opened,
   *  which is the whole case: two terminals, one piece of work. */
  const SPLIT = "local/33333333-3333-4333-8333-333333333333";
  /** ... and the terminal nobody watches that two watched ones hang off. */
  const PARENT = "local/44444444-4444-4444-8444-444444444444";

  /** One entry, as it stands after a reading. Built through the real
   *  `observed` rather than assembled by hand: what is under test is the
   *  grouping of entries the watch actually produces. */
  const read = (
    ref: string,
    over: { name?: string; root?: WatchRoot } = {},
  ): WatchEntry =>
    observed(watchEntry(ref, "created"), seeing(ref, "working", over)).entry;

  it("counts a planner and the implementor it split off as ONE", () => {
    const planner = read(REF, { name: "plan the cutover" });
    const split = read(SPLIT, {
      name: "write the migration",
      root: { ref: REF, name: "plan the cutover" },
    });
    expect(workOf([planner, split])).toEqual([
      {
        root: REF,
        name: "plan the cutover",
        refs: [REF, SPLIT],
        // The planner joined first, so the piece of work is as old as it is.
        since: planner.since,
      },
    ]);
  });

  it("counts two unrelated terminals as TWO, in the order they were added", () => {
    const first = read(REF, { name: "plan the cutover" });
    const second = read(OTHER, { name: "fix the flake" });
    expect(workOf([first, second])).toEqual([
      { root: REF, name: "plan the cutover", refs: [REF], since: first.since },
      {
        root: OTHER,
        name: "fix the flake",
        refs: [OTHER],
        since: second.since,
      },
    ]);
  });

  it("heads a group by a parent NOBODY WATCHES, because that is the work", () => {
    // The human asked the Conductor to watch two splits of a terminal they
    // opened themselves. The parent is on no list and never rings — but it is
    // what makes these two one piece of work, and what a person calls it.
    const one = read(REF, {
      name: "write the migration",
      root: { ref: PARENT, name: "the cutover" },
    });
    const two = read(SPLIT, {
      name: "review the migration",
      root: { ref: PARENT, name: "the cutover" },
    });
    expect(workOf([one, two])).toEqual([
      {
        root: PARENT,
        name: "the cutover",
        refs: [REF, SPLIT],
        since: one.since,
      },
    ]);
  });

  it("keeps the group of a terminal whose host has gone AWAY", () => {
    // The host answered once, and then stopped. A host that is not answering
    // produces no readings at all — so the entry is the only thing left that
    // knows which piece of work this terminal is part of, and the panel must
    // not break it out on its own while the machine is down.
    const planner = read(REF, { name: "plan the cutover" });
    const split = read(SPLIT, {
      name: "write the migration",
      root: { ref: REF, name: "plan the cutover" },
    });
    // Nothing further is observed about either: whatever the watcher last
    // read is what the entries carry.
    expect(workOf([planner, split])).toEqual([
      {
        root: REF,
        name: "plan the cutover",
        refs: [REF, SPLIT],
        since: planner.since,
      },
    ]);
  });

  it("makes a terminal NOBODY HAS READ YET its own piece of work", () => {
    // Just watched, nothing has looked at its host. It is one thing going on
    // under its own name, and the first reading either leaves it there or
    // folds it into the piece of work it belongs to.
    const fresh = watchEntry(REF, "asked");
    expect(workOf([fresh])).toEqual([
      { root: REF, name: "", refs: [REF], since: fresh.since },
    ]);
    const named: WatchEntry = { ...fresh, name: "fix the parser" };
    expect(workOf([named])).toEqual([
      { root: REF, name: "fix the parser", refs: [REF], since: fresh.since },
    ]);
  });

  it("takes the heading from whichever member of a group has one", () => {
    // The split was read before its parent's record had arrived, so its root
    // is named but nameless; the planner's own reading knows what it is
    // called. An empty heading over a group whose root IS named is the drift
    // this guards.
    const split = read(SPLIT, {
      name: "write the migration",
      root: { ref: PARENT, name: "" },
    });
    const other = read(REF, {
      name: "review the migration",
      root: { ref: PARENT, name: "the cutover" },
    });
    expect(workOf([split, other])).toEqual([
      {
        root: PARENT,
        name: "the cutover",
        refs: [SPLIT, REF],
        since: split.since,
      },
    ]);
  });

  it("ages a piece of work from its EARLIEST terminal, wherever that one sits", () => {
    // The planner was watched an hour ago; the implementor it split off
    // joined a minute ago. The work has been going for the hour — a piece
    // that reset its clock every time a terminal was added to it would say a
    // waterfall just started every time it split.
    const hourAgo = "2026-01-01T10:00:00.000Z";
    const minuteAgo = "2026-01-01T10:59:00.000Z";
    const planner: WatchEntry = {
      ...read(REF, { name: "plan the cutover" }),
      since: hourAgo,
    };
    const split: WatchEntry = {
      ...read(SPLIT, {
        name: "write the migration",
        root: { ref: REF, name: "plan the cutover" },
      }),
      since: minuteAgo,
    };
    expect(workOf([planner, split])[0]?.since).toBe(hourAgo);
    // ... and the answer is the EARLIEST, not the first one handed over: a
    // list that arrived in another order describes the same piece of work.
    expect(workOf([split, planner])[0]?.since).toBe(hourAgo);
  });
});
