/** Manual smoke: drive a real @xterm/headless buffer through the whole
 *  pipeline and write a PNG, so the render can be LOOKED AT.
 *
 *  Not a unit test — it needs the Nix font directory and writes a file.
 *  Run it from the repo root with:
 *    node --import tsx packages/terminal-snapshot/src/render.smoke.ts /tmp/out.png
 */

import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { DEFAULT_THEME } from "terminal-themes";
import { readGrid } from "./cell.ts";
import { sceneToPng, PNG_CELL_WIDTH_RATIO, PNG_FONT_FAMILY } from "./png.ts";
import { buildScene } from "./scene.ts";

const require = createRequire(import.meta.url);
const { Terminal } =
  require("@xterm/headless") as typeof import("@xterm/headless");

const out = process.argv[2] ?? "/tmp/terminal-snapshot.png";
const cols = 74;
const rows = 12;
const term = new Terminal({ cols, rows, allowProposedApi: true });

const write = (s: string) =>
  new Promise<void>((resolve) => term.write(s, resolve));

await write(
  "\x1b[1;32m$\x1b[0m claude  \x1b[35m✻ Thinking…\x1b[0m  a != b => c\r\n",
);
await write(
  "  \x1b[2m⎿  Read 42 lines\x1b[0m  \x1b[32m✓ done\x1b[0m  \x1b[31m✗ failed\x1b[0m\r\n",
);
await write(
  "\x1b[36m⠋⠙⠹⠸⠼\x1b[0m spinner  \x1b[1mbold\x1b[0m \x1b[3mitalic\x1b[0m \x1b[7minverse\x1b[0m\r\n",
);
await write(
  "\x1b[38;5;208m256-colour\x1b[0m \x1b[38;2;120;200;255mtruecolour\x1b[0m \x1b[44;97m bg \x1b[0m\r\n",
);
await write("╭──────┬──────╮  ██▓▒░ ▁▂▃▄▅▆▇  →←↑↓\r\n");
await write("│ hi   │ yo   │  wide: 日本語 emoji: 🚀\r\n");
await write(`╰──────┴──────╯  nerd: \u{f015} \u{e0b0} \u{f09b} \u{f121}\r\n`);
await write("$ ");

const grid = readGrid(term.buffer.active, cols, 0, rows);
const fontSize = 15;
const scene = buildScene({
  grid,
  theme: DEFAULT_THEME,
  label: "kolu (great-profit)",
  fontFamily: PNG_FONT_FAMILY,
  fontSize,
  cellW: fontSize * PNG_CELL_WIDTH_RATIO,
  cellH: Math.ceil(fontSize * 1.2),
});

const png = await sceneToPng(scene);
await writeFile(out, png);
console.log(
  `wrote ${out} — ${png.length} bytes, ${scene.width}x${scene.height}, ${scene.glyphs.length} glyphs, ${scene.rects.length} rects`,
);
term.dispose();
