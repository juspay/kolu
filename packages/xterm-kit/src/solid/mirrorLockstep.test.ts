/**
 * THE RULE, as a property: a pane's terminal changes size ONLY at the point in
 * the stream where the daemon's mirror changed size — and then the two screens
 * are equal.
 *
 * Two real terminals, fed the way the two sides are actually fed. One is the
 * MIRROR kaval keeps: it receives the program's bytes and the resizes in the
 * order they happened. The other is the PANE: it receives the frames a browser
 * receives. The only variable is WHERE the pane applies the resize.
 *
 * The program is the shape that exposed the bug. It paints with ABSOLUTE
 * addressing (`CSI row;1H`), so a line written for one height lands on a
 * different row at another; and on SIGWINCH it repaints with RELATIVE moves
 * ("up N, erase below, redraw"), so a cursor one row out erases rows nobody
 * meant to clear. That pairing is why the damage is not self-correcting: the
 * repaint that should fix the screen is itself computed against a cursor the
 * two sides disagree about.
 *
 * The gap being modelled is real and is ~250 ms wide plus a round trip: the
 * pane's box moves when the user drags a divider, the pty is told after the
 * grid settles, and the program keeps writing throughout — at the size it still
 * has. Those bytes are the test's subject.
 */

import { createRequire } from "node:module";
import type { Terminal as HeadlessTerminal } from "@xterm/headless";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { Terminal } = require("@xterm/headless") as {
  Terminal: typeof HeadlessTerminal;
};

type Headless = InstanceType<typeof HeadlessTerminal>;
type Grid = { cols: number; rows: number };

/** One thing that happens to a screen, in the order it happened. */
type Event = { kind: "write"; data: string } | { kind: "resize"; grid: Grid };

/**
 * The program under the terminal.
 *
 * It keeps a panel pinned to the BOTTOM of the screen, which is what a
 * full-screen agent does: each tick addresses the last row absolutely and lets
 * the newline scroll. On a resize it repaints by walking the cursor UP over the
 * lines it believes it wrote, erasing below, and redrawing them.
 *
 * Both halves read `grid`, which only moves when the terminal it is attached to
 * is actually resized — a program learns its size from SIGWINCH, never from a
 * viewer's box.
 */
function scriptedProgram(start: Grid) {
  let grid = start;
  let tick = 0;
  /** Lines the program believes are on screen below the cursor's home — the
   *  count its relative repaint walks back over. */
  let painted = 0;

  return {
    get grid() {
      return grid;
    },
    /** One line of output, addressed absolutely at the bottom row. */
    write(): string {
      tick += 1;
      painted = Math.min(painted + 1, grid.rows - 1);
      const line = `tick ${tick} `.padEnd(20, ".");
      return `\x1b[${grid.rows};1H${line}\r\n`;
    },
    /** The SIGWINCH repaint: up N, erase below, redraw N lines. */
    resizeTo(next: Grid): string {
      grid = next;
      const n = Math.min(painted, next.rows - 1);
      painted = n;
      const lines = Array.from({ length: n }, (_, i) =>
        `repaint ${i} `.padEnd(Math.min(18, next.cols - 1), "-"),
      ).join("\r\n");
      return `\x1b[${n}A\x1b[0J${lines}`;
    },
  };
}

/**
 * The one true sequence of events, as the MIRROR experiences them.
 *
 * `gapWrites` is the number of ticks the program emits between the pane's box
 * changing and the pty actually being resized — the settle window made
 * concrete. Those bytes are laid out for the OLD grid by construction, because
 * the program has not been told anything yet.
 *
 * `boxMovedAt` records where in the sequence the pane's BOX moved, which is the
 * point a pane that trusts its own box would resize at. Nothing in the mirror's
 * own experience marks it — that is the whole point.
 */
function session(opts: {
  start: Grid;
  resizes: Grid[];
  warmupWrites: number;
  gapWrites: number;
  tailWrites: number;
}): { events: Event[]; boxMovedAt: number[]; final: Grid } {
  const program = scriptedProgram(opts.start);
  const events: Event[] = [];
  const boxMovedAt: number[] = [];
  const push = (data: string) => events.push({ kind: "write", data });

  for (let i = 0; i < opts.warmupWrites; i++) push(program.write());
  for (const grid of opts.resizes) {
    // The user drags the divider: the pane's box is this size NOW.
    boxMovedAt.push(events.length);
    // …and the program, which knows nothing about it, keeps writing at the size
    // it still has.
    for (let i = 0; i < opts.gapWrites; i++) push(program.write());
    // The grid finally reaches the pty: the mirror reflows and the child is
    // SIGWINCHed, in that order.
    events.push({ kind: "resize", grid });
    push(program.resizeTo(grid));
    for (let i = 0; i < opts.tailWrites; i++) push(program.write());
  }
  return { events, boxMovedAt, final: program.grid };
}

/** Apply events to a terminal, awaiting each parse so a resize can never
 *  overtake bytes through xterm's async write queue. */
async function apply(term: Headless, events: readonly Event[]): Promise<void> {
  for (const event of events) {
    if (event.kind === "resize") {
      term.resize(event.grid.cols, event.grid.rows);
      continue;
    }
    const parsed = Promise.withResolvers<void>();
    term.write(event.data, () => parsed.resolve());
    await parsed.promise;
  }
}

