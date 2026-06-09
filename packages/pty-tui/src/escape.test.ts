import { describe, expect, it } from "vitest";
import { createEscapeScanner, type EscapeEvent } from "./escape.ts";

/** Feed `chunks` and flatten the result into (forwarded-string, actions). */
function scan(
  chunks: string[],
  escapeChar?: string,
): { forwarded: string; actions: string[] } {
  const scanner = createEscapeScanner(escapeChar);
  const events: EscapeEvent[] = [];
  for (const c of chunks) events.push(...scanner.feed(Buffer.from(c, "utf8")));
  let forwarded = "";
  const actions: string[] = [];
  for (const ev of events) {
    if (ev.kind === "forward") forwarded += ev.data.toString("utf8");
    else actions.push(ev.kind);
  }
  return { forwarded, actions };
}

describe("createEscapeScanner — the ssh line-start model", () => {
  it("passes ordinary input through byte-identically", () => {
    // The ~ is mid-line (after "A"), so nothing is eaten — Ctrl chords
    // (\x03), CSI input (\x1b[A), and multibyte text all pass untouched.
    const input = "ls -la\rgit status\réñ \x03\x1b[A~not-at-start";
    const { forwarded, actions } = scan([input]);
    expect(forwarded).toBe(input);
    expect(actions).toEqual([]);
  });

  it("session start counts as line start: leading ~. detaches", () => {
    const { forwarded, actions } = scan(["~."]);
    expect(forwarded).toBe("");
    expect(actions).toEqual(["detach"]);
  });

  it("~. after CR detaches; bytes before it forward", () => {
    const { forwarded, actions } = scan(["echo hi\r~."]);
    expect(forwarded).toBe("echo hi\r");
    expect(actions).toEqual(["detach"]);
  });

  it("LF also resets line start", () => {
    const { actions } = scan(["foo\n~."]);
    expect(actions).toEqual(["detach"]);
  });

  it("~~ forwards exactly one literal escape char", () => {
    const { forwarded, actions } = scan(["\r~~rest"]);
    expect(forwarded).toBe("\r~rest");
    expect(actions).toEqual([]);
  });

  it("~? emits help, forwards nothing, and stays at line start", () => {
    const { forwarded, actions } = scan(["\r~?~."]);
    expect(forwarded).toBe("\r");
    expect(actions).toEqual(["help", "detach"]);
  });

  it("~ followed by a non-command forwards BOTH bytes", () => {
    const { forwarded, actions } = scan(["\r~x"]);
    expect(forwarded).toBe("\r~x");
    expect(actions).toEqual([]);
  });

  it("a mid-line ~ is never special", () => {
    const { forwarded, actions } = scan(["a~.b"]);
    expect(forwarded).toBe("a~.b");
    expect(actions).toEqual([]);
  });

  it("holds a pending escape across a chunk boundary", () => {
    const { forwarded, actions } = scan(["\r~", "."]);
    expect(forwarded).toBe("\r");
    expect(actions).toEqual(["detach"]);
  });

  it("a pending escape resolved as ~~ across chunks forwards one tilde", () => {
    const { forwarded } = scan(["\r~", "~"]);
    expect(forwarded).toBe("\r~");
  });

  it("events preserve byte order around an action", () => {
    const scanner = createEscapeScanner();
    const events = scanner.feed(Buffer.from("abc\r~?xyz", "utf8"));
    expect(events.map((e) => e.kind)).toEqual(["forward", "help", "forward"]);
  });

  it("forwards multibyte UTF-8 split across chunks byte-identically", () => {
    const bytes = Buffer.from("café", "utf8"); // é is 2 bytes
    const scanner = createEscapeScanner();
    const events = [
      ...scanner.feed(bytes.subarray(0, 4)), // splits é mid-character
      ...scanner.feed(bytes.subarray(4)),
    ];
    const out = Buffer.concat(
      events.flatMap((e) => (e.kind === "forward" ? [e.data] : [])),
    );
    expect(out.equals(bytes)).toBe(true);
  });

  it("honours a custom escape char (and ~ loses its powers)", () => {
    const { forwarded, actions } = scan(["\r~.\r%."], "%");
    expect(forwarded).toBe("\r~.\r");
    expect(actions).toEqual(["detach"]);
  });

  it("rejects a multi-char or non-printable escape", () => {
    expect(() => createEscapeScanner("ab")).toThrow(/single printable/);
    expect(() => createEscapeScanner("\x01")).toThrow(/single printable/);
    expect(() => createEscapeScanner("")).toThrow(/single printable/);
  });
});

describe("createEscapeScanner — bracketed paste suspension", () => {
  const START = "\x1b[200~";
  const END = "\x1b[201~";

  it('a pasted "\\n~." cannot detach (markers + content forward)', () => {
    const input = `${START}\n~.${END}`;
    const { forwarded, actions } = scan([input]);
    expect(forwarded).toBe(input);
    expect(actions).toEqual([]);
  });

  it("recognition resumes after the paste ends (next newline re-arms)", () => {
    const { forwarded, actions } = scan([`${START}x${END}`, "\r~."]);
    expect(forwarded).toBe(`${START}x${END}\r`);
    expect(actions).toEqual(["detach"]);
  });

  it("the byte right after a paste is mid-line (no immediate escape)", () => {
    const { forwarded, actions } = scan([`${START}foo\n${END}~.`]);
    expect(forwarded).toBe(`${START}foo\n${END}~.`);
    expect(actions).toEqual([]);
  });

  it("a paste-start marker split across chunks still suspends", () => {
    const { forwarded, actions } = scan(["\x1b[20", "0~\n~.", END, "\r~."]);
    expect(forwarded).toBe(`${START}\n~.${END}\r`);
    expect(actions).toEqual(["detach"]);
  });

  it("an ESC restarting mid-match is not lost (\\x1b\\x1b[200~ suspends)", () => {
    const { forwarded, actions } = scan([`\x1b${START}\n~.${END}`]);
    expect(forwarded).toBe(`\x1b${START}\n~.${END}`);
    expect(actions).toEqual([]);
  });
});
