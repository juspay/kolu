import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createEngine, loadGhostty } from "./index.ts";
import { lineContinuesPrevious, lineText } from "./styled.ts";

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

  it("narrow-grid visual rows rejoin a known phrase via wrap flags", async () => {
    const eng = createEngine({ cols: 2, rows: 24 });
    try {
      eng.write("split-unique-text\r\n");
      const rows = eng.styledLines({ kind: "full" });
      const joined: string[] = [];
      for (let i = 0; i < rows.length; i++) {
        const text = lineText(rows[i]!);
        if (lineContinuesPrevious(rows, i, eng.cols) && joined.length > 0) {
          joined[joined.length - 1] += text;
        } else {
          joined.push(text);
        }
      }
      expect(joined.join("\n")).toContain("split-unique-text");
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

  it("keeps Starship-like prompt text and SGR in the shipped engine", () => {
    const eng = createEngine({ cols: 40, rows: 12 });
    try {
      // Representative Starship: palette + truecolor + unicode prompt + wrap.
      const wrap = "abcdefghijklmnopqrstuvwxyz012345";
      eng.write(
        "\x1b[0m\x1b[1m\x1b[38;5;6msrid\x1b[0m on \x1b[1m\x1b[38;5;3mnaiveintent\x1b[0m \x1b[1m\x1b[38;5;5m~\x1b[0m\r\n",
      );
      eng.write(`\x1b[38;2;88;88;88m❯\x1b[0m \x1b[38;5;4m${"\uE0B0"}\x1b[0m`);
      eng.write(`${wrap}\r\n`);
      const plain = eng.formatPlain();
      expect(plain).toContain("srid");
      expect(plain).toContain("naiveintent");
      expect(plain).toContain("~");
      expect(plain).toContain("❯");
      expect(plain).toContain("\uE0B0");
      expect(plain).toContain("abcdefghijklmnopqrst");
      const vt = eng.formatVt();
      expect(vt).toMatch(/\x1b\[/);
      expect(vt).toContain("srid");
      expect(vt).toContain("❯");
      const lines = eng.styledLines({ kind: "viewport" });
      const runs = lines.flatMap((l) => l.runs);
      const texts = runs.map((r) => r.text).join("");
      expect(texts).toContain("srid");
      expect(texts).toContain("naiveintent");
      expect(texts).toContain("❯");
      expect(texts).toContain("\uE0B0");
      const srid = runs.find((r) => r.text.includes("srid"));
      expect(srid?.style.fg).toEqual({ kind: "palette", index: 6 });
      expect(srid?.style.bold).toBe(true);
      const prompt = runs.find((r) => r.text.includes("❯"));
      expect(prompt?.style.fg).toEqual({ kind: "rgb", r: 88, g: 88, b: 88 });
      expect(lines.length).toBe(eng.rows);
    } finally {
      eng.free();
    }
  });

  it("keeps styled visual rows aligned with unwrapped trimmed plain", () => {
    const eng = createEngine({ cols: 20, rows: 8, scrollback: 40 });
    try {
      for (let i = 0; i < 12; i++) eng.write(`row-${i}\r\n`);
      const trimmed = eng.formatPlain({ unwrap: false, trim: true });
      const plainLines =
        trimmed.length === 0 ? [] : trimmed.replace(/\n$/, "").split(/\r?\n/);
      const styled = eng.styledLines({ kind: "full" });
      expect(styled.length).toBe(plainLines.length);
      expect(plainLines.some((l) => l.includes("row-11"))).toBe(true);
    } finally {
      eng.free();
    }
  });
});
