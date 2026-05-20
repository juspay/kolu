import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { getScreenText } from "./pty.ts";

// @xterm packages ship CJS only — same interop as pty.ts
const require = createRequire(import.meta.url);
const { Terminal } =
  require("@xterm/headless") as typeof import("@xterm/headless");

/** Write data to terminal and wait for it to be processed. */
function writeAndFlush(
  term: InstanceType<typeof Terminal>,
  data: string,
): Promise<void> {
  return new Promise((resolve) => term.write(data, resolve));
}

describe("getScreenText", () => {
  function createTerminal(
    opts: { cols?: number; rows?: number } = {},
  ): InstanceType<typeof Terminal> {
    return new Terminal({
      cols: opts.cols ?? 80,
      rows: opts.rows ?? 24,
      allowProposedApi: true,
    });
  }

  it("returns empty lines for a fresh terminal", () => {
    const term = createTerminal({ rows: 3 });
    const text = getScreenText(term.buffer.active);
    expect(text.trim()).toBe("");
    term.dispose();
  });

  it("returns written text", async () => {
    const term = createTerminal();
    await writeAndFlush(term, "hello world\r\nsecond line\r\n");
    const text = getScreenText(term.buffer.active);
    expect(text).toContain("hello world");
    expect(text).toContain("second line");
    term.dispose();
  });

  it("respects startLine and endLine range", async () => {
    const term = createTerminal({ rows: 10 });
    await writeAndFlush(term, "line0\r\nline1\r\nline2\r\nline3\r\n");
    const text = getScreenText(term.buffer.active, 1, 3);
    const lines = text.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("line1");
    expect(lines[1]).toContain("line2");
    term.dispose();
  });

  it("clamps out-of-bounds range", async () => {
    const term = createTerminal({ rows: 5 });
    await writeAndFlush(term, "only line\r\n");
    const text = getScreenText(term.buffer.active, -5, 1000);
    expect(text).toContain("only line");
    term.dispose();
  });
});
