/**
 * THE RULE, end to end: what a pane's terminal ends up showing is what the
 * daemon's mirror shows — across every way a resize can land.
 *
 * Both halves here are real. The PRODUCER is `createPtyHost` with a real PTY
 * running a real program; the CONSUMER is a real terminal fed from that
 * attachment's items through the browser kit's actual write door
 * (`createOutputCoalesce` over the scroll lock's `writeData` / `resizeInOrder`,
 * `@kolu/xterm-kit/write-door`) and the re-attach loop a pane runs. Nothing is
 * hand-ordered: if kaval published a resize in the wrong place, or the door let
 * one overtake the bytes it followed, the consumer's screen would stop matching
 * the mirror's and these would go red.
 *
 * The program is the shape that exposed the bug (kolu#2362). It paints with
 * ABSOLUTE addressing (`CSI row;1H`), so a line written for one height lands on
 * a different row at another; and on SIGWINCH it repaints with RELATIVE moves
 * ("up N, erase below, redraw"), so a cursor one row out erases rows nobody
 * meant to clear. That pairing is why the damage is not self-correcting — the
 * repaint that should fix the screen is computed against a cursor the two sides
 * disagree about — and it is why the comparison has to be made AFTER everything
 * settles rather than mid-flight.
 *
 * The three ways a resize window can end each deliver differently, so each is
 * its own case: under budget (the held bytes are forwarded), over budget (the
 * subscriber is dropped and re-attaches to a fresh snapshot), and a SECOND
 * resize inside an open window (the pane is told both sizes, the held bytes are
 * discarded, then everyone is re-synced).
 *
 * The control is the pane resizing at its OWN box — today's behaviour — which
 * must NOT converge. Without it the equality assertions could pass on a test
 * that proves nothing.
 *
 * Real PTYs, so the daemon gate; REAL timers, deliberately — the subject is a
 * real child's SIGWINCH, the host's own 600 ms window, and the kit's coalesce
 * interval. Nothing waits a guessed duration: every wait is a poll for a
 * condition with a deadline.
 */

import { createRequire } from "node:module";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeDaemon } from "@kolu/daemon-test-gate";
import { silentLogger as silentLog } from "@kolu/log/loggerStubs.testutil";
import type { Terminal as HeadlessTerminal } from "@xterm/headless";
import {
  createOutputCoalesce,
  createScrollLock,
  type DoorTerminal,
} from "@kolu/xterm-kit/write-door";
import { Effect, Fiber, Stream } from "effect";
import { createRoot } from "solid-js";
import { afterEach, expect, it } from "vitest";
import {
  createPtyHost,
  MIN_DATA_BUDGET_CHARS,
  type PtyDataItem,
  type PtyGrid,
  type PtyHost,
  type PtyId,
} from "./ptyHost.ts";

const require = createRequire(import.meta.url);
const { Terminal } =
  require("@xterm/headless") as typeof import("@xterm/headless");

/** How far the CONTROL's pane runs ahead of the pty — the gap the whole change
 *  is about, which on the client is `GRID_SETTLE_MS` plus a publish.
 *
 *  Its own number, not a copy of anything: this file is on kaval's side of the
 *  wire and has no business holding the browser's settle. What it needs is
 *  "long enough that the program writes several lines into the gap", and the
 *  painter's tick is what decides that. */
const PANE_RUNS_AHEAD_MS = 300;

/** How long a case gives the two screens to agree. Generous: a settle has to
 *  cover the host's window, the child's repaint, the kit's coalesce interval
 *  and an xterm parse, on a loaded runner. */
const CONVERGE_MS = 8000;

/** How long the CONTROL waits before concluding the two screens are not going
 *  to agree. Shorter, because every passing run pays it in full — and well past
 *  the window plus the repaint, which is all convergence would need. */
const DIVERGENCE_MS = 3000;

/** Per-case deadline. Each case runs two bursts and a real settle window, so
 *  it legitimately outlives vitest's 5 s default — and a case that has stopped
 *  making progress is reported by its own poll, with a diff, long before this. */