/** The SCREEN — the viewport, trailing blanks trimmed, which is what a person
 *  looking at the two sides would compare. */
function screenOf(term: Headless): string {
  const buffer = term.buffer.active;
  const rows: string[] = [];
  for (let y = 0; y < term.rows; y++) {
    const line = buffer.getLine(buffer.viewportY + y);
    rows.push(line?.translateToString(true) ?? "");
  }
  return rows.join("\n").replace(/\s+$/, "");
}

/** The pane's events under TODAY's behaviour: it resizes the moment its own box
 *  moves, which is `gapWrites` bytes before the mirror does. */
function paneEventsResizingEarly(
  events: readonly Event[],
  boxMovedAt: readonly number[],
): Event[] {
  const moved = new Set(boxMovedAt);
  const out: Event[] = [];
  // The resize that belongs to each box move is the next one in the sequence.
  const pending = events.filter(
    (e): e is Extract<Event, { kind: "resize" }> => e.kind === "resize",
  );
  let next = 0;
  for (const [i, event] of events.entries()) {
    if (moved.has(i)) {
      const grid = pending[next++];
      if (grid) out.push(grid);
    }
    // The resize itself is not applied again: the pane already did it.
    if (event.kind !== "resize") out.push(event);
  }
  return out;
}

async function run(start: Grid, events: readonly Event[]): Promise<Headless> {
  const term = new Terminal({
    cols: start.cols,
    rows: start.rows,
    allowProposedApi: true,
    scrollback: 1000,
  });
  await apply(term, events);
  return term;
}

describe("a pane resizes where the mirror did", () => {
  // The brief's measured case: 63 rows, a split opens (38), the split closes
  // (63), with the program writing throughout.
  const SPLIT = {
    start: { cols: 100, rows: 63 },
    resizes: [
      { cols: 100, rows: 38 },
      { cols: 100, rows: 63 },
    ],
    warmupWrites: 40,
    gapWrites: 6,
    tailWrites: 4,
  };

  it("holds: the two screens are equal after every resize", async () => {
    const { events, final } = session(SPLIT);
    const mirror = await run(SPLIT.start, events);
    const pane = await run(SPLIT.start, events);
    expect(pane.rows).toBe(final.rows);
    expect(screenOf(pane)).toBe(screenOf(mirror));
    // Not vacuous: the program really did paint something.
    expect(screenOf(mirror)).toContain("repaint 0");
    mirror.dispose();
    pane.dispose();
  });

  it("fails when the pane resizes at its own box instead — today's behaviour", async () => {
    // The negative half, and the reason the rule is worth its cost. Identical
    // bytes, identical sizes, one difference: WHERE the pane applied the
    // resize. The bytes written in the gap land in a terminal that is already
    // the new size, and the program's relative repaint then erases from the
    // wrong row.
    const { events, boxMovedAt } = session(SPLIT);
    const mirror = await run(SPLIT.start, events);
    const early = await run(
      SPLIT.start,
      paneEventsResizingEarly(events, boxMovedAt),
    );
    expect(early.rows).toBe(mirror.rows);
    expect(screenOf(early)).not.toBe(screenOf(mirror));
    mirror.dispose();
    early.dispose();
  });

  it("holds across a drag that walks the pty through many sizes", async () => {
    // A divider drag, not a single step: each intermediate size is a resize the
    // mirror performs and the pane must perform at the same point. Dragging a
    // tile's corner moves BOTH axes, which is what makes the gap's bytes wrong
    // in two ways at once — wrapped at a width they were not written for, and
    // addressed at a row that is no longer the bottom.
    const DRAG = {
      start: { cols: 120, rows: 40 },
      resizes: [
        { cols: 100, rows: 34 },
        { cols: 80, rows: 28 },
        { cols: 60, rows: 22 },
        { cols: 120, rows: 40 },
      ],
      warmupWrites: 30,
      gapWrites: 3,
      tailWrites: 2,
    };
    const { events, boxMovedAt, final } = session(DRAG);
    const mirror = await run(DRAG.start, events);
    const pane = await run(DRAG.start, events);
    expect(pane.cols).toBe(final.cols);
    expect(screenOf(pane)).toBe(screenOf(mirror));

    const early = await run(
      DRAG.start,
      paneEventsResizingEarly(events, boxMovedAt),
    );
    expect(screenOf(early)).not.toBe(screenOf(mirror));
    mirror.dispose();
    pane.dispose();
    early.dispose();
  });

  it("holds when the program is IDLE across the resize — the case that always worked", async () => {
    // The control. With nothing written in the gap there are no bytes to be
    // laid out for the wrong grid, so both orderings agree — which is exactly
    // why the bug looked intermittent and why a repro has to keep the program
    // busy.
    const IDLE = { ...SPLIT, gapWrites: 0 };
    const { events, boxMovedAt } = session(IDLE);
    const mirror = await run(IDLE.start, events);
    const early = await run(
      IDLE.start,
      paneEventsResizingEarly(events, boxMovedAt),
    );
    expect(screenOf(early)).toBe(screenOf(mirror));
    mirror.dispose();
    early.dispose();
  });
});
