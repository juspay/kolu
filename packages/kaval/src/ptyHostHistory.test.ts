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
import { afterEach, describe, expect, it } from "vitest";
import { createPtyHost, type PtyHost } from "./ptyHost.ts";

const require = createRequire(import.meta.url);
const { Terminal } =
  require("@xterm/headless") as typeof import("@xterm/headless");
const { SerializeAddon } =
  require("@xterm/addon-serialize") as typeof import("@xterm/addon-serialize");

const silentLog = {
  debug() {},
  info() {},
  warn() {},
  error() {},
} as unknown as Parameters<typeof createPtyHost>[0]["log"];

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

describe("scrollback backfill — bounded snapshot + getHistory", () => {
  let host: PtyHost;
  afterEach(() => host?.dispose());

  /** Spawn a shell printing `L0000`..`L{count-1}` in ascending order, then hold
   *  at a sleep so the mirror is stable while we read it. An optional `pauseAt`
   *  inserts a `sleep` mid-run so a test can attach after the first burst and
   *  observe the rest append. */
  function printLines(count: number, opts: { scrollback?: number; pauseAt?: number } = {}) {
    host = createPtyHost({ log: silentLog });
    const pause =
      opts.pauseAt !== undefined ? ` [ $i -eq ${opts.pauseAt} ] && sleep 1;` : "";
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
    const first = host.getHistory(id, topLine, 50);
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
    const second = host.getHistory(id, topLine, 50);
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
      const res = host.getHistory(id, cursor, 100);
      if (res.chunk.includes(label(0))) sawOldest = true;
      cursor = res.topLine;
      if (res.exhausted) break;
    }
    expect(sawOldest).toBe(true);
    expect(cursor).toBe(0);
    // A fetch past the top is an empty, exhausted no-op.
    const past = host.getHistory(id, 0, 100);
    expect(past.chunk).toBe("");
    expect(past.exhausted).toBe(true);
  });

  it("tracks eviction so the cursor stays anchored (mirrorBaseLine)", async () => {
    // A shallow mirror forces eviction: 100 lines into a 50-line scrollback.
    const id = printLines(100, 50);
    await waitFor(() => host.getScreenText(id).includes(label(99)));
    const { topLine } = host.attach(id);
    // The oldest retained line is not L0000 — earlier lines fell off the top, so
    // the absolute seed is shifted past them.
    expect(topLine).toBeGreaterThan(0);
    expect(host.getScreenText(id)).not.toContain(label(0));
    // Everything the mirror still holds is in the bounded snapshot (well under
    // 1000 lines), so there is nothing older to serve.
    const res = host.getHistory(id, topLine, 100);
    expect(res.exhausted).toBe(true);
    expect(res.chunk).toBe("");
  });

  it("gone / non-positive requests are empty, exhausted no-ops", () => {
    host = createPtyHost({ log: silentLog });
    expect(host.getHistory("nope", 10, 10)).toEqual({
      chunk: "",
      topLine: 10,
      exhausted: true,
    });
  });
});

describe("serialize({range}) fidelity — production chunks replay faithfully", () => {
  // The client replays each history chunk through a scratch terminal. Chunks are
  // NOT raw bytes: they are `serialize({range})` output. Prove that output, at
  // the same width, reproduces the mirror's own rows exactly (content + wrap
  // flags) — including a wrapped line spanning the chunk — so backfilled history
  // is indistinguishable from natively-parsed history.
  function makeTerm(cols: number, rows: number) {
    return new Terminal({ cols, rows, scrollback: 1000, allowProposedApi: true });
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
      if (i === 7) lines.push(`h-${String(i).padStart(2, "0")}-${"W".repeat(45)}`);
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
});