const TEST_TIMEOUT_MS = 40_000;

const shellEnv = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  TERM: "xterm-256color",
};

/** One burst: how many lines it paints, and how fast.
 *
 *  SHORT on purpose. Every line scrolls the screen, so a long burst after a
 *  resize would carry the damaged rows off the top of the viewport and leave
 *  two screens that agree about fresh output while disagreeing about nothing
 *  still visible. That is not what the defect looks like: a full-screen agent's
 *  repaint leaves a band the user is looking at that no later write touches. */
const BURST_TICKS = 12;
const TICK_MS = 50;

/** The row the status line is written at, ABSOLUTELY and as a constant.
 *
 *  This is the whole lever, and it took a wrong painter to find it. Bytes alone
 *  cannot make two terminals disagree: fed the same stream and ending at the
 *  same size they converge, because every sequence that only ever addresses the
 *  BOTTOM row means the same thing at any height. What does not survive is
 *  addressing a row near the TOP: row 25 of a 30-row screen is a real row, and
 *  the same escape sent to a 20-row screen CLAMPS to row 20. A pane that
 *  resized before the program was told writes the status into a different row
 *  of history than the mirror does, the height change then shifts the mirror's
 *  copy somewhere else again, and no later write goes back to reconcile them.
 *
 *  Full-screen programs address rows near the top constantly — a header, a
 *  status bar, a fixed pane. This is the smallest honest version of that. */
const STATUS_ROW = 25;

/** How many lines the SIGWINCH repaint rewrites. Small, so the repaint cannot
 *  accidentally redraw the whole screen and paper over a divergence above it —
 *  which is exactly what a real agent's repaint does NOT do either. */
const REPAINT_LINES = 6;

/** The pane's coalesce window in these cases — deliberately wider than
 *  {@link TICK_MS}, so a `resized` always arrives with a batch of bytes still
 *  waiting behind it. The kit's own default is 100 ms; what matters here is the
 *  relationship to the tick, not the number. */
const COALESCE_MS = 250;

/** The program. Node rather than a shell script because it needs three things a
 *  `sh` trap cannot give: its CURRENT size on every write (`stdout.columns /
 *  rows`, which node re-reads on SIGWINCH), a repaint whose length is computed
 *  from the size it has just been given, and a way to be told "start writing"
 *  so a test can put bytes in flight at a moment it chooses.
 *
 *  Each tick does what a full-screen program does: refresh a STATUS line at a
 *  fixed row near the top (see {@link STATUS_ROW}), then append a log line at
 *  the bottom, which scrolls. On SIGWINCH it repaints with RELATIVE moves —
 *  "up N, erase below, redraw" — and then goes QUIET, like an agent that has
 *  finished redrawing, so what is on screen afterwards is what a person would
 *  be looking at.
 *
 *  `IDLE<epoch>` marks the end of a burst, and it is what every poll here waits
 *  for: the one side that knows the painting has stopped saying so, rather than
 *  this file guessing a duration.
 *
 *  Raw mode so the tty does not echo the byte that starts a burst — an echo
 *  would reach both screens identically and prove nothing, but it would make
 *  every failure message harder to read. */
