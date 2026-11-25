/** SCROLLING BACK IN A CONDUCTOR SCREEN — shared by a work's live pane and the
 *  Look window, which draw the one screen component under two test-id
 *  prefixes (`live-*`, `peek-*`).
 *
 *  Where the view sits is read off the screen's own buffer (the `__xterm`
 *  bridge on the screen's container); what the head says is its live readout's
 *  `data-phase` (`held` while the scroll lock holds output, `live` at the
 *  bottom, `reading` while a fresh attach paints). A snap back to the bottom
 *  is a re-attach — the head passes through `reading` and the view lands on
 *  the newest line — so "stays" is SAMPLED across a window, never read once:
 *  a snap-back cannot hide between two looks. */

import type { Page } from "playwright";
import { pollFor } from "./poll.ts";
import { POLL_TIMEOUT } from "./world.ts";

/** How long a scrolled-back view is held before "it stays" is claimed. */
const STAYS_WINDOW_MS = 2_000;
const STAYS_SAMPLE_MS = 100;

/** One screen and the head readout that speaks for it. */
export interface ConductorScreen {
  /** Selector of the screen's container (`live-screen` / `peek-screen`). */
  screen: string;
  /** Selector of the head's live readout (`live-live` / `peek-live`). */
  readout: string;
  /** Selector of the head's status words (`live-status` / `peek-status`) —
   *  what the client says about the terminal itself. */
  status: string;
  /** How the failure names it. */
  label: string;
}

interface ScrollSample {
  /** Rows between the top of the view and the bottom of the buffer. */
  rowsBack: number | null;
  phase: string | null;
  /** The head's STATE words alone (see {@link stateWords}), as rendered. */
  status: string | null;
}

/** THE STANDINGS WITH NO LIVE SCREEN BEHIND THEM, in the client's own words
 *  (`conductor/terminalStatus.ts:101-121`). A held gate keeps the screen and
 *  the readout up across them, so a view that has not moved reads exactly
 *  like a view that is held — which would pass a scroll-back scenario on a
 *  terminal the index never vouched for. Any one of them inside the hold
 *  window is a failure, not a hold. */
const NO_SCREEN_WORDS = [
  "finding the terminal…",
  "its host is not connected",
  "terminal gone",
] as const;

/** THE STATE WORDS ALONE, inside the head's status line. The line holds more
 *  than the state: `TerminalHead.tsx:161-181` draws the state
 *  (`StateFor.tsx:37`, the first span), then the elapsed time, the task
 *  progress, and last the AGENT'S OWN `doing` SUMMARY — free text. Reading
 *  the whole line would let a summary that merely mentions "terminal gone"
 *  turn a legitimate hold red, so only the first span is read. */
const stateWords = (at: ConductorScreen): string => `${at.status} > span`;

/** Which of {@link NO_SCREEN_WORDS} the head's STATE is, or `null` while it
 *  speaks for a terminal the index vouches for. The state span carries the
 *  words alone, except that the elapsed time is appended inside it as
 *  `" for 4m"` when kolu's watch agrees with the state (`StateFor.tsx:45`),
 *  so that suffix is allowed and nothing else is. */
export function maskedStatus(text: string | null): string | null {
  if (text === null) return null;
  return (
    NO_SCREEN_WORDS.find(
      (words) => text === words || text.startsWith(`${words} for `),
    ) ?? null
  );
}

/** The screen's container, as the page holds it: the bridged terminal, and
 *  the record {@link markMove} keeps on it. */
type ScreenEl = HTMLElement & {
  __xterm?: {
    buffer: { active: { baseY: number; viewportY: number } };
    onScroll(fn: () => void): { dispose(): void };
  };
  __leftBottom?: { left: boolean; sub?: { dispose(): void } };
};

function rowsBackOf(page: Page, at: ConductorScreen): Promise<number | null> {
  return page.evaluate((sel) => {
    const term = document.querySelector<ScreenEl>(sel)?.__xterm;
    if (!term) return null;
    const buf = term.buffer.active;
    return buf.baseY - buf.viewportY;
  }, at.screen);
}

/** One look at the screen and its head: where the view sits, what the readout
 *  says, and what the head says about the terminal. A readout or status read
 *  that fails is kept (it is WHY, and the failure prints it) but does NOT
 *  discard the buffer reading that did answer: `{rowsBack:3, phase:null}`
 *  says the view is scrolled back and the head is unreadable, which
 *  `{null,null}` would have thrown away. */
