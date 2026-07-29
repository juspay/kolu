/** Scrollback-backfill server side: the bounded attach snapshot + the
 *  `getHistory` older-chunk read. The load-bearing property is the SEAM
 *  GUARANTEE — because the history cursor is an ABSOLUTE mirror-line index, a
 *  fetch serves strictly above the client's content no matter how much live
 *  output appends between the client reading its cursor and the host serving,
 *  so backfilled history can neither duplicate nor skip a row at the seam. A
 *  `have`-from-bottom cursor could not: it compares the host's produced-line
 *  count against the client's received count, which differ by the in-flight lag.
 */

import { createRequire } from "node:module";
import { describeDaemon } from "@kolu/daemon-test-gate";
import { afterEach, expect, it } from "vitest";
import {
  createPtyHost,
  type PtyHistoryChunk,
  type PtyHost,
} from "./ptyHost.ts";
import { silentLog } from "./silentLogger.testlib.ts";

/** Narrow a `getHistory` reply to its `chunk` arm, or fail — the common shape
 *  these tests assert on (the `stale` arm is asserted directly by the F3 test). */
function asChunk(
  r: PtyHistoryChunk,
): Extract<PtyHistoryChunk, { kind: "chunk" }> {
  if (r.kind !== "chunk")
    throw new Error(`expected a chunk reply, got ${r.kind}`);
  return r;
}

const require = createRequire(import.meta.url);
const { Terminal } =
  require("@xterm/headless") as typeof import("@xterm/headless");
const { SerializeAddon } =
  require("@xterm/addon-serialize") as typeof import("@xterm/addon-serialize");

async function waitFor(fn: () => boolean, ms = 8000): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Label at absolute mirror row `i`, given `L%04d` output with no wrapping (each
 *  logical line is exactly one 80-col row). */
const label = (i: number) => `L${String(i).padStart(4, "0")}`;

