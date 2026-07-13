/** Contract pin for the `@xterm/headless` internals the mirror reaches through.
 *
 *  kaval's `getHistory` stays on PUBLIC xterm API (buffer length, `getLine`,
 *  `isWrapped`, `serialize({range})`) — the ONE private reach is
 *  `_core.buffers.normal.lines.onTrim`, the eviction count that anchors the
 *  absolute history cursor (there is no public source for it). This is the
 *  headless twin of the sibling `scrollbackBackfill.test.ts` pin: an
 *  `@xterm/headless` bump that moves the pinned symbol must fail HERE, loudly,
 *  not by silently freezing `mirrorBaseLine` while the buffer renumbers under it
 *  (a silent scrollback corruption). Every symbol below is verified
 *  shape-identical to the `@xterm/xterm` beta in that sibling test. */

import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { Terminal } =
  require("@xterm/headless") as typeof import("@xterm/headless");
const { SerializeAddon } =
  require("@xterm/addon-serialize") as typeof import("@xterm/addon-serialize");

function write(t: InstanceType<typeof Terminal>, d: string) {
  return new Promise<void>((r) => t.write(d, r));
}

describe("xterm-headless mirror contract", () => {
  it("_core.buffers.normal.lines.onTrim exists and fires the evicted count", async () => {
    const term = new Terminal({
      cols: 20,
      rows: 3,
      scrollback: 5,
      allowProposedApi: true,
    });
    const lines = (
      term as unknown as {
        _core?: {
          buffers?: {
            normal?: { lines?: { onTrim?: unknown; length?: unknown } };
          };
        };
      }
    )._core?.buffers?.normal?.lines as
      | {
          onTrim(l: (n: number) => void): { dispose(): void };
          length: number;
        }
      | undefined;
    expect(lines, "_core.buffers.normal.lines").toBeTruthy();
    expect(lines!.onTrim, "lines.onTrim").toBeTypeOf("function");
    // `length` is pinned too: the RIS re-anchor does `mirrorBaseLine +=
    // lines.length`, so a shape change that dropped it would poison the absolute
    // cursor with NaN rather than fail loud (`normalLinesOf` throws on it).
    expect(lines!.length, "lines.length").toBeTypeOf("number");
    expect(Number.isInteger(lines!.length), "lines.length is an integer").toBe(
      true,
    );

    let evicted = 0;
    // onTrim returns a disposable (the trim pin is disposed + re-subscribed on a
    // RIS buffer swap — a non-disposable return would leak the subscription).
    const trimSub = lines!.onTrim((n) => (evicted += n));
    expect(trimSub.dispose, "onTrim(...).dispose").toBeTypeOf("function");
    // maxLength = scrollback + rows = 8; write well past it so the ring trims.
    const many: string[] = [];
    for (let i = 0; i < 30; i++) many.push(`row-${i}`);
    await write(term, `${many.join("\r\n")}\r\n`);
    expect(evicted).toBeGreaterThan(0);
  });

  it("public buffer + serialize({range}) shape getHistory relies on", async () => {
    const term = new Terminal({
      cols: 20,
      rows: 3,
      scrollback: 100,
      allowProposedApi: true,
    });
    const ser = new SerializeAddon();
    term.loadAddon(ser);
    await write(term, "aaa\r\nbbb\r\nccc\r\n");

    const normal = term.buffer.normal;
    expect(normal.length, "buffer.normal.length").toBeTypeOf("number");
    const line = normal.getLine(0);
    expect(line, "buffer.normal.getLine(0)").toBeTruthy();
    expect(line!.isWrapped, "line.isWrapped").toBeTypeOf("boolean");

    // Range serialize returns the requested rows and nothing outside them.
    const chunk = ser.serialize({
      range: { start: 0, end: 0 },
      excludeModes: true,
      excludeAltBuffer: true,
    });
    expect(chunk).toContain("aaa");
    expect(chunk).not.toContain("ccc");
  });
});
