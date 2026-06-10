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

describe("createTerminalResponseStripper — streaming raw-tty strip", () => {
  // Feed `inputs` one chunk at a time; return everything forwarded, joined.
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
    // DA1 `ESC [ ? 1 ; 2 c` arrives as `ESC [ ? 1` then `; 2 c`.
    expect(run([`${ESC}[?1`, `;2c`])).toBe("");
  });

  it("drops a reply split mid-OSC-terminator (ESC then \\ in the next chunk)", () => {
    // OSC 11 colour reply where the ST (`ESC \\`) straddles the chunk break.
    expect(run([`${ESC}]11;rgb:0000/0000/0000${ESC}`, `\\`])).toBe("");
  });

  it("drops TWO replies coalesced into one chunk", () => {
    expect(run([`${ESC}[?1;2c${ESC}[0n`])).toBe("");
  });

  it("drops a reply but keeps a real keystroke glued right after it", () => {
    // The exact case the whole-chunk predicate forwards wholesale: reply+input.
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
    // `echo work\r` then a reply riding the same read — the input survives.
    expect(run([`echo work\r${ESC}[0n`])).toBe("echo work\r");
  });

  // Per-chunk forwarding, to prove a byte leaves on the RIGHT push() — latency
  // fidelity, not just eventual delivery.
  const perChunk = (inputs: string[]): string[] => {
    const stripper = createTerminalResponseStripper();
    return inputs.map((chunk) =>
      stripper.push(Buffer.from(chunk, "latin1")).toString("latin1"),
    );
  };

  it("forwards a lone trailing ESC on its OWN chunk (Escape key, not held)", () => {
    // A held ESC would merge with the next keystroke and wreck remote vim's
    // Escape-vs-Alt timeout; it must leave on the same push it arrived.
    expect(perChunk([ESC])).toEqual([ESC]);
  });

  it("does not merge Esc-then-i across chunks into a dropped/Alt sequence", () => {
    // Esc arrives, then `i` next read: both forward, in order, on their own
    // pushes — the inner editor sees a real Escape then a real `i`.
    expect(perChunk([ESC, "i"])).toEqual([ESC, "i"]);
  });

  // `ESC ]` (Alt+]) and `ESC P` (Alt+Shift+P) share their introducer with the
  // OSC/DCS reply grammars, so the stripper must treat them as the START of a
  // (possibly split) string sequence — a bare `ESC ]` could be the first bytes
  // of a colour reply arriving across reads. What it must NOT do is buffer the
  // rest of the session waiting for a terminator that a user-typed Alt+] will
  // never produce: once the run outruns any legitimate reply it FAILS OPEN and
  // the buffered bytes (the introducer + everything typed since) reach the PTY.
  it("fails open on a user-typed `ESC ]` (Alt+]) so input never freezes", () => {
    // 8192-byte cap: type Alt+] then keep typing; the whole run is forwarded
    // (never eaten) once it overruns, so the session stays alive.
    const tail = "x".repeat(9000);
    const forwarded = run([`${ESC}]${tail}`]);
    // Every typed byte reaches the PTY; nothing is swallowed.
    expect(forwarded).toBe(`${ESC}]${tail}`);
  });

  it("fails open on a user-typed `ESC P` (Alt+Shift+P) the same way", () => {
    const tail = "y".repeat(9000);
    expect(run([`${ESC}P${tail}`])).toBe(`${ESC}P${tail}`);
  });

  // The cap must hold even when the tail is all ESC bytes. A run of ESC after
  // `ESC ]` keeps flipping the half-typed-ST flag (`escSeen`) on every byte, so
  // a length check buried in the byte-dispatch branches would never fire and
  // `seq` would grow forever. The cap is enforced per byte AFTER terminator
  // handling, so this still fails open.
  it("fails open on `ESC ]` followed by a long run of ESC bytes", () => {
    const tail = ESC.repeat(9000);
    expect(run([`${ESC}]${tail}`])).toBe(`${ESC}]${tail}`);
  });

  // Repeated `ESC x` pairs (ESC then a non-backslash) alternate `escSeen`
  // true/false on every pair without ever terminating — the other path that
  // would dodge a branch-local cap.
  it("fails open on `ESC P` followed by repeated `ESC x` pairs past the cap", () => {
    const tail = `${ESC}z`.repeat(5000);
    expect(run([`${ESC}P${tail}`])).toBe(`${ESC}P${tail}`);
  });

  it("still drops a genuine OSC colour reply that starts with the same `ESC ]`", () => {
    // The fail-open bound doesn't weaken suppression of real (short) replies.
    expect(run([`${ESC}]11;rgb:0000/0000/0000${ST}`])).toBe("");
  });

  it("forwards a large OSC 52 clipboard reply even past the fail-open cap", () => {
    // OSC 52 is never suppressed; a clipboard read longer than the cap must
    // still reach the PTY (fail-open forwards it rather than eating it).
    const big = `${ESC}]52;c;${"Zg".repeat(6000)}${ST}`;
    expect(run([big])).toBe(big);
  });
});
