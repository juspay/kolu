import { describe, expect, test } from "vitest";

import type { Fiber } from "effect";

import { Turns } from "./turns.ts";

const row = (which: number): string => `user:${which}`;

describe("whether the conversation is busy", () => {
  test("nothing running is not busy", () => {
    expect(new Turns<Fiber.Fiber<unknown, unknown>>().busy).toBe(false);
  });

  test("and stays busy while the SECOND of two is still running", () => {
    const turns = new Turns<Fiber.Fiber<unknown, unknown>>();
    const first = turns.open(row(1));
    const second = turns.open(row(2));
    expect(turns.busy).toBe(true);
    turns.leave(first);
    expect(turns.busy).toBe(true);
    turns.leave(second);
    expect(turns.busy).toBe(false);
  });
});

describe("which turn may say where the conversation stands", () => {
  test("the only one, when it is the only one", () => {
    const turns = new Turns<Fiber.Fiber<unknown, unknown>>();
    expect(turns.leave(turns.open(row(1)))).toBe(true);
  });

  test("the LAST one out, and never the first", () => {
    const turns = new Turns<Fiber.Fiber<unknown, unknown>>();
    const first = turns.open(row(1));
    const second = turns.open(row(2));
    expect(turns.leave(first)).toBe(false);
    expect(turns.leave(second)).toBe(true);
  });

  test("... in whichever order they finish", () => {
    const turns = new Turns<Fiber.Fiber<unknown, unknown>>();
    const first = turns.open(row(1));
    const second = turns.open(row(2));
    expect(turns.leave(second)).toBe(false);
    expect(turns.leave(first)).toBe(true);
  });

  test("a ticket that has already left reports no second ending", () => {
    const turns = new Turns<Fiber.Fiber<unknown, unknown>>();
    const only = turns.open(row(1));
    expect(turns.leave(only)).toBe(true);
    expect(turns.leave(only)).toBe(false);
  });
});

describe("which turn the agent is ON", () => {
  test("nothing, when nothing is running", () => {
    expect(new Turns<Fiber.Fiber<unknown, unknown>>().head).toBeNull();
  });

  test("the OLDEST, never the newest", () => {
    const turns = new Turns<Fiber.Fiber<unknown, unknown>>();
    const first = turns.open(row(1));
    turns.open(row(2));
    expect(turns.head).toBe(first);
  });

  test("... and the next one along when that one ends", () => {
    const turns = new Turns<Fiber.Fiber<unknown, unknown>>();
    const first = turns.open(row(1));
    const second = turns.open(row(2));
    const third = turns.open(row(3));
    expect(turns.head).toBe(first);
    turns.leave(first);
    expect(turns.head).toBe(second);
    turns.leave(second);
    expect(turns.head).toBe(third);
  });

  test("the one still running, when a LATER turn finishes first", () => {
    const turns = new Turns<Fiber.Fiber<unknown, unknown>>();
    const first = turns.open(row(1));
    const second = turns.open(row(2));
    turns.leave(second);
    expect(turns.head).toBe(first);
  });
});

describe("what a cancel is about", () => {
  test("EVERY turn running, marked and answered", () => {
    const turns = new Turns<Fiber.Fiber<unknown, unknown>>();
    const first = turns.open(row(1));
    const second = turns.open(row(2));
    const asked = turns.stopping();
    expect(asked).toEqual([first, second]);
    expect(first.stopped).toBe(true);
    expect(second.stopped).toBe(true);
  });

  test("nothing running is nothing to ask about", () => {
    expect(new Turns<Fiber.Fiber<unknown, unknown>>().stopping()).toEqual([]);
  });

  test("the mark OUTLIVES the turn, which is what it is for", () => {
    const turns = new Turns<Fiber.Fiber<unknown, unknown>>();
    const only = turns.open(row(1));
    turns.stopping();
    turns.leave(only);
    expect(only.stopped).toBe(true);
  });

  test("and a turn that ended is one the cancel worked on", () => {
    const turns = new Turns<Fiber.Fiber<unknown, unknown>>();
    const first = turns.open(row(1));
    const second = turns.open(row(2));
    const asked = turns.stopping();
    turns.leave(first);
    expect(asked.every((ticket) => !turns.has(ticket))).toBe(false);
    turns.leave(second);
    expect(asked.every((ticket) => !turns.has(ticket))).toBe(true);
  });
});

describe("what a shutdown takes", () => {
  test("every ticket, and leaves nothing behind", () => {
    const turns = new Turns<Fiber.Fiber<unknown, unknown>>();
    const first = turns.open(row(1));
    const second = turns.open(row(2));
    expect(turns.drain()).toEqual([first, second]);
    expect(turns.busy).toBe(false);
    expect(turns.has(first)).toBe(false);
  });

  test("nothing, when there is nothing", () => {
    expect(new Turns<Fiber.Fiber<unknown, unknown>>().drain()).toEqual([]);
  });
});
