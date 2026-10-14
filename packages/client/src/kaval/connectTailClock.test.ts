import { afterEach, describe, expect, it } from "vitest";
import {
  connectTailQuiet,
  noteConnectTail,
  pruneConnectTails,
  resetConnectTails,
} from "./connectTailClock";

const line = (l: string) => ({ line: l });

afterEach(resetConnectTails);

describe("connectTailClock — when the connect log last moved", () => {
  it("counts from the first frame that showed the last line, not from each re-delivery", () => {
    const tail = [line("pulling …"), line("copying path 'x'…")];
    noteConnectTail("h", tail, 1_000);
    // The same tail re-sent every tick, as fresh objects off the wire.
    noteConnectTail(
      "h",
      tail.map((l) => ({ ...l })),
      5_000,
    );
    noteConnectTail(
      "h",
      tail.map((l) => ({ ...l })),
      900_000,
    );
    expect(connectTailQuiet("h", 901_000)).toEqual({
      lastLine: "copying path 'x'…",
      silentMs: 900_000,
    });
  });

  it("restarts when a new line arrives — even one repeating the previous text", () => {
    noteConnectTail("h", [line("a")], 0);
    noteConnectTail("h", [line("a"), line("b")], 10_000);
    expect(connectTailQuiet("h", 12_000)?.silentMs).toBe(2_000);
    noteConnectTail("h", [line("a"), line("b"), line("b")], 20_000);
    expect(connectTailQuiet("h", 21_000)?.silentMs).toBe(1_000);
  });

  it("has nothing to say for an empty tail, and keeps hosts apart", () => {
    noteConnectTail("h", [line("a")], 0);
    noteConnectTail("h", [], 1_000);
    expect(connectTailQuiet("h", 2_000)).toBeUndefined();
    noteConnectTail("g", [line("g")], 0);
    expect(connectTailQuiet("h", 2_000)).toBeUndefined();
    expect(connectTailQuiet("g", 2_000)?.lastLine).toBe("g");
  });

  it("forgets hosts that left membership", () => {
    noteConnectTail("h", [line("a")], 0);
    noteConnectTail("g", [line("g")], 0);
    pruneConnectTails(["g"]);
    expect(connectTailQuiet("h", 1)).toBeUndefined();
    expect(connectTailQuiet("g", 1)).toBeDefined();
  });
});
