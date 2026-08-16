import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createEngine, loadGhostty } from "./index.ts";

describe("official ghostty-vt.wasm engine", () => {
  it("loads the pinned Ghostty release asset and exports vt_write", async () => {
    const wasm = loadGhostty();
    expect(typeof wasm.exports.ghostty_terminal_vt_write).toBe("function");
    expect(typeof wasm.exports.ghostty_terminal_resize).toBe("function");
    const pin = readFileSync(
      fileURLToPath(new URL("../vendor/ghostty-vt.wasm", import.meta.url)),
    );
    expect(pin.byteLength).toBe(876132);
  });

  it("writes plain text, SGR, and wrap into cells the formatter can read", async () => {
    const eng = createEngine({ cols: 20, rows: 8 });
    try {
      eng.write("Hello, World!\r\n");
      eng.write("\x1b[1;32mGreen\x1b[0m text\r\n");
      const long = "abcdefghijklmnopqrstuvwxyz";
      eng.write(`${long}\r\n`);
      const plain = eng.formatPlain();
      expect(plain).toContain("Hello, World!");
      expect(plain).toContain("Green text");
      expect(plain).toContain("abcdefghijklmnopqrst");
      const vt = eng.formatVt();
      expect(vt).toContain("Hello, World!");
      expect(vt).toMatch(/\x1b\[/);
    } finally {
      eng.free();
    }
  });

  it("reflows on resize through ghostty_terminal_resize", async () => {
    const eng = createEngine({ cols: 40, rows: 8 });
    try {
      eng.write("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789\r\n");
      const before = eng.formatPlain();
      expect(before).toContain("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");
      eng.resize(10, 8);
      const after = eng.formatPlain({ unwrap: false, trim: true });
      expect(after).toContain("ABCDEFGHIJ");
      expect(eng.cols).toBe(10);
      expect(eng.reflowEpoch()).toBeGreaterThan(0);
    } finally {
      eng.free();
    }
  });

  it("round-trips a snapshot through the official encoder/decoder", async () => {
    const eng = createEngine({ cols: 40, rows: 8 });
    try {
      eng.write("snapshot-payload-XYZ\r\n");
      const snap = eng.encodeSnapshot();
      expect(snap.byteLength).toBeGreaterThan(8);
      expect(new TextDecoder().decode(snap.slice(0, 8))).toBe("GHOSTSNP");
      const other = createEngine({ cols: 40, rows: 8 });
      try {
        other.restoreSnapshot(snap);
        expect(other.formatPlain()).toContain("snapshot-payload-XYZ");
      } finally {
        other.free();
      }
    } finally {
      eng.free();
    }
  });

  it("surfaces OSC 7 cwd, OSC 2 title, and OSC 633 command-run", async () => {
    const commands: string[] = [];
    const titles: string[] = [];
    const pwds: string[] = [];
    const eng = createEngine({
      cols: 40,
      rows: 8,
      onTitle: (t) => titles.push(t),
      onPwd: (p) => pwds.push(p),
      onCommandRun: (c) => commands.push(c),
    });
    try {
      eng.write("\x1b]7;file://host/tmp/cwd-test\x1b\\");
      eng.write("\x1b]2;My Window Title\x1b\\");
      eng.write("\x1b]633;E;npm test\x07");
      expect(eng.getPwd()).toContain("/tmp/cwd-test");
      expect(eng.getTitle()).toBe("My Window Title");
      expect(commands).toEqual(["npm test"]);
    } finally {
      eng.free();
    }
  });
});
