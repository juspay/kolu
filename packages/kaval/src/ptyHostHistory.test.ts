import { createRequire } from "node:module";
import { describeDaemon } from "@kolu/daemon-test-gate";
import { afterEach, expect, it } from "vitest";
import {
  createPtyHost,
  type PtyHistoryChunk,
  type PtyHost,
} from "./ptyHost.ts";
import { silentLogger as silentLog } from "@kolu/log/loggerStubs.testutil";
import { runScopedSync } from "./streamFrame.testlib.ts";

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

const label = (i: number) => `L${String(i).padStart(4, "0")}`;

describeDaemon("scrollback backfill — bounded snapshot + getHistory", () => {
  let host: PtyHost;
  afterEach(() => host?.dispose());

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

    const { snapshot, topLine } = runScopedSync(host.attach(id));
    expect(snapshot).not.toContain(label(0));
    expect(snapshot).toContain(label(1199));
    expect(host.getScreenText(id)).toContain(label(0));
    expect(topLine).toBeGreaterThan(0);
    expect(host.getScreenText(id)).toContain(label(topLine));
  });

  it("serves strictly ABOVE the cursor even as output appends (seam guarantee)", async () => {
    const id = printLines(1300, { pauseAt: 1200 });
    await waitFor(() => host.getScreenText(id).includes(label(1199)));
    const { topLine } = runScopedSync(host.attach(id));

    const first = asChunk(host.getHistory(id, topLine, 50));
    expect(first.chunk).toContain(label(topLine - 1));
    expect(first.chunk).not.toContain(label(topLine));
    expect(first.topLine).toBe(topLine - 50);
    expect(first.exhausted).toBe(false);

    await waitFor(() => host.getScreenText(id).includes(label(1299)));

    const second = asChunk(host.getHistory(id, topLine, 50));
    expect(second.chunk).toBe(first.chunk);
    expect(second.chunk).not.toContain(label(1299));
    expect(second.topLine).toBe(topLine - 50);
  });

  it("pages older chunks down to exhaustion at the top of the mirror", async () => {
    const id = printLines(1200);
    await waitFor(() => host.getScreenText(id).includes(label(1199)));
    let cursor = runScopedSync(host.attach(id)).topLine;

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
    const past = asChunk(host.getHistory(id, 0, 100));
    expect(past.chunk).toBe("");
    expect(past.exhausted).toBe(true);
  });

  it("tracks eviction so the cursor stays anchored (mirrorBaseLine)", async () => {
    const id = printLines(100, { scrollback: 50 });
    await waitFor(() => host.getScreenText(id).includes(label(99)));
    const { topLine } = runScopedSync(host.attach(id));
    expect(topLine).toBeGreaterThan(0);
    expect(host.getScreenText(id)).not.toContain(label(0));
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
    const seeded = asChunk(host.getHistory(id, undefined, 50, 0));
    expect(seeded.chunk).not.toBe("");
    host.resize(id, 100, 24);
    expect(host.getHistory(id, seeded.topLine, 50, 0).kind).toBe("stale");
    expect(host.getHistory(id, seeded.topLine, 50, 1).kind).toBe("chunk");
    expect(host.getHistory(id, seeded.topLine, 50).kind).toBe("chunk");
  });

  it("a height-only or same-dims resize does NOT stale a stamped cursor — only a width reflow renumbers (F3 over-bump)", async () => {
    const id = printLines(400);
    await waitFor(() => host.getScreenText(id).includes(label(399)));
    const seeded = asChunk(host.getHistory(id, undefined, 50, 0));
    expect(seeded.chunk).not.toBe("");

    host.resize(id, 80, 40);
    expect(host.getHistory(id, seeded.topLine, 50, 0).kind).toBe("chunk");

    host.resize(id, 80, 40);
    expect(host.getHistory(id, seeded.topLine, 50, 0).kind).toBe("chunk");

    host.resize(id, 100, 40);
    expect(host.getHistory(id, seeded.topLine, 50, 0).kind).toBe("stale");
  });

  it("an in-band RIS (ESC c / `reset`) re-anchors the trim pin and stales pre-reset cursors (P3 buffer replacement)", async () => {
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
    const pre = runScopedSync(host.attach(id));
    await waitFor(
      () =>
        host.getScreenText(id).includes(label(239)) &&
        !host.getScreenText(id).includes(label(119)),
    );

    expect(host.getHistory(id, pre.topLine, 50, pre.reflowEpoch).kind).toBe(
      "stale",
    );

    const post = runScopedSync(host.attach(id));
    expect(post.snapshot).toContain(label(239));
    const page = host.getHistory(id, post.topLine, 50, post.reflowEpoch);
    if (page.kind === "chunk") expect(page.chunk).not.toContain(label(239));
  });

  it("a non-positive max is a caller error (throws), even before the PTY lookup", () => {
    host = createPtyHost({ log: silentLog });
    expect(() => host.getHistory("nope", undefined, 0)).toThrow(RangeError);
    expect(() => host.getHistory("nope", 10, -5)).toThrow(RangeError);
  });

  it("self-seeded history (before omitted) abuts the visible screen, not the snapshot top", async () => {
    const id = printLines(1200);
    await waitFor(() => host.getScreenText(id).includes(label(1199)));
    const viewport = host.getScreenText(id, { kind: "viewport" });
    const firstVisible = viewport.match(/L\d{4}/)?.[0];
    expect(firstVisible).toBeDefined();
    const n = Number((firstVisible as string).slice(1));
    const page = asChunk(host.getHistory(id, undefined, 50));
    expect(page.chunk).toContain(label(n - 1));
    expect(page.chunk).not.toContain(label(n));
  });
});

describeDaemon(
  "serialize({range}) fidelity — production chunks replay faithfully",
  () => {
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

      const chunk = ser.serialize({
        range: { start: 0, end: 14 },
        excludeModes: true,
        excludeAltBuffer: true,
      });

      const scratch = makeTerm(cols, 5);
      await write(scratch, chunk);
      expect(rows(scratch, 0, 14)).toEqual(rows(mirror, 0, 14));
    });

    it("a bounded-snapshot cut mid-wrapped-line snaps back to the logical head (no bisected top row)", async () => {
      const cols = 20;
      const rowsHigh = 4;
      const mirror = makeTerm(cols, rowsHigh);
      const ser = new SerializeAddon();
      mirror.loadAddon(ser);
      const lines: string[] = [];
      for (let i = 0; i < 30; i++)
        lines.push(
          i % 2 === 0
            ? `L${String(i).padStart(2, "0")}-${"W".repeat(30)}`
            : `L${String(i).padStart(2, "0")}`,
        );
      await write(mirror, `${lines.join("\r\n")}\r\n`);

      const len = mirror.buffer.normal.length;
      let cutRow = -1;
      for (let i = 3; i < len - rowsHigh; i++)
        if (mirror.buffer.normal.getLine(i)?.isWrapped) {
          cutRow = i;
          break;
        }
      expect(cutRow).toBeGreaterThan(0);

      const topOf = async (start: number): Promise<string> => {
        const out = ser.serialize({ scrollback: len - rowsHigh - start });
        const scratch = makeTerm(cols, rowsHigh);
        await write(scratch, out);
        const top =
          scratch.buffer.normal.getLine(0)?.translateToString(true) ?? "";
        scratch.dispose();
        return top;
      };

      expect(await topOf(cutRow)).toMatch(/^W+$/);
      let snapped = cutRow;
      while (snapped > 0 && mirror.buffer.normal.getLine(snapped)?.isWrapped)
        snapped--;
      expect(await topOf(snapped)).toMatch(/^L\d{2}/);
    });
  },
);
