/** The derivations a tool card cannot read straight off the row — what went
 *  in, how long the wait was, the clock under a running call, and how the
 *  folded body is PRINTED. The rest of a card is `row.kolu` read as it stands,
 *  so there is nothing between the wire and the markup left to pin here.
 *
 *  The card's LAYOUT is not pinned here and cannot be: this lane runs under
 *  happy-dom, which has no layout engine, so every width it reports is zero
 *  and `scrollWidth <= clientWidth` would pass against any markup at all. The
 *  assertion that the payload stays inside the card is in the e2e lane, in a
 *  real browser (`features/conductor.feature`, "A minified 5 KB payload stays
 *  inside its card"). What IS a value rather than a layout — the folded text
 *  being lines rather than one — is pinned below. */

import type { TerminalId } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import { foldJson, runningFor, sentInput, waitedFor } from "./toolCard";

const TERMINAL = "11111111-1111-4111-8111-111111111111" as TerminalId;

const sent = (text: string | null, key: string | null) =>
  sentInput({
    kind: "sendInput",
    terminalId: TERMINAL,
    host: "local",
    name: "fix-parser",
    text,
    key,
  });

describe("sentInput", () => {
  it("tells typed text and a named key apart", () => {
    expect(sent("go", null)).toEqual({ as: "text", value: "go" });
    expect(sent(null, "Enter")).toEqual({ as: "key", value: "Enter" });
  });

  it("says nothing for a call that carried neither", () => {
    expect(sent(null, null)).toBeNull();
  });
});

describe("waitedFor", () => {
  it("phrases the wait down to the second", () => {
    expect(waitedFor(134_000)).toBe("2m 14s");
  });

  it("says nothing about a wait the tool did not report — a wait with no duration is not a wait of zero", () => {
    expect(waitedFor(null)).toBeNull();
  });
});

describe("runningFor", () => {
  const started = "2026-01-01T00:00:00.000Z";
  const at = (seconds: number) => Date.parse(started) + seconds * 1000;

  it("says nothing for a call that is not running", () => {
    expect(
      runningFor({ status: "completed", startedAt: started }, at(90)),
    ).toBeNull();
  });

  it("says nothing until the wait is worth watching", () => {
    expect(
      runningFor({ status: "in_progress", startedAt: started }, at(1)),
    ).toBeNull();
  });

  it("counts from the writer's stamp, so two tabs agree", () => {
    expect(
      runningFor({ status: "in_progress", startedAt: started }, at(47)),
    ).toBe("47s");
  });

  it("says nothing when the row carries no stamp", () => {
    expect(runningFor({ status: "in_progress" }, at(90))).toBeNull();
  });
});

describe("foldJson", () => {
  // THE REAL SHAPE: an MCP answer arrives as a JSON STRING, and the harness
  // prints it with `JSON.stringify`, so the card is handed a quoted string
  // whose content is a whole document — one line, however long the listing.
  const listing = JSON.stringify([
    { name: "terminals", uri: "surface://collections/terminals" },
    { name: "hosts", uri: "surface://cells/hosts" },
  ]);

  it("prints a listing carried as a JSON string as lines, not as one", () => {
    const minified = JSON.stringify(listing, null, 2);
    expect(minified.split("\n")).toHaveLength(1);

    const folded = foldJson(minified);
    expect(folded.split("\n").length).toBeGreaterThan(6);
    expect(folded).toContain('"uri": "surface://collections/terminals"');
    // The SAME formatter the harness folds with — two-space indent, no second
    // house style for what folded JSON looks like.
    expect(folded).toBe(JSON.stringify(JSON.parse(listing), null, 2));
  });

  it("folds a call's input and its answer separately, keeping the blank line between them", () => {
    const detail = `${JSON.stringify({ server: "kolu" }, null, 2)}\n\n${JSON.stringify(listing, null, 2)}`;
    const folded = foldJson(detail);
    const [input, output] = folded.split("\n\n");
    expect(input).toBe(JSON.stringify({ server: "kolu" }, null, 2));
    expect(output).toBe(JSON.stringify(JSON.parse(listing), null, 2));
  });

  it("hands back a block that is not JSON, and one whose JSON is a bare scalar — printing is not editing", () => {
    expect(foldJson("printf secret-output")).toBe("printf secret-output");
    expect(foldJson('"echo hi"')).toBe('"echo hi"');
  });
});
