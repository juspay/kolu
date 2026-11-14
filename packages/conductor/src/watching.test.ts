/**
 * The three pure pieces the watch is made of: what is HELD while a turn runs,
 * what is WORTH ringing about, and what the agent is actually handed.
 *
 * Pure, so this is the lane where the rules are pinned — every one of them is
 * otherwise reachable only by running two daemons and an agent, which is what
 * made the blocking loop it replaces untestable.
 */

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

  it("rings READY the first time an agent nobody has briefed is idle", () => {
    const up = observed(fresh(), seeing(REF, "stopped"));
    // NOT `stopped`: this agent's turn did not end, it has not been given one.
    expect(up.ring).toBe("ready");
    // `told` is the DELIVERY's to set, so a second reading of an entry that
    // was never told still rings.
    expect(up.entry.told).toBeNull();
    const toldAlready: WatchEntry = { ...up.entry, told: "ready" };
    expect(observed(toldAlready, seeing(REF, "stopped")).ring).toBeNull();
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

  it("never rings ENDED once an agent has been seen — that terminal's news is its agent's", () => {
    const made = fresh("created-run");
    const agentUp = observed(made, seeing(REF, "working")).entry;
    expect(agentUp.ran).toBe(false);
    const exited = observed(
      agentUp,
      seeing(REF, "shell", { agent: null, foregroundShell: true }),
    );
    expect(exited.ring).toBeNull();
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
