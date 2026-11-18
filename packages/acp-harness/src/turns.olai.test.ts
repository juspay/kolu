/**
 * The turns in flight, over values.
 *
 * Every rule in {@link ./turns.ts} is one the panel depends on at a moment
 * nobody can arrange from outside: a second prompt going out while the first is
 * still running, a cancel pressed with two of them live, a shutdown that owns
 * both fibers. Reaching any of them through the real thing means starting a
 * subprocess, holding a turn open and typing into it — so they are asserted
 * here, the way {@link ./calls.ts}' and {@link ./questions.ts}' rules are, and
 * the e2e suite drives the same shape through a real panel
 * (`packages/plugins/chat/e2e/features/the_agent.feature`, the queued-message scenarios).
 *
 * WHAT EACH TEST IS ABOUT is the difference from a SLOT, because that is what
 * this replaced and what a future reader might think would do: a slot holds the
 * newest, and every case below is one where the newest is the wrong answer.
 * Since `compact-lost-to-steer` there is a second question with the same shape
 * — WHICH one the agent is working on — and the answer is the other end of the
 * same order: the oldest.
 */

import { describe, expect, test } from "vitest";

import type { Fiber } from "effect";

import { Turns } from "./turns.ts";

/** The row a turn is the delivery of. Distinct per turn in every test here,
 *  because telling two messages apart is the whole of what the key is for. */
const row = (which: number): string => `user:${which}`;

describe("whether the conversation is busy", () => {
  test("nothing running is not busy", () => {
    expect(new Turns<Fiber.Fiber<unknown, unknown>>().busy).toBe(false);
  });

  test("and stays busy while the SECOND of two is still running", () => {
    // The guard that refuses to switch conversations, and the panel's own
    // `thinking`. A slot holding the newest answered this correctly by
    // accident and answered {@link Turns.leave} wrongly by the same token.
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
    // The whole of the bug a slot had: a turn that ends while another is still
    // running has nothing true left to say, and saying it anyway marks a
    // thinking panel idle — and settles a transcript whose calls are live.
    const turns = new Turns<Fiber.Fiber<unknown, unknown>>();
    const first = turns.open(row(1));
    const second = turns.open(row(2));
    expect(turns.leave(first)).toBe(false);
    expect(turns.leave(second)).toBe(true);
  });

  test("... in whichever order they finish", () => {
    // A queued message can come back first: the agent reached it after the
    // turn it was behind, but the two answers race back through this process.
    const turns = new Turns<Fiber.Fiber<unknown, unknown>>();
    const first = turns.open(row(1));
    const second = turns.open(row(2));
    expect(turns.leave(second)).toBe(false);
    expect(turns.leave(first)).toBe(true);
  });

  test("a ticket that has already left reports no second ending", () => {
    // Every fiber calls this twice — once on its own way out, once from the
    // `ensuring` that covers an interrupt — and a second `true` would mark the
    // panel idle over a turn that is still running.
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
    // What every message typed while an agent works now produces: a second
    // prompt the agent holds behind the first. The first is the one being
    // worked on and the one an interruption is aimed at; the second is waiting,
    // and its row says so.
    const turns = new Turns<Fiber.Fiber<unknown, unknown>>();
    const first = turns.open(row(1));
    turns.open(row(2));
    expect(turns.head).toBe(first);
  });

  test("... and the next one along when that one ends", () => {
    // The mark coming off: the message behind it has stopped waiting, because
    // the agent has taken it up. A third stays where it is.
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
    // The order is the order they went out, not the order they come back: a
    // queued turn the agent dropped (a cancel) leaves the running one at the
    // head, which is where it was.
    const turns = new Turns<Fiber.Fiber<unknown, unknown>>();
    const first = turns.open(row(1));
    const second = turns.open(row(2));
    turns.leave(second);
    expect(turns.head).toBe(first);
  });
});

describe("what a cancel is about", () => {
  test("EVERY turn running, marked and answered", () => {
    // A slot marked the newest, so the other went on believing it was merely
    // finishing — and a steer aimed at it came back "nothing to steer" and
    // started a fresh turn the person had just pressed a button to end.
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
    // What the grace period asks after waiting: are any of the turns I was
    // pressed for still there?
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
    // A queued message an agent had not reached yet is a fiber this process
    // owns; one left running past a shutdown is one nothing will ever report
    // on. A slot interrupted the newest and orphaned the rest.
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
