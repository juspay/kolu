import { describe, expect, it } from "vitest";
import {
  createTerminalResponseStripper,
  isTerminalQueryResponse,
} from "./responseFilter.ts";

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
    ["response shape followed by a keystroke", `${ESC}[0nx`],
    ["keystroke followed by response shape", `x${ESC}[0n`],
    ["literal text that ends in a response final char", "cat"],
    ["sixel data (DCS q … ST)", `${ESC}Pq#0;2;0;0;0${ST}`],
    [
      "OSC 52 clipboard read reply, BEL-terminated",
      `${ESC}]52;c;aGVsbG8gd29ybGQ=${BEL}`,
    ],
    ["OSC 52 clipboard read reply, ST-terminated", `${ESC}]52;c;Zm9v${ST}`],
    ["OSC 0 title set", `${ESC}]0;my title${BEL}`],
  ])("forwards %s", (_label, payload) => {
    expect(isTerminalQueryResponse(payload)).toBe(false);
  });
});

describe("createTerminalResponseStripper — streaming raw-tty strip", () => {
  const run = (inputs: string[]): string => {
    const stripper = createTerminalResponseStripper();
    let forwarded = "";
    for (const chunk of inputs) {
      forwarded += stripper
        .push(Buffer.from(chunk, "latin1"))
        .toString("latin1");
    }
    return forwarded;
  };

  it("forwards a single chunk that is exactly one reply as nothing", () => {
    expect(run([`${ESC}[?1;2c`])).toBe("");
  });

  it("forwards plain keystrokes untouched", () => {
    expect(run(["echo hi\r"])).toBe("echo hi\r");
  });

  it("drops a reply SPLIT across two chunks (the boundary the predicate misses)", () => {
    expect(run([`${ESC}[?1`, `;2c`])).toBe("");
  });

  it("drops a reply split mid-OSC-terminator (ESC then \\ in the next chunk)", () => {
    expect(run([`${ESC}]11;rgb:0000/0000/0000${ESC}`, `\\`])).toBe("");
  });

  it("drops TWO replies coalesced into one chunk", () => {
    expect(run([`${ESC}[?1;2c${ESC}[0n`])).toBe("");
  });

  it("drops a reply but keeps a real keystroke glued right after it", () => {
    expect(run([`${ESC}[0nx`])).toBe("x");
  });

  it("keeps a keystroke BEFORE a reply and drops only the reply", () => {
    expect(run([`x${ESC}[0n`])).toBe("x");
  });

  it("keeps input surrounding a reply: keystroke, reply, keystroke", () => {
    expect(run([`a${ESC}[?1;2cb`])).toBe("ab");
  });

  it("forwards a real arrow-key CSI (cursor movement, not a reply)", () => {
    expect(run([`${ESC}[A`])).toBe(`${ESC}[A`);
  });

  it("forwards an Alt-key (ESC f) untouched", () => {
    expect(run([`${ESC}f`])).toBe(`${ESC}f`);
  });

  it("forwards OSC 52 clipboard reply (browser-only, must reach the PTY)", () => {
    const osc52 = `${ESC}]52;c;Zm9v${ST}`;
    expect(run([osc52])).toBe(osc52);
  });

  it("forwards a real keystroke typed in the same burst as the detach-arming Enter", () => {
    expect(run([`echo work\r${ESC}[0n`])).toBe("echo work\r");
  });

  const perChunk = (inputs: string[]): string[] => {
    const stripper = createTerminalResponseStripper();
    return inputs.map((chunk) =>
      stripper.push(Buffer.from(chunk, "latin1")).toString("latin1"),
    );
  };

  it("forwards a lone trailing ESC on its OWN chunk (Escape key, not held)", () => {
    expect(perChunk([ESC])).toEqual([ESC]);
  });

  it("does not merge Esc-then-i across chunks into a dropped/Alt sequence", () => {
    expect(perChunk([ESC, "i"])).toEqual([ESC, "i"]);
  });

  it("fails open on a user-typed `ESC ]` (Alt+]) so input never freezes", () => {
    const tail = "x".repeat(9000);
    const forwarded = run([`${ESC}]${tail}`]);
    expect(forwarded).toBe(`${ESC}]${tail}`);
  });

  it("fails open on a user-typed `ESC P` (Alt+Shift+P) the same way", () => {
    const tail = "y".repeat(9000);
    expect(run([`${ESC}P${tail}`])).toBe(`${ESC}P${tail}`);
  });

  it("fails open on `ESC ]` followed by a long run of ESC bytes", () => {
    const tail = ESC.repeat(9000);
    expect(run([`${ESC}]${tail}`])).toBe(`${ESC}]${tail}`);
  });

  it("fails open on `ESC P` followed by repeated `ESC x` pairs past the cap", () => {
    const tail = `${ESC}z`.repeat(5000);
    expect(run([`${ESC}P${tail}`])).toBe(`${ESC}P${tail}`);
  });

  it("still drops a genuine OSC colour reply that starts with the same `ESC ]`", () => {
    expect(run([`${ESC}]11;rgb:0000/0000/0000${ST}`])).toBe("");
  });

  it("forwards a large OSC 52 clipboard reply even past the fail-open cap", () => {
    const big = `${ESC}]52;c;${"Zg".repeat(6000)}${ST}`;
    expect(run([big])).toBe(big);
  });
});
