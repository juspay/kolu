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
  type WatchEntry,
  type WatchLevel,
  watchEntry,
} from "./watching.ts";

const REF = "local/11111111-1111-4111-8111-111111111111";
const OTHER = "remote:prod/22222222-2222-4222-8222-222222222222";

const seeing = (
  ref: string,
  level: WatchLevel,
  over: { name?: string; agent?: string | null } = {},
) => ({
  ref,
  host: ref.slice(0, ref.lastIndexOf("/")),
  terminalId: ref.slice(ref.lastIndexOf("/") + 1),
  hostName: "box",
  name: over.name ?? "fix the parser",
  agent: over.agent === undefined ? "claude-code" : over.agent,
  level,
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
  const fresh = (): WatchEntry => watchEntry(REF);

  it("rings on a stop, and not twice for the same stop", () => {
    const first = observed(fresh(), seeing(REF, "stopped"));
    expect(first.ring).toBe("stopped");
    // `told` is the DELIVERY's to set, so a second reading of an entry that
    // was never told still rings.
    expect(first.entry.told).toBeNull();
    const toldAlready: WatchEntry = { ...first.entry, told: "stopped" };
    expect(observed(toldAlready, seeing(REF, "stopped")).ring).toBeNull();
  });

  it("rings on a question, even for a terminal already told about a stop", () => {
    const stopped: WatchEntry = { ...fresh(), told: "stopped" };
    expect(observed(stopped, seeing(REF, "asking")).ring).toBe("asking");
  });

  it("forgets what it was told when the agent goes back to work", () => {
    const stopped: WatchEntry = { ...fresh(), told: "stopped" };
    const back = observed(stopped, seeing(REF, "working"));
    expect(back.ring).toBeNull();
    expect(back.entry.told).toBeNull();
    // ... so the NEXT stop is news again.
    expect(observed(back.entry, seeing(REF, "stopped")).ring).toBe("stopped");
  });

  it("never rings about a shell, and never forgets the agent that was there", () => {
    const seenOnce = observed(fresh(), seeing(REF, "stopped")).entry;
    const shell = observed(seenOnce, seeing(REF, "shell", { agent: null }));
    expect(shell.ring).toBeNull();
    expect(shell.entry.agent).toBe("claude-code");
  });

  it("rings when a terminal that HELD an agent goes away, and drops it", () => {
    const seenOnce = observed(fresh(), seeing(REF, "stopped")).entry;
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
    // What a restart holds is the saved entry: the level it was told, and the
    // name and agent it last saw. The watcher then looks again.
    const restored: WatchEntry = {
      ref: REF,
      name: "fix the parser",
      agent: "claude-code",
      told: "asking",
    };
    expect(observed(restored, seeing(REF, "asking")).ring).toBeNull();
    // ... and a terminal that moved on while kolu was down still rings.
    expect(observed(restored, seeing(REF, "stopped")).ring).toBe("stopped");
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
});