const PAINTER_SOURCE = `"use strict";
const out = process.stdout;
const BURST = ${BURST_TICKS};
let tick = 0;
let epoch = 0;
let left = 0;
let timer = null;
function rows() { return out.rows || 24; }
function write(s) { out.write(s); }
// The quiet marker names the SIZE the program went quiet at, never a count of
// resizes: SIGWINCH is a standard signal and standard signals do not queue, so
// two ioctls landing close together are delivered as one and a counter silently
// skips a number. The size is the fact the waiter actually wants anyway.
function stop() {
  if (timer !== null) { clearInterval(timer); timer = null; }
  left = 0;
  write("\\u001b[" + rows() + ";1HIDLE " + out.columns + "x" + rows() + "\\r\\n");
}
function paint() {
  tick += 1;
  // The status line: saved cursor, absolute row near the top, erase to end of
  // line, restored cursor. Written for the size this program has been TOLD it
  // has — which is the only size it can know.
  write("\\u001b7\\u001b[${STATUS_ROW};1Hstatus " + tick + " at " + out.columns + "x" + rows() + "\\u001b[K\\u001b8");
  write("\\u001b[" + rows() + ";1Hlog " + tick + "\\r\\n");
  left -= 1;
  if (left <= 0) stop();
}
function burst() {
  left = BURST;
  if (timer === null) timer = setInterval(paint, ${TICK_MS});
}
process.on("SIGWINCH", () => {
  epoch += 1;
  const n = ${REPAINT_LINES};
  let body = "";
  for (let i = 0; i < n; i++) {
    body += "repaint " + epoch + "." + i + " at " + out.columns + "x" + rows() + (i === n - 1 ? "" : "\\r\\n");
  }
  write("\\u001b[" + n + "A\\u001b[0J" + body);
  stop();
});
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on("data", burst);
burst();
`;

/** A program whose SIGWINCH repaint is larger than the host's byte budget, so
 *  the window gives up on replaying it and drops its subscribers instead.
 *
 *  DERIVED from {@link MIN_DATA_BUDGET_CHARS} rather than hand-sized against
 *  it: a hard-coded number that the budget later grew past would turn this case
 *  into a second copy of the under-budget one, still green, with the drop path
 *  no longer exercised by anything.
 *
 *  Appended to the painter rather than written separately so both cases run the
 *  SAME painting program — the second handler runs after the first, so the
 *  flood follows the repaint, and it re-prints the quiet marker the flood just
 *  scrolled away. */
const FLOOD_SOURCE = `${PAINTER_SOURCE}
process.on("SIGWINCH", () => {
  out.write("F".repeat(${MIN_DATA_BUDGET_CHARS * 2}) + "\\r\\n");
  out.write("\\u001b[" + rows() + ";1HIDLE " + out.columns + "x" + rows() + "\\r\\n");
});
`;

