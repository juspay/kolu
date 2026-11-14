import { describe, expect, it } from "vitest";
import {
  FAILURE_DETAIL_LINES,
  FAILURE_LINE_CHARS,
  failureMessage,
  failureWords,
} from "./failure.ts";

describe("failureWords — reading a failure's text", () => {
  it("one line is the headline, with no detail", () => {
    expect(failureWords("cache not usable")).toEqual({
      headline: "cache not usable",
      detail: [],
    });
    expect(failureWords("")).toEqual({ headline: "", detail: [] });
  });

  it("several lines: the first is the headline, the rest the detail — blank ends dropped, inner blanks kept", () => {
    expect(
      failureWords(
        "cannot build x: error: builder failed\n\n  error: builder for 'x.drv' failed  \n\n       last 2 log lines:\n\n",
      ),
    ).toEqual({
      headline: "cannot build x: error: builder failed",
      detail: [
        "  error: builder for 'x.drv' failed",
        "",
        "       last 2 log lines:",
      ],
    });
  });

  it("reads an Effect Schema error padi wrote — no convention needed", () => {
    expect(
      failureWords('Expected landed.json\n  └─ ["set"]\n     └─ Missing key'),
    ).toEqual({
      headline: "Expected landed.json",
      detail: ['  └─ ["set"]', "     └─ Missing key"],
    });
  });

  it("a message that starts with blank lines reads its first non-blank line as the cause", () => {
    expect(
      failureWords("\n  \ncannot pull: ssh dropped\n  at line 2\n"),
    ).toEqual({
      headline: "cannot pull: ssh dropped",
      detail: ["  at line 2"],
    });
    expect(failureWords("\n \n")).toEqual({ headline: "", detail: [] });
  });
});

describe("failureMessage — writing one", () => {
  it("a cause with no evidence is the cause alone", () => {
    expect(failureMessage("ssh dropped", "")).toBe("ssh dropped");
    expect(failureMessage("ssh dropped", " \n\n")).toBe("ssh dropped");
  });

  it("flattens a multi-line headline to one line", () => {
    expect(failureMessage("cannot fetch x:\n   error: gone", "")).toBe(
      "cannot fetch x: error: gone",
    );
  });

  it("flattens a headline padded with long runs of whitespace", () => {
    const pad = " \t".repeat(50_000);
    expect(
      failureMessage(`cannot fetch x:${pad}\n${pad}error: gone${pad}`, ""),
    ).toBe("cannot fetch x: error: gone");
  });

  it("keeps the LAST lines of long evidence and says how many it cut", () => {
    const evidence = Array.from(
      { length: FAILURE_DETAIL_LINES + 3 },
      (_, i) => `line ${i}`,
    ).join("\n");
    const { headline, detail } = failureWords(
      failureMessage("cannot build x", evidence),
    );
    expect(headline).toBe("cannot build x");
    expect(detail[0]).toBe("… 3 earlier lines not shown");
    expect(detail.slice(1)).toHaveLength(FAILURE_DETAIL_LINES);
    expect(detail[1]).toBe("line 3");
    expect(detail.at(-1)).toBe(`line ${FAILURE_DETAIL_LINES + 2}`);
  });

  it("counts the lines a caller already dropped in the note", () => {
    const { detail } = failureWords(
      failureMessage("box: exited with code 1", "line a\nline b", 7),
    );
    expect(detail).toEqual(["… 7 earlier lines not shown", "line a", "line b"]);
  });

  it("cuts an over-long line, the headline's too, ending in …", () => {
    const long = "x".repeat(FAILURE_LINE_CHARS + 50);
    const { headline, detail } = failureWords(
      failureMessage(long, `short\n${long}`),
    );
    expect(headline).toHaveLength(FAILURE_LINE_CHARS);
    expect(headline.endsWith("…")).toBe(true);
    expect(detail[0]).toBe("short");
    expect(detail[1]).toHaveLength(FAILURE_LINE_CHARS);
    expect(detail[1]?.endsWith("…")).toBe(true);
  });

  it("drops evidence the headline already says — a one-line Nix error is not said twice", () => {
    expect(
      failureMessage(
        "cannot fetch x: error: … while fetching cannot find flake",
        "error:\n       … while fetching\n\n       cannot find flake\n",
      ),
    ).toBe("cannot fetch x: error: … while fetching cannot find flake");
  });

  it("round trip: the reader gets the flattened headline and the kept evidence back", () => {
    const message = failureMessage(
      "the p profile:\ncannot build p",
      "\nerror: builder for '/nix/store/a-p.drv' failed\n       > make: *** [all] Error 1\n",
    );
    expect(failureWords(message)).toEqual({
      headline: "the p profile: cannot build p",
      detail: [
        "error: builder for '/nix/store/a-p.drv' failed",
        "       > make: *** [all] Error 1",
      ],
    });
  });
});
