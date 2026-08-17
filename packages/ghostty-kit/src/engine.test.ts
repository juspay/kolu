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
    expect(pin.byteLength).toBe(900284);
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

  it("fires OSC 52 and a command-run that split across two writes", () => {
    const commands: string[] = [];
    const clips: { sel: string; payload: string }[] = [];
    const eng = createEngine({
      cols: 40,
      rows: 8,
      onCommandRun: (c) => commands.push(c),
      onOsc52: (sel, payload) => clips.push({ sel, payload }),
    });
    try {
      eng.write("\x1b]633;E;npm te");
      expect(commands).toEqual([]);
      eng.write("st\x07");
      expect(commands).toEqual(["npm test"]);
      eng.write("\x1b]52;c;Zm9");
      expect(clips).toEqual([]);
      eng.write("v\x07");
      expect(clips).toEqual([{ sel: "c", payload: "Zm9v" }]);
    } finally {
      eng.free();
    }
  });

  it("tracks DECCKM so arrows can use application-cursor bytes", () => {
    const eng = createEngine({ cols: 20, rows: 6 });
    try {
      expect(eng.applicationCursor()).toBe(false);
      eng.write("\x1b[?1h");
      expect(eng.applicationCursor()).toBe(true);
      eng.write("\x1bc");
      expect(eng.applicationCursor()).toBe(false);
    } finally {
      eng.free();
    }
  });

  it("keeps wrap history on the visual-row axis", () => {
    const eng = createEngine({ cols: 8, rows: 4, scrollback: 20 });
    try {
      eng.write("ABCDEFGHIJKLMNOPQRSTUVWXYZ\r\n");
      const visual = eng.visualLineCount();
      const vt = eng.formatVt({ unwrap: false, trim: true });
      const vtRows = vt.length === 0 ? [] : vt.split(/\r?\n/);
      expect(visual).toBe(vtRows.length);
      expect(visual).toBeGreaterThan(1);
      const slice = eng.formatRangeVt(0, visual - 1);
      const sliceRows = slice.length === 0 ? [] : slice.split(/\r?\n/);
      expect(sliceRows.length).toBe(visual);
    } finally {
      eng.free();
    }
  });

  it("treats wasm prune as eviction, not RIS", () => {
    const eng = createEngine({ cols: 80, rows: 5, scrollback: 40 });
    try {
      const startEpoch = eng.reflowEpoch();
      let sawPrune = false;
      let prev = eng.totalRows();
      const fat = "x".repeat(70);
      for (let i = 0; i < 2000; i++) {
        eng.write(`${fat}-${i}\r\n`);
        const total = eng.totalRows();
        if (total < prev) {
          sawPrune = true;
          expect(eng.reflowEpoch()).toBe(startEpoch);
          expect(eng.baseLine()).toBe(prev - total);
          break;
        }
        prev = total;
      }
      expect(sawPrune).toBe(true);
    } finally {
      eng.free();
    }
  });

  it("formats only a viewport/tail, not the full scrollback", () => {
    const eng = createEngine({ cols: 20, rows: 6, scrollback: 400 });
    try {
      for (let i = 0; i < 200; i++)
        eng.write(`row-${String(i).padStart(3, "0")}\r\n`);
      const view = eng.styledLines({ kind: "viewport" });
      const viewBytes = eng.lastFormatBytes();
      const full = eng.styledLines({ kind: "full" });
      const fullBytes = eng.lastFormatBytes();
      expect(view.length).toBe(eng.rows);
      expect(full.length).toBeGreaterThan(view.length);
      expect(viewBytes).toBeGreaterThan(0);
      expect(viewBytes).toBeLessThan(fullBytes / 4);
      const texts = view.flatMap((l) => l.runs.map((r) => r.text)).join("");
      expect(texts).toContain("row-199");
      expect(texts).not.toContain("row-000");
    } finally {
      eng.free();
    }
  });

  it("tails the visual-row axis, not totalRows padding", () => {
    const eng = createEngine({ cols: 20, rows: 6, scrollback: 80 });
    try {
      for (let i = 0; i < 40; i++)
        eng.write(`vis-${String(i).padStart(2, "0")}\r\n`);
      const visual = eng.visualLineCount();
      const full = eng.styledLines({ kind: "full" });
      const tail = eng.styledLines({ kind: "tail", lines: 10 });
      expect(visual).toBe(full.length);
      expect(tail.length).toBe(10);
      expect(lineText(tail[0] ?? { runs: [] })).toBe(
        lineText(full[full.length - 10] ?? { runs: [] }),
      );
    } finally {
      eng.free();
    }
  });

  it("does not re-format the whole buffer to recount visual lines after a write", () => {
    const eng = createEngine({ cols: 20, rows: 6, scrollback: 80 });
    try {
      for (let i = 0; i < 20; i++) eng.write(`n-${i}\r\n`);
      const before = eng.visualLineCount();
      const bytes = eng.lastFormatBytes();
      expect(bytes).toBeGreaterThan(0);
      eng.write("one-more\r\n");
      const after = eng.visualLineCount();
      expect(eng.lastFormatBytes()).toBe(bytes);
      expect(after).toBeGreaterThan(before);
    } finally {
      eng.free();
    }
  });

  it("reseeds when one write fills trailing blanks and then overflows", () => {
    const eng = createEngine({ cols: 20, rows: 8, scrollback: 80 });
    try {
      eng.write("seed-line\r\n");
      expect(eng.visualLineCount()).toBeLessThan(eng.rows);
      expect(eng.totalRows()).toBe(eng.rows);
      const burst = Array.from(
        { length: 20 },
        (_, i) => `burst-${String(i).padStart(2, "0")}`,
      ).join("\r\n");
      eng.write(`${burst}\r\n`);
      const tail = eng.styledLines({ kind: "tail", lines: 4 });
      expect(lineText(tail[tail.length - 1] ?? { runs: [] })).toContain(
        "burst-19",
      );
      const vt = eng.formatVt({ unwrap: false, trim: true });
      const vtRows = vt.length === 0 ? [] : vt.split(/\r?\n/);
      expect(eng.visualLineCount()).toBe(vtRows.length);
      expect(eng.visualLineCount()).toBeGreaterThan(eng.rows);
    } finally {
      eng.free();
    }
  });

  it("reseeds visual count after filling trailing blanks without a resize", () => {
    const eng = createEngine({ cols: 20, rows: 8, scrollback: 40 });
    try {
      eng.write("seed-line\r\n");
      const seeded = eng.visualLineCount();
      expect(seeded).toBeLessThan(eng.rows);
      expect(eng.totalRows()).toBe(eng.rows);
      for (let i = 0; i < 6; i++) eng.write(`fill-${i}\r\n`);
      const tail = eng.styledLines({ kind: "tail", lines: 3 });
      expect(lineText(tail[tail.length - 1] ?? { runs: [] })).toContain(
        "fill-5",
      );
      const vt = eng.formatVt({ unwrap: false, trim: true });
      const vtRows = vt.length === 0 ? [] : vt.split(/\r?\n/);
      expect(eng.visualLineCount()).toBe(vtRows.length);
      expect(eng.visualLineCount()).toBeGreaterThan(seeded);
    } finally {
      eng.free();
    }
  });

  it("reseeds visual count after ED 2", () => {
    const eng = createEngine({ cols: 20, rows: 8, scrollback: 40 });
    try {
      for (let i = 0; i < 5; i++) eng.write(`keep-${i}\r\n`);
      expect(eng.visualLineCount()).toBeGreaterThan(1);
      eng.write("\x1b[2J\x1b[H");
      eng.write("after-clear\r\n");
      // Paint path: tail before any visualLineCount reseed.
      const tail = eng.styledLines({ kind: "tail", lines: 4 });
      expect(tail.map((l) => lineText(l)).join("\n")).toContain("after-clear");
      const afterVt = eng.formatVt({ unwrap: false, trim: true });
      const afterRows = afterVt.length === 0 ? [] : afterVt.split(/\r?\n/);
      expect(eng.visualLineCount()).toBe(afterRows.length);
    } finally {
      eng.free();
    }
  });

  it("reseeds visual count on alt-screen enter and leave", () => {
    const eng = createEngine({ cols: 20, rows: 8, scrollback: 40 });
    try {
      eng.write("main-before\r\n");
      const main = eng.visualLineCount();
      eng.write("\x1b[?1049h");
      eng.write("alt-page\r\n");
      const altTail = eng.styledLines({ kind: "tail", lines: 4 });
      expect(altTail.map((l) => lineText(l)).join("\n")).toContain("alt-page");
      eng.write("\x1b[?1049l");
      const tail = eng.styledLines({ kind: "tail", lines: 4 });
      expect(tail.map((l) => lineText(l)).join("\n")).toContain("main-before");
      const backVt = eng.formatVt({ unwrap: false, trim: true });
      const backRows = backVt.length === 0 ? [] : backVt.split(/\r?\n/);
      expect(eng.visualLineCount()).toBe(backRows.length);
      expect(eng.visualLineCount()).toBe(main);
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
