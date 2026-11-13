/**
 * The three pure pieces the watch is made of: what is HELD while a turn runs,
 * what is WORTH ringing about, and what the agent is actually handed.
 *
 * Pure, so this is the lane where the rules are pinned — every one of them is
 * otherwise reachable only by running two daemons and an agent, which is what
 * made the blocking loop it replaces untestable.
 */

import { describe, expect, it } from "vitest";
import { holding } from "./held.ts";
import { wakeText } from "./wakeText.ts";
import {
  observed,
  restoredEntry,
  spokenTo,
  type WatchEntry,
  type WatchJoin,
  type WatchLevel,
  watchEntry,
} from "./watching.ts";

const REF = "local/11111111-1111-4111-8111-111111111111";
const OTHER = "remote:prod/22222222-2222-4222-8222-222222222222";

const seeing = (
  ref: string,
  level: WatchLevel,
  over: {
    name?: string;
    agent?: string | null;
    foregroundShell?: boolean | null;
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
    });
    expect(observed(restored, seeing(REF, "stopped")).ring).toBe("ready");
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
});