describeDaemon("scrollback backfill — bounded snapshot + getHistory", () => {
  let host: PtyHost;
  afterEach(() => host?.dispose());

  /** Spawn a shell printing `L0000`..`L{count-1}` in ascending order, then hold
   *  at a sleep so the mirror is stable while we read it. An optional `pauseAt`
   *  inserts a `sleep` mid-run so a test can attach after the first burst and
   *  observe the rest append. */
  function printLines(
    count: number,
    opts: { scrollback?: number; pauseAt?: number } = {},
  ) {
    host = createPtyHost({ log: silentLog });
    const pause =
      opts.pauseAt !== undefined
        ? ` [ $i -eq ${opts.pauseAt} ] && sleep 1;`
        : "";
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: [
        "-c",
        `i=0; while [ $i -lt ${count} ]; do printf 'L%04d\\n' $i;${pause} i=$((i+1)); done; sleep 30`,
      ],
      env: { PATH: process.env.PATH ?? "" },
      cwd: process.cwd(),
      scrollback: opts.scrollback,
    });
    return id;
  }

  it("bounds the attach snapshot below the full mirror, but keeps full history reachable", async () => {
    const id = printLines(1200);
    await waitFor(() => host.getScreenText(id).includes(label(1199)));

    const { snapshot, topLine } = host.attach(id);
    // The snapshot is the recent screenful — it must NOT carry the oldest lines
    // (that is the whole point: no 10k replay on attach), yet the full mirror
    // still holds them for backfill.
    expect(snapshot).not.toContain(label(0));
    expect(snapshot).toContain(label(1199));
    expect(host.getScreenText(id)).toContain(label(0));
    // The seed points at a real older line, not the top.
    expect(topLine).toBeGreaterThan(0);
    expect(host.getScreenText(id)).toContain(label(topLine));
  });

  it("serves strictly ABOVE the cursor even as output appends (seam guarantee)", async () => {
    // 1300 lines, pausing after 1200 so we can attach, then watch 100 more land.
    const id = printLines(1300, { pauseAt: 1200 });
    await waitFor(() => host.getScreenText(id).includes(label(1199)));
    const { topLine } = host.attach(id);

    // Read the older chunk BEFORE the second burst.
    const first = asChunk(host.getHistory(id, topLine, 50));
    // The chunk is the 50 rows immediately ABOVE `topLine`, from the known
    // ascending content.
    expect(first.chunk).toContain(label(topLine - 1)); // the row just above the seam
    expect(first.chunk).not.toContain(label(topLine)); // never re-serves the seam
    expect(first.topLine).toBe(topLine - 50);
    expect(first.exhausted).toBe(false);

    // Now the in-flight lag the coordinator flagged: 100 more lines append at the
    // BOTTOM between the client reading its cursor and re-fetching.
    await waitFor(() => host.getScreenText(id).includes(label(1299)));

    // The SAME absolute cursor returns the SAME rows — the appends did not shift
    // the window. A `have`-from-bottom cursor would have slid down by 100 here,
    // overlapping the snapshot's content: zero duplicate, zero missing, proven.
    const second = asChunk(host.getHistory(id, topLine, 50));
    expect(second.chunk).toBe(first.chunk);
    expect(second.chunk).not.toContain(label(1299)); // never the appended tail
    expect(second.topLine).toBe(topLine - 50);
  });

  it("pages older chunks down to exhaustion at the top of the mirror", async () => {
    const id = printLines(1200);
    await waitFor(() => host.getScreenText(id).includes(label(1199)));
    let cursor = host.attach(id).topLine;

    let guard = 0;
    let sawOldest = false;
    for (;;) {
      if (guard++ > 100) throw new Error("paging did not terminate");
      const res = asChunk(host.getHistory(id, cursor, 100));
      if (res.chunk.includes(label(0))) sawOldest = true;
      cursor = res.topLine;
      if (res.exhausted) break;
    }
    expect(sawOldest).toBe(true);
    expect(cursor).toBe(0);
    // A fetch past the top is an empty, exhausted no-op.
    const past = asChunk(host.getHistory(id, 0, 100));
    expect(past.chunk).toBe("");
    expect(past.exhausted).toBe(true);
  });

  it("tracks eviction so the cursor stays anchored (mirrorBaseLine)", async () => {
    // A shallow mirror forces eviction: 100 lines into a 50-line scrollback.
    const id = printLines(100, { scrollback: 50 });
    await waitFor(() => host.getScreenText(id).includes(label(99)));
    const { topLine } = host.attach(id);
    // The oldest retained line is not L0000 — earlier lines fell off the top, so
    // the absolute seed is shifted past them.
    expect(topLine).toBeGreaterThan(0);
    expect(host.getScreenText(id)).not.toContain(label(0));
    // Everything the mirror still holds is in the bounded snapshot (well under
    // 1000 lines), so there is nothing older to serve.
    const res = asChunk(host.getHistory(id, topLine, 100));
    expect(res.exhausted).toBe(true);
    expect(res.chunk).toBe("");
  });

  it("a gone PTY is an empty, exhausted no-op", () => {
    host = createPtyHost({ log: silentLog });
    expect(host.getHistory("nope", 10, 10)).toEqual({
      kind: "chunk",
      chunk: "",
      topLine: 10,
      exhausted: true,
    });
  });

  it("a stamped epoch stale against a foreign reflow serves nothing (F3)", async () => {
    const id = printLines(400);
    await waitFor(() => host.getScreenText(id).includes(label(399)));
    // Seed a cursor at generation 0, then a FOREIGN resize reflows the shared
    // mirror (bumps the reflow generation) without our cursor knowing.
    const seeded = asChunk(host.getHistory(id, undefined, 50, 0));
    expect(seeded.chunk).not.toBe("");
    host.resize(id, 100, 24);
    // A getHistory still stamped with the old generation now serves NOTHING — the
    // `stale` arm (no chunk at all) — so the client halts rather than pages a
    // renumbered cursor.
    expect(host.getHistory(id, seeded.topLine, 50, 0).kind).toBe("stale");
    // Re-seeding with the CURRENT generation pages normally again (a chunk arm).
    expect(host.getHistory(id, seeded.topLine, 50, 1).kind).toBe("chunk");
    // An UNSTAMPED read (older client / pager) is fail-open — never stale.
    expect(host.getHistory(id, seeded.topLine, 50).kind).toBe("chunk");
  });

  it("a height-only or same-dims resize does NOT stale a stamped cursor — only a width reflow renumbers (F3 over-bump)", async () => {
    const id = printLines(400);
    await waitFor(() => host.getScreenText(id).includes(label(399)));
    const seeded = asChunk(host.getHistory(id, undefined, 50, 0));
    expect(seeded.chunk).not.toBe("");

    // A HEIGHT-only resize (cols unchanged) reflows/renumbers NOTHING — absolute
    // rows are unmoved — so a cursor stamped at generation 0 must still page.
    host.resize(id, 80, 40);
    expect(host.getHistory(id, seeded.topLine, 50, 0).kind).toBe("chunk");

    // A SAME-DIMS resize (a second viewer attaching at the same size) is a pure
    // no-op — it must not bump the generation either.
    host.resize(id, 80, 40);
    expect(host.getHistory(id, seeded.topLine, 50, 0).kind).toBe("chunk");

    // Only a real WIDTH change renumbers → the stamped cursor goes stale.
    host.resize(id, 100, 40);
    expect(host.getHistory(id, seeded.topLine, 50, 0).kind).toBe("stale");
  });

  it("an in-band RIS (ESC c / `reset`) re-anchors the trim pin and stales pre-reset cursors (P3 buffer replacement)", async () => {
    // Phase 1: 120 lines, then a RIS, then phase 2: 120 more. The RIS replaces
    // the headless normal buffer's CircularList — the spawn-time onTrim pin goes
    // deaf and mirrorBaseLine freezes unless the reset is re-anchored.
    host = createPtyHost({ log: silentLog });
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: [
        "-c",
        "i=0; while [ $i -lt 120 ]; do printf 'L%04d\\n' $i; i=$((i+1)); done;" +
          " sleep 1; printf '\\033c';" +
          " while [ $i -lt 240 ]; do printf 'L%04d\\n' $i; i=$((i+1)); done; sleep 30",
      ],
      env: { PATH: process.env.PATH ?? "" },
      cwd: process.cwd(),
      scrollback: 50,
    });
    await waitFor(() => host.getScreenText(id).includes(label(119)));
    const pre = host.attach(id); // generation stamped BEFORE the RIS
    // Wait for the RIS + phase 2: the screen shows post-reset lines and no longer
    // the pre-reset tail.
    await waitFor(
      () =>
        host.getScreenText(id).includes(label(239)) &&
        !host.getScreenText(id).includes(label(119)),
    );

    // A cursor stamped before the RIS must be served `stale` (the reset renumbered
    // absolutes with the epoch unchanged on the buggy path), so the client
    // re-seeds instead of splicing the live screen as "older history".
    expect(host.getHistory(id, pre.topLine, 50, pre.reflowEpoch).kind).toBe(
      "stale",
    );

    // A fresh attach after the reset is self-consistent: its snapshot holds the
    // live screen, and getHistory from its seed never re-serves that newest line.
    const post = host.attach(id);
    expect(post.snapshot).toContain(label(239));
    const page = host.getHistory(id, post.topLine, 50, post.reflowEpoch);
    if (page.kind === "chunk") expect(page.chunk).not.toContain(label(239));
  });

  it("a non-positive max is a caller error (throws), even before the PTY lookup", () => {
    host = createPtyHost({ log: silentLog });
    // The wire schema rejects a non-positive `max`; the primitive fails loud too
    // rather than silently returning an empty, exhausted page.
    expect(() => host.getHistory("nope", undefined, 0)).toThrow(RangeError);
    expect(() => host.getHistory("nope", 10, -5)).toThrow(RangeError);
  });

  it("self-seeded history (before omitted) abuts the visible screen, not the snapshot top", async () => {
    const id = printLines(1200);
    await waitFor(() => host.getScreenText(id).includes(label(1199)));
    // The topmost label currently ON the visible screen.
    const viewport = host.getScreenText(id, { kind: "viewport" });
    const firstVisible = viewport.match(/L\d{4}/)?.[0];
    expect(firstVisible).toBeDefined();
    const n = Number((firstVisible as string).slice(1));
    // Self-seeding pages the lines IMMEDIATELY above the screen — it must serve
    // `label(n-1)` (the row just above the screen), NOT skip ~1000 lines down to
    // the bounded-snapshot top (which the browser already holds and the CLI is
    // asked to reveal).
    const page = asChunk(host.getHistory(id, undefined, 50));
    expect(page.chunk).toContain(label(n - 1));
    expect(page.chunk).not.toContain(label(n)); // never re-serves an on-screen row
  });
});