describeDaemon("a pane's screen is the mirror's screen", () => {
  let live: PtyHost | undefined;
  let scriptDir: string | undefined;
  const teardown: (() => void)[] = [];

  afterEach(() => {
    for (const stop of teardown.splice(0)) stop();
    live?.dispose();
    live = undefined;
    if (scriptDir) rmSync(scriptDir, { recursive: true, force: true });
    scriptDir = undefined;
  });

  function spawnPainter(source: string): { host: PtyHost; id: PtyId } {
    const host = createPtyHost({ log: silentLog });
    live = host;
    scriptDir = mkdtempSync(join(tmpdir(), "kolu-lockstep-"));
    const script = join(scriptDir, "painter.cjs");
    writeFileSync(script, source);
    const { id } = host.spawn({
      shell: process.execPath,
      args: [script],
      env: shellEnv,
      cwd: "/tmp",
      cols: 100,
      rows: 30,
    });
    return { host, id };
  }

  /** The VIEWPORT, right-trimmed — what a person comparing the two sides would
   *  compare. Taken from the host through its own public read, so the mirror is
   *  never re-derived here. */
  const mirrorScreen = (host: PtyHost, id: PtyId): string =>
    trim(host.getScreenText(id, { kind: "viewport" }));

  const paneScreen = (term: HeadlessTerminal): string => {
    const buffer = term.buffer.active;
    const rows: string[] = [];
    for (let y = 0; y < term.rows; y++) {
      rows.push(
        buffer.getLine(buffer.viewportY + y)?.translateToString(true) ?? "",
      );
    }
    return trim(rows.join("\n"));
  };

  const trim = (text: string): string =>
    text
      .split("\n")
      .map((line) => line.replace(/\s+$/, ""))
      .join("\n")
      .replace(/\n+$/, "");

  /**
   * A PANE: a real terminal behind the kit's real write door, running the
   * attach loop a browser pane runs.
   *
   * `resizeEarly` is the CONTROL. A pane used to change its own size the moment
   * its box moved; here that is spelled as "apply this grid now, and ignore the
   * `resized` frame that says where the mirror actually moved". Everything else
   * about the two is identical, which is what makes the contrast mean something.
   */
  function openPane(
    host: PtyHost,
    id: PtyId,
    opts: { resizeEarly?: boolean } = {},
  ) {
    const term = new Terminal({
      cols: 100,
      rows: 30,
      allowProposedApi: true,
      scrollback: 1000,
    });
    // The door is typed against the browser terminal; `@xterm/headless` is the
    // same core minus the renderer, and the door touches only `write`, `resize`,
    // `cols/rows`, `buffer` and `onScroll`. The cast is the whole of the
    // difference, and `resizeTerminal`'s renderer-clear reads a private field
    // that is simply absent here (it is null-guarded).
    const asBrowser = term as unknown as DoorTerminal;

    let disposeLock = (): void => {};
    const lock = createRoot((dispose) => {
      disposeLock = dispose;
      // Visibility is injected: this runs in Node, where there is no document.
      const created = createScrollLock(
        () => true,
        () => "visible",
      );
      created.attachToTerminal(asBrowser);
      return created;
    });
    // Unfocused, so bytes really are batched — and the batch is held WIDER than
    // the program's tick, so when a `resized` arrives there are always bytes
    // waiting behind it. That is the state the door's ordering rule exists for,
    // and a door that applied the resize without walking them out first would
    // parse them at a size they were not written for.
    const door = createOutputCoalesce(
      () => false,
      {
        write: (data, onParsed) => lock.writeData(asBrowser, data, onParsed),
        resize: (cols, rows) => lock.resizeInOrder(cols, rows),
      },
      { intervalMs: COALESCE_MS },
    );

    const applySnapshot = (snapshot: string, grid: PtyGrid): void => {
      // A fresh snapshot replaces the screen: drop what the door is holding,
      // reset, take the grid the frame states, then paint. Exactly the order
      // `Terminal.tsx` uses.
      door.clear();
      lock.dropPending();
      term.reset();
      door.resize(grid.cols, grid.rows);
      door.write(snapshot);
    };

    const applyItem = (item: PtyDataItem): void => {
      if (item.kind === "bytes") {
        door.write(item.data);
        return;
      }
      // The control ignores this and has already resized itself.
      if (opts.resizeEarly) return;
      door.resize(item.grid.cols, item.grid.rows);
    };

    /** One attachment, consumed to its end. Answers how it ended, because a
     *  drop is the one end that owes a re-attach. */
    const leg = (resizeTo: PtyGrid | undefined) =>
      Effect.scoped(
        Effect.gen(function* () {
          const att = yield* host.attach(
            id,
            resizeTo ? { resizeTo } : undefined,
          );
          applySnapshot(att.snapshot, att.grid);
          return yield* Stream.runForEach(att.deltas, (item) =>
            Effect.sync(() => applyItem(item)),
          ).pipe(
            Effect.as("ended" as const),
            Effect.catchTag("SubscriberOverflow", () =>
              Effect.succeed("dropped" as const),
            ),
          );
        }),
      );

    const loop = Effect.gen(function* () {
      // Only the FIRST open asserts a grid; a re-attach takes whatever the pty
      // is at, which is what `local.ts` does and why a drop costs no size.
      let first = true;
      for (;;) {
        const outcome = yield* leg(first ? { cols: 100, rows: 30 } : undefined);
        first = false;
        if (outcome === "ended") return;
      }
    });
    const fiber = Effect.runFork(loop);

    const stop = (): void => {
      Effect.runFork(Fiber.interrupt(fiber));
      door.dispose();
      disposeLock();
      term.dispose();
    };
    teardown.push(stop);

    return {
      term,
      screen: () => paneScreen(term),
      /** What the CONTROL does when its box moves: take the new size now, at
       *  its own moment, with the program still writing for the old one. */
      resizeBox: (grid: PtyGrid) => {
        if (opts.resizeEarly) door.resize(grid.cols, grid.rows);
      },
      /** Flush anything the coalescer is still batching, so a comparison is
       *  never taken against bytes the door is holding for its own reasons. */
      flush: () => door.flush(),
    };
  }

  /** Poll `check` until it holds or the deadline passes; answers whether it
   *  held. Never a bare sleep — every wait here is for a condition. */
  async function until(check: () => boolean, ms: number): Promise<boolean> {
    const deadline = Date.now() + ms;
    for (;;) {
      if (check()) return true;
      if (Date.now() > deadline) return false;
      const tick = Promise.withResolvers<void>();
      setTimeout(() => tick.resolve(), 20);
      await tick.promise;
    }
  }

  /** Wait until the host's own mirror shows the program has gone quiet AT a
   *  given size — the one side that knows when the painting has stopped. Named
   *  by size rather than by how many resizes have happened: see the quiet
   *  marker in {@link PAINTER_SOURCE} for why a count cannot be waited on. */
  const settled = (host: PtyHost, id: PtyId, cols: number, rows: number) =>
    until(
      () =>
        host
          .getScreenText(id, { kind: "viewport" })
          .includes(`IDLE ${cols}x${rows}`),
      CONVERGE_MS,
    );

  /** Wait for the pane to catch up with the settled mirror. */
  async function agree(
    host: PtyHost,
    id: PtyId,
    pane: { screen: () => string; flush: () => void },
    ms = CONVERGE_MS,
  ): Promise<boolean> {
    return until(() => {
      pane.flush();
      return paneAgreesWith(host, id, pane);
    }, ms);
  }

  const paneAgreesWith = (
    host: PtyHost,
    id: PtyId,
    pane: { screen: () => string },
  ): boolean => pane.screen() === mirrorScreen(host, id);

  /** A failure that says WHERE they stopped agreeing, because "they differ" is
   *  not a diagnosis. */
  function diff(
    host: PtyHost,
    id: PtyId,
    pane: { screen: () => string },
  ): string {
    const mine = pane.screen().split("\n");
    const theirs = mirrorScreen(host, id).split("\n");
    const at = mine.findIndex((line, i) => line !== theirs[i]);
    return [
      `the pane and the mirror differ from row ${at < 0 ? mine.length : at}`,
      "pane:",
      ...mine.slice(0, 12).map((l) => `  |${l}`),
      "mirror:",
      ...theirs.slice(0, 12).map((l) => `  |${l}`),
    ].join("\n");
  }

  /** Start a fresh burst and wait until it has produced a few lines, so a
   *  resize issued next is genuinely landing on a writing program rather than
   *  racing its first tick. */
  async function burstUnderway(host: PtyHost, id: PtyId): Promise<void> {
    const before = host.getScreenText(id, { kind: "viewport" });
    host.write(id, "b");
    const started = await until(
      () => host.getScreenText(id, { kind: "viewport" }) !== before,
      CONVERGE_MS,
    );
    expect(started, "the program never answered the burst request").toBe(true);
    // Two more ticks, so what follows opens over output already moving — and
    // not so many that the burst is spent before the resize arrives.
    const ticks = Promise.withResolvers<void>();
    setTimeout(() => ticks.resolve(), TICK_MS * 2);
    await ticks.promise;
  }

  it(
    "agrees when the window ends UNDER budget — the held bytes are forwarded",
    async () => {
      const { host, id } = spawnPainter(PAINTER_SOURCE);
      const pane = openPane(host, id);
      expect(await settled(host, id, 100, 30)).toBe(true);
      expect(await agree(host, id, pane), diff(host, id, pane)).toBe(true);

      // The pane's box moved a settle window ago; the grid reaches the pty now,
      // with the program still writing at the old size. Its repaint is a few
      // hundred bytes, so the window ends by FORWARDING what it held.
      await burstUnderway(host, id);
      expect(host.resize(id, 70, 20)).toBe(true);
      expect(await settled(host, id, 70, 20)).toBe(true);
      expect(await agree(host, id, pane), diff(host, id, pane)).toBe(true);
      expect(pane.term.rows).toBe(20);
      expect(pane.term.cols).toBe(70);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "agrees when the window ends OVER budget — dropped, re-attached, re-snapshotted",
    async () => {
      // The same resize, answered by a repaint far larger than the host will
      // replay. Every viewer is dropped instead; the pane's own re-attach loop
      // is what repairs it, and the snapshot it is answered with carries the
      // grid it was serialized at.
      const { host, id } = spawnPainter(FLOOD_SOURCE);
      const pane = openPane(host, id);
      expect(await settled(host, id, 100, 30)).toBe(true);
      expect(await agree(host, id, pane), diff(host, id, pane)).toBe(true);

      await burstUnderway(host, id);
      expect(host.resize(id, 70, 20)).toBe(true);
      expect(await settled(host, id, 70, 20)).toBe(true);
      expect(await agree(host, id, pane), diff(host, id, pane)).toBe(true);
      expect(pane.term.rows).toBe(20);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "agrees across a SECOND resize inside an open window",
    async () => {
      const { host, id } = spawnPainter(PAINTER_SOURCE);
      const pane = openPane(host, id);
      expect(await settled(host, id, 100, 30)).toBe(true);
      expect(await agree(host, id, pane), diff(host, id, pane)).toBe(true);

      // Two sizes inside one window — a divider dragged through an intermediate
      // stop. The second resize DISCARDS everything the first was holding and
      // latches a re-sync, so what the pane is TOLD is both sizes and what it is
      // SENT is nothing more until it is dropped.
      await burstUnderway(host, id);
      expect(host.resize(id, 80, 24)).toBe(true);
      expect(host.resize(id, 60, 16)).toBe(true);

      // BETWEEN the second `resized` and the re-sync the pane's screen is its
      // old content reflowed into 60x16: the bytes that would have explained the
      // difference were discarded, and no repaint has arrived. So the only thing
      // guaranteed in that stretch is the SIZE — and it is guaranteed at once,
      // which is the whole reason the frame is never withheld.
      expect(
        await until(() => pane.term.rows === 16 && pane.term.cols === 60, 2000),
        "the pane was not told the second size",
      ).toBe(true);

      // …and then the re-sync repairs the content, which is the other half. The
      // wait is for quiet at the FINAL size: the two resizes may reach the
      // program as one SIGWINCH or as two, and the claim is the same either way.
      expect(await settled(host, id, 60, 16)).toBe(true);
      expect(await agree(host, id, pane), diff(host, id, pane)).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "does NOT agree when the pane resizes at its own box — today's behaviour",
    async () => {
      // The control. Identical program, identical host, identical door; the one
      // difference is that this pane takes the new size when its BOX moves and
      // ignores the frame that says where the mirror moved. The bytes written in
      // between are parsed at a size they were not laid out for, the program's
      // relative repaint then erases from the wrong row, and nothing later goes
      // back to repair it.
      const { host, id } = spawnPainter(PAINTER_SOURCE);
      const pane = openPane(host, id, { resizeEarly: true });
      expect(await settled(host, id, 100, 30)).toBe(true);
      expect(await agree(host, id, pane), diff(host, id, pane)).toBe(true);

      await burstUnderway(host, id);
      pane.resizeBox({ cols: 70, rows: 20 });
      // How long the pane runs ahead of the pty for: the client's grid settle
      // plus the publish, which is the gap this whole change is about.
      const gap = Promise.withResolvers<void>();
      setTimeout(() => gap.resolve(), PANE_RUNS_AHEAD_MS);
      await gap.promise;
      expect(host.resize(id, 70, 20)).toBe(true);

      expect(await settled(host, id, 70, 20)).toBe(true);
      // The band a person would be looking at: where the mirror kept refreshing
      // its status line, this pane has the log lines that scrolled under it.
      expect(
        await agree(host, id, pane, DIVERGENCE_MS),
        "the two screens AGREED — this control must diverge, or the cases above prove nothing",
      ).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );
});