async function sample(
  page: Page,
  at: ConductorScreen,
  failed: ReadFailure,
): Promise<ScrollSample> {
  const rowsBack = await rowsBackOf(page, at);
  return {
    rowsBack,
    phase: await failed.orNull(() =>
      page.locator(at.readout).getAttribute("data-phase", { timeout: 500 }),
    ),
    status: await failed.orNull(() =>
      page.locator(stateWords(at)).textContent({ timeout: 500 }),
    ),
  };
}

/** What a wait reads while the screen or its readout is not drawn yet. */
const NOT_YET: ScrollSample = { rowsBack: null, phase: null, status: null };

const scrolledBack = (s: ScrollSample): boolean =>
  s.rowsBack !== null && s.rowsBack > 0 && s.phase === "held";

/** Start recording whether the view leaves the bottom, from the terminal's
 *  own scroll event, before a move is made. The kit throws an unreported
 *  scroll back to the bottom a microtask later, which no sample from outside
 *  can see; this record can. */
async function markMove(page: Page, at: ConductorScreen): Promise<void> {
  // No function in this page code may carry an inferred name: tsx's esbuild
  // (keepNames) would wrap it in a `__name(...)` the page does not have. The
  // scroll callback is an argument, so it carries none.
  const armed = await page.evaluate((sel) => {
    const el = document.querySelector<ScreenEl>(sel);
    const term = el?.__xterm;
    if (!el || !term) return false;
    el.__leftBottom?.sub?.dispose();
    const record: NonNullable<ScreenEl["__leftBottom"]> = { left: false };
    record.sub = term.onScroll(() => {
      const buf = term.buffer.active;
      if (buf.viewportY < buf.baseY) record.left = true;
    });
    el.__leftBottom = record;
    return true;
  }, at.screen);
  if (!armed) throw new Error(`${at.label} has no terminal to move`);
}

/** What the last move did, in words for a failure: whether it ever left the
 *  bottom, AND where the view sits now. "It was thrown to the bottom" is only
 *  true when the view IS at the bottom — a view that left and is still rows
 *  back was not thrown anywhere, and saying so sent review 27 looking for a
 *  snap-back that had not happened. */
export async function moveStory(
  page: Page,
  at: ConductorScreen,
): Promise<string> {
  const left = await page.evaluate(
    (sel) => document.querySelector<ScreenEl>(sel)?.__leftBottom?.left,
    at.screen,
  );
  if (left === undefined) return "no move was recorded";
  if (!left) return "it never scrolled";
  const now = await sample(page, at, lastReadFailure());
  if (now.rowsBack === null)
    return "it scrolled back, and the screen cannot be read now";
  if (now.rowsBack === 0)
    return "it scrolled back and was thrown to the bottom";
  return (
    `it scrolled back and is still ${now.rowsBack} row(s) off the bottom, ` +
    `with the head saying ${JSON.stringify(now.phase)}`
  );
}

/** WHAT THE PAGE HOLDS RIGHT NOW, by the two selectors the sample reads. A
 *  readout that is missing (`0`) and one the selector matches TWICE (`2` — a
 *  Playwright locator refuses a strict read of either) fail the same way from
 *  outside, and a failure that does not count them cannot tell a pane that
 *  went away from a pane that was drawn twice. */
async function pageHolds(page: Page, at: ConductorScreen): Promise<string> {
  const [screens, readouts] = await Promise.all([
    page.locator(at.screen).count(),
    page.locator(at.readout).count(),
  ]);
  return `the page holds ${screens} screen(s) and ${readouts} readout(s)`;
}

/** The sample's own read failures, kept for the failure message. A read that
 *  throws is WHY, and WHY is the whole difference between a screen that is
 *  not there, a readout the selector matches twice, and a page that would not
 *  answer at all. */
interface ReadFailure {
  /** Keep the error and read the sample as {@link NOT_YET}: for the ONE read
   *  whose failure leaves the sample with nothing in it. */
  keep(e: unknown): ScrollSample;
  /** Keep the error and answer `null` for this field alone, so a sample's
   *  other fields survive a head that will not answer. */
  orNull(read: () => Promise<string | null>): Promise<string | null>;
  /** The failure's words for the last error kept, or `""`. */
  words(): string;
}

