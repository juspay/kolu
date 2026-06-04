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
    ["OSC colour reply, ST-terminated", `${ESC}]11;rgb:0000/0000/0000${ST}`],
    ["OSC colour reply, BEL-terminated", `${ESC}]10;rgb:ffff/ffff/ffff${BEL}`],
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
  ])("forwards %s", (_label, payload) => {
    expect(isTerminalQueryResponse(payload)).toBe(false);
  });
});
