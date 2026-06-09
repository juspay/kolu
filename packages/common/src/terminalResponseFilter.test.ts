import { describe, expect, it } from "vitest";
import { isTerminalQueryResponse } from "./terminalResponseFilter";

const ESC = "\x1b";
const ST = `${ESC}\\`;
const BEL = "\x07";

describe("isTerminalQueryResponse — suppressed responses", () => {
  it.each([
    ["DA1", `${ESC}[?1;2c`],
    ["DA2", `${ESC}[>0;276;0c`],
    ["DSR", `${ESC}[0n`],
    ["CPR (cursor position)", `${ESC}[12;40R`],
    ["DECRPM (DECRQM reply, $y final)", `${ESC}[?25;1$y`],
    ["window size report (CSI t)", `${ESC}[8;24;80t`],
    ["OSC 11 colour reply, ST-terminated", `${ESC}]11;rgb:0000/0000/0000${ST}`],
    [
      "OSC 10 colour reply, BEL-terminated",
      `${ESC}]10;rgb:ffff/ffff/ffff${BEL}`,
    ],
    ["OSC 12 cursor-colour reply", `${ESC}]12;rgb:8080/8080/8080${BEL}`],
    ["OSC 4 palette colour reply", `${ESC}]4;1;rgb:cccc/0000/0000${ST}`],
    ["XTVERSION (DCS > | … ST)", `${ESC}P>|xterm(370)${ST}`],
    ["DECRQSS reply (DCS 1$r … ST)", `${ESC}P1$r0;1m${ST}`],
  ])("suppresses %s", (_label, payload) => {
    expect(isTerminalQueryResponse(payload)).toBe(true);
  });
});

describe("isTerminalQueryResponse — real input passes through", () => {
  it.each([
    ["a plain letter", "r"],
    ["a digit (looks like a CSI param but no ESC)", "5"],
    ["Enter", "\r"],
    ["an arrow key (CSI A — cursor movement, not a response)", `${ESC}[A`],
    ["Home", `${ESC}[H`],
    ["a paste", "hello world"],
    ["Alt+f (ESC-prefixed keystroke)", `${ESC}f`],
    ["a Ctrl byte", "\x12"],
    // Anchoring: a chunk that merely *contains* a response shape, with real
    // input appended, must NOT be dropped wholesale.
    ["response shape followed by a keystroke", `${ESC}[0nx`],
    ["keystroke followed by response shape", `x${ESC}[0n`],
    ["literal text that ends in a response final char", "cat"],
    // DCS that is program output (sixel), not a query response.
    ["sixel data (DCS q … ST)", `${ESC}Pq#0;2;0;0;0${ST}`],
    // OSC 52 clipboard *read* reply: generated only by the browser's
    // ClipboardAddon (the headless terminal has no clipboard provider), so it
    // must reach the PTY. Must NOT be swept up with the OSC colour replies.
    [
      "OSC 52 clipboard read reply, BEL-terminated",
      `${ESC}]52;c;aGVsbG8gd29ybGQ=${BEL}`,
    ],
    ["OSC 52 clipboard read reply, ST-terminated", `${ESC}]52;c;Zm9v${ST}`],
    // OSC 7 (cwd) / OSC 0/2 (title) sets are program output too — also not
    // colour replies, so they pass through.
    ["OSC 0 title set", `${ESC}]0;my title${BEL}`],
  ])("forwards %s", (_label, payload) => {
    expect(isTerminalQueryResponse(payload)).toBe(false);
  });
});