function lastReadFailure(): ReadFailure {
  let last: unknown;
  return {
    keep: (e) => {
      last = e;
      return NOT_YET;
    },
    orNull: async (read) => {
      try {
        return await read();
      } catch (e) {
        last = e;
        return null;
      }
    },
    words: () =>
      last === undefined
        ? ""
        : `; the last read failed: ${String((last as Error).message ?? last)
            .split("\n")
            .slice(0, 3)
            .join(" / ")}`,
  };
}

/** A real mouse wheel over the middle of the screen. */
export async function wheelOver(
  page: Page,
  at: ConductorScreen,
  deltaY: number,
): Promise<void> {
  const box = await page.locator(at.screen).boundingBox();
  if (!box) throw new Error(`${at.label} has no box to wheel over`);
  await markMove(page, at);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, deltaY);
}

/** A key pressed on the screen itself. */
export async function pressOn(
  page: Page,
  at: ConductorScreen,
  key: string,
): Promise<void> {
  await page.locator(`${at.screen} .xterm-helper-textarea`).focus();
  await markMove(page, at);
  await page.keyboard.press(key);
}

/** The view is above the bottom and the head says `held` — first reached, then
 *  held for {@link STAYS_WINDOW_MS}, sampled every {@link STAYS_SAMPLE_MS}. A
 *  view that never scrolled back fails the first half, so the hold cannot pass
 *  on a screen that was never moved; that failure says whether the move
 *  scrolled at all.
 *
 *  INSIDE THE HOLD WINDOW THE HEAD'S OWN WORDS ARE READ TOO. The scroll lock's
 *  gate is held across a standing that answers no terminal, so the screen and
 *  the readout stay up while the client itself says the terminal cannot be
 *  found or its host is not connected. A view that never moved then reads
 *  exactly like a held one — a pass for the wrong reason, which
 *  {@link maskedStatus} turns red. */
export async function expectStaysScrolledBack(
  page: Page,
  at: ConductorScreen,
): Promise<void> {
  const failed = lastReadFailure();
  try {
    await pollFor({
      observe: () => sample(page, at, failed).catch(failed.keep),
      isDone: scrolledBack,
      timeoutMs: POLL_TIMEOUT,
      intervalMs: STAYS_SAMPLE_MS,
      onTimeout: (last, ms) =>
        new Error(
          `${at.label} never stayed scrolled back: after ${ms}ms it reads ${JSON.stringify(last)}`,
        ),
    });
  } catch (e) {
    throw new Error(
      `${(e as Error).message} — ${await pageHolds(page, at)}; ${await moveStory(page, at)}${failed.words()}`,
    );
  }
  const held = Date.now();
  while (Date.now() - held < STAYS_WINDOW_MS) {
    await page.waitForTimeout(STAYS_SAMPLE_MS);
    // The readout was there a moment ago: a read that fails now is its own
    // failure, not a snap-back — and it is carried, with the counts, the same
    // way the reach half carries them.
    const now = await sample(page, at, failed).catch(failed.keep);
    const since = Date.now() - held;
    const masked = maskedStatus(now.status);
    if (masked !== null)
      throw new Error(
        `${at.label} was held ${since}ms on a terminal the client does not vouch for: ` +
          `the head says "${masked}" — it reads ${JSON.stringify(now)}; ` +
          `${await pageHolds(page, at)}${failed.words()}`,
      );
    if (!scrolledBack(now))
      throw new Error(
        `${at.label} snapped back ${since}ms after it was scrolled back: ` +
          `it reads ${JSON.stringify(now)}; ${await pageHolds(page, at)}${failed.words()}`,
      );
  }
}

/** The head says `live`: the view is back at the bottom and nothing is held. */
export async function expectLiveAtBottom(
  page: Page,
  at: ConductorScreen,
): Promise<void> {
  const failed = lastReadFailure();
  try {
    await pollFor({
      observe: () => sample(page, at, failed).catch(failed.keep),
      isDone: (s) => s.rowsBack === 0 && s.phase === "live",
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (last, ms) =>
        new Error(
          `${at.label} never came back to live at the bottom: after ${ms}ms it reads ${JSON.stringify(last)}`,
        ),
    });
  } catch (e) {
    throw new Error(
      `${(e as Error).message} — ${await pageHolds(page, at)}${failed.words()}`,
    );
  }
}