describeDaemon(
  "serialize({range}) fidelity — production chunks replay faithfully",
  () => {
    // The client replays each history chunk through a scratch terminal. Chunks are
    // NOT raw bytes: they are `serialize({range})` output. Prove that output, at
    // the same width, reproduces the mirror's own rows exactly (content + wrap
    // flags) — including a wrapped line spanning the chunk — so backfilled history
    // is indistinguishable from natively-parsed history.
    function makeTerm(cols: number, rows: number) {
      return new Terminal({
        cols,
        rows,
        scrollback: 1000,
        allowProposedApi: true,
      });
    }
    function write(t: InstanceType<typeof Terminal>, d: string) {
      return new Promise<void>((r) => t.write(d, r));
    }
    function rows(t: InstanceType<typeof Terminal>, from: number, to: number) {
      const out: Array<[string, boolean]> = [];
      for (let i = from; i <= to; i++) {
        const l = t.buffer.normal.getLine(i);
        if (!l) throw new Error(`row ${i} missing`);
        out.push([l.translateToString(true), l.isWrapped]);
      }
      return out;
    }

    it("reproduces a wrapped range row-for-row", async () => {
      const cols = 20;
      const mirror = makeTerm(cols, 5);
      const ser = new SerializeAddon();
      mirror.loadAddon(ser);
      const lines: string[] = [];
      for (let i = 0; i < 30; i++) {
        if (i === 7)
          lines.push(`h-${String(i).padStart(2, "0")}-${"W".repeat(45)}`);
        else lines.push(`h-${String(i).padStart(2, "0")}`);
      }
      await write(mirror, `${lines.join("\r\n")}\r\n`);

      // Serialize an OLDER range that includes the wrapped line (rows 0..14).
      const chunk = ser.serialize({
        range: { start: 0, end: 14 },
        excludeModes: true,
        excludeAltBuffer: true,
      });

      const scratch = makeTerm(cols, 5);
      await write(scratch, chunk);
      // Row-for-row identical to the mirror's own rows 0..14 (wrap flags included).
      expect(rows(scratch, 0, 14)).toEqual(rows(mirror, 0, 14));
    });

    it("a bounded-snapshot cut mid-wrapped-line snaps back to the logical head (no bisected top row)", async () => {
      // The exact bug the bounded-snapshot start guards against: `serialize` with a
      // `{scrollback}` window does NOT snap the top of the window to a logical head,
      // so a window whose top row is a wrapped CONTINUATION is emitted with the
      // continuation as a fresh line (its wrap flag lost, no preceding row present).
      // The production `snapshotStartLocal` walks the start BACK over `isWrapped`
      // rows before choosing the window depth, mirroring `getHistory`'s own snap.
      const cols = 20;
      const rowsHigh = 4;
      const mirror = makeTerm(cols, rowsHigh);
      const ser = new SerializeAddon();
      mirror.loadAddon(ser);
      const lines: string[] = [];
      for (let i = 0; i < 30; i++)
        lines.push(
          i % 2 === 0
            ? `L${String(i).padStart(2, "0")}-${"W".repeat(30)}` // wraps to 2 rows
            : `L${String(i).padStart(2, "0")}`,
        );
      await write(mirror, `${lines.join("\r\n")}\r\n`);

      const len = mirror.buffer.normal.length;
      // Find a wrapped CONTINUATION row in the scrollback region to cut at.
      let cutRow = -1;
      for (let i = 3; i < len - rowsHigh; i++)
        if (mirror.buffer.normal.getLine(i)?.isWrapped) {
          cutRow = i;
          break;
        }
      expect(cutRow).toBeGreaterThan(0);

      const topOf = async (start: number): Promise<string> => {
        // serialize({scrollback: S}) emits its top row at local `len - rows - S`.
        const out = ser.serialize({ scrollback: len - rowsHigh - start });
        const scratch = makeTerm(cols, rowsHigh);
        await write(scratch, out);
        const top =
          scratch.buffer.normal.getLine(0)?.translateToString(true) ?? "";
        scratch.dispose();
        return top;
      };

      // NAIVE cut on the continuation bisects — the top row is the label-less wrap tail.
      expect(await topOf(cutRow)).toMatch(/^W+$/);
      // SNAPPED start (walk back over `isWrapped` to the head) — the top row is the
      // logical head, carrying its `L##` label, so the seam is never a hard break.
      let snapped = cutRow;
      while (snapped > 0 && mirror.buffer.normal.getLine(snapped)?.isWrapped)
        snapped--;
      expect(await topOf(snapped)).toMatch(/^L\d{2}/);
    });
  },
);
