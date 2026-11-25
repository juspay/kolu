/**
 * The scroll-back harness's own reads, driven against a stub page: what it
 * refuses to call a hold, and what it keeps when only part of a look answers.
 *
 * The hold window is where a scroll-back scenario can pass for the wrong
 * reason — the scroll lock's gate holds the screen and the readout up across a
 * standing that answers no terminal, so a view that never moved reads like a
 * held one. These cases hold that line without touching what the harness
 * asserts about a real hold.
 */

import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "node:test";
import { supportCodeLibraryBuilder } from "@cucumber/cucumber";
import { IdGenerator } from "@cucumber/messages";
import type { Page } from "playwright";
import type { ConductorScreen } from "./conductorScroll.ts";

// `conductorScroll.ts` reads the step budget from `world.ts`, which calls
// `setDefaultTimeout` as it loads. Cucumber refuses that call while no run is
// building its support library, so open one for this process — as the runner
// does per run — BEFORE the module graph reaches it. Static imports all
// evaluate first, so the module under test is loaded here instead.
supportCodeLibraryBuilder.reset(process.cwd(), IdGenerator.uuid());
const { expectStaysScrolledBack, maskedStatus, moveStory } = await import(
  "./conductorScroll.ts"
);

const AT: ConductorScreen = {
  screen: '[data-testid="live-screen"]',
  readout: '[data-testid="live-live"]',
  status: '[data-testid="live-status"]',
  label: "the agent's live terminal",
};

interface StubReads {
  /** Rows back the screen's buffer reports. */
  rowsBack: number;
  /** The readout's `data-phase`, or an error it throws instead. */
  phase: () => string;
  /** The head's STATE words — the first span of the status line. */
  state: () => string;
  /** The REST of the status line, after the state: the agent's own `doing`
   *  summary, free text a person wrote. The page puts it inside the status
   *  element, so a harness that reads the whole element reads it too. */
  doing?: string;
  /** What the move record on the screen says, for {@link moveStory}. */
  leftBottom?: boolean;
}

/** A page that answers the reads a sample makes, with the status line split
 *  the way the page draws it, and counts elements the way Playwright's
 *  locators do. */
function stubPage(reads: StubReads): Page {
  const locator = (sel: string) => ({
    getAttribute: async () => {
      if (sel !== AT.readout) throw new Error(`unexpected getAttribute ${sel}`);
      return reads.phase();
    },
    textContent: async () => {
      if (sel === `${AT.status} > span`) return reads.state();
      if (sel === AT.status)
        return reads.doing === undefined
          ? reads.state()
          : `${reads.state()} · ${reads.doing}`;
      throw new Error(`unexpected textContent ${sel}`);
    },
    count: async () => 1,
  });
  return {
    // The page functions run in the browser; this stub answers by which read
    // each one makes, named by the property it reaches for.
    evaluate: async (fn: unknown) => {
      const src = String(fn);
      if (src.includes("__leftBottom?.left")) return reads.leftBottom;
      if (src.includes("__leftBottom = record")) return true;
      return reads.rowsBack;
    },
    locator,
    // The harness samples a real page across a real hold window; the stub
    // stands in for Playwright's own wait, so the window is wall-clock here
    // too — 100ms a look, and a failing case fails on the first.
    waitForTimeout: sleep,
  } as unknown as Page;
}

/** The hold window's failure, or `null` when it held for the whole window. */
async function holdFailure(reads: StubReads): Promise<string | null> {
  try {
    await expectStaysScrolledBack(stubPage(reads), AT);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

test("a hold over a terminal the client cannot find fails", async () => {
  const message = await holdFailure({
    rowsBack: 3,
    phase: () => "held",
    state: () => "finding the terminal…",
  });
  assert.ok(message !== null, "the hold passed while the terminal was unfound");
  assert.match(message, /does not vouch for/);
  assert.match(message, /finding the terminal…/);
  assert.match(message, /the page holds 1 screen\(s\) and 1 readout\(s\)/);
});

test("a hold on a host that is not connected fails", async () => {
  const message = await holdFailure({
    rowsBack: 3,
    phase: () => "held",
    state: () => "its host is not connected",
  });
  assert.ok(message !== null, "the hold passed on a disconnected host");
  assert.match(message, /its host is not connected/);
});

test("a hold the client vouches for is still a hold", async () => {
  assert.equal(
    await holdFailure({
      rowsBack: 3,
      phase: () => "held",
      state: () => "thinking for 2m",
    }),
    null,
  );
});

test("a readout that stops answering keeps the rows it did read", async () => {
  let reads = 0;
  const message = await holdFailure({
    rowsBack: 3,
    phase: () => {
      // The reach half reads it; the hold window's first look does not.
      if (++reads > 1) throw new Error("strict mode violation: 2 elements");
      return "held";
    },
    state: () => "thinking for 2m",
  });
  assert.ok(message !== null, "a dead readout passed the hold window");
  // The buffer answered 3 — a sample that threw the whole look away would say
  // `"rowsBack":null` and name a pane that went away rather than one drawn
  // twice.
  assert.match(message, /"rowsBack":3/);
  assert.match(message, /the page holds 1 screen\(s\) and 1 readout\(s\)/);
  assert.match(message, /the last read failed: strict mode violation/);
});

test("a summary that says one of the phrases is still a hold", async () => {
  // The agent's own `doing` summary is free text inside the same status
  // element. Reading the whole element would call this hold a failure and
  // waste the run; only the STATE part is read.
  assert.equal(
    await holdFailure({
      rowsBack: 3,
      phase: () => "held",
      state: () => "thinking for 2m",
      doing: "working out why the e2e says terminal gone",
    }),
    null,
  );
});

test("the move's story reads where the view sits, not just that it left", async () => {
  const offBottom = await moveStory(
    stubPage({
      rowsBack: 3,
      phase: () => "live",
      state: () => "thinking for 2m",
      leftBottom: true,
    }),
    AT,
  );
  // The sample that misled review 27: it left the bottom and is STILL three
  // rows back, with the head saying `live` — nothing threw it anywhere.
  assert.match(offBottom, /still 3 row\(s\) off the bottom/);
  assert.match(offBottom, /"live"/);
  assert.doesNotMatch(offBottom, /thrown to the bottom/);

  const thrown = await moveStory(
    stubPage({
      rowsBack: 0,
      phase: () => "live",
      state: () => "thinking for 2m",
      leftBottom: true,
    }),
    AT,
  );
  assert.match(thrown, /thrown to the bottom/);

  assert.equal(
    await moveStory(
      stubPage({
        rowsBack: 0,
        phase: () => "live",
        state: () => "thinking for 2m",
        leftBottom: false,
      }),
      AT,
    ),
    "it never scrolled",
  );
});

test("maskedStatus names only the standings with no screen behind them", () => {
  assert.equal(maskedStatus(null), null);
  assert.equal(maskedStatus("thinking for 2m"), null);
  assert.equal(maskedStatus("asleep"), null);
  // A state that merely contains a phrase is not one of them — only the
  // phrase itself, with the elapsed time the state span carries.
  assert.equal(maskedStatus("waiting on terminal gone cleanup"), null);
  assert.equal(maskedStatus("finding the terminal…"), "finding the terminal…");
  assert.equal(
    maskedStatus("its host is not connected"),
    "its host is not connected",
  );
  assert.equal(maskedStatus("terminal gone for 4m"), "terminal gone");
});
