/**
 * `RightPanelPerTerminalStateSchema` — the per-terminal right-panel record. The
 * load-bearing invariant pinned here is BACKWARD COMPATIBILITY of the `collapsed`
 * field added when the panel's collapsed posture moved off the global preference
 * to follow the terminal (#959): the field carries a schema decoding default
 * (`false`), so a `rightPanel` record persisted BEFORE the field existed (only
 * `activeTab`/`codeMode`) must parse back as OPEN with no migration — the shipped
 * runtime default. Without the default, session restore would reject every
 * pre-#959 terminal record.
 *
 * The Effect port makes the default KEY-level (`withDecodingDefaultKey`, PLAN
 * #17), so the two directions are pinned as BYTES here, not just as a decoded
 * value: a missing key backfills, an explicit `undefined` is refused, and
 * re-encoding emits the key — which is what keeps a persisted record
 * byte-identical to the zod-era one.
 */

import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_RIGHT_PANEL_PER_TERMINAL,
  RightPanelPerTerminalStateSchema,
} from "./chromeVocab.ts";

const decodeRightPanel = Schema.decodeUnknownSync(
  RightPanelPerTerminalStateSchema,
);
const encodeRightPanel = Schema.encodeUnknownSync(
  RightPanelPerTerminalStateSchema,
);

describe("RightPanelPerTerminalStateSchema — collapsed is backward-compatible", () => {
  it("parses a LEGACY record (no `collapsed`) back as open (collapsed: false)", () => {
    // A record persisted before #959 carried only the task fields.
    const legacy = {
      activeTab: "code",
      codeMode: "branch",
      selectedFileByMode: { local: "a.ts", branch: "b.ts", browse: "c.ts" },
    };
    const parsed = decodeRightPanel(legacy);
    expect(parsed.collapsed).toBe(false);
    // The rest of the legacy record survives untouched.
    expect(parsed.activeTab).toBe("code");
    expect(parsed.codeMode).toBe("branch");
  });

  it("keeps an explicit collapsed:true (a post-#959 record round-trips)", () => {
    const parsed = decodeRightPanel({
      collapsed: true,
      activeTab: "inspector",
      codeMode: "browse",
    });
    expect(parsed.collapsed).toBe(true);
  });

  it("the shipped per-terminal default reads as open", () => {
    expect(DEFAULT_RIGHT_PANEL_PER_TERMINAL.collapsed).toBe(false);
  });

  it("BYTES: a backfilled record re-encodes WITH the key (zod `.default(false)`'s emit half)", () => {
    // The half a decode-equality test cannot see: `collapsed` must be PRESENT in
    // the persisted JSON, or a record written by this build would read as a
    // legacy record by a later one.
    expect(
      JSON.stringify(
        encodeRightPanel(
          decodeRightPanel({ activeTab: "code", codeMode: "browse" }),
        ),
      ),
    ).toBe('{"collapsed":false,"activeTab":"code","codeMode":"browse"}');
  });

  it("BYTES: a populated record round-trips byte-for-byte", () => {
    const stored =
      '{"collapsed":true,"activeTab":"inspector","codeMode":"local","selectedFileByMode":{"local":"a.ts"}}';
    expect(
      JSON.stringify(encodeRightPanel(decodeRightPanel(JSON.parse(stored)))),
    ).toBe(stored);
  });

  it("an EXPLICIT undefined collapsed is REJECTED — absent is the only spelling", () => {
    // `withDecodingDefaultKey` is stricter than zod's `.default()` here, by
    // design (PLAN #17): a disk record omits a key, it never stores `undefined`.
    // Any in-process caller building this record must therefore omit the key.
    expect(
      Result.isFailure(
        Schema.decodeUnknownResult(RightPanelPerTerminalStateSchema)({
          collapsed: undefined,
          activeTab: "code",
          codeMode: "browse",
        }),
      ),
    ).toBe(true);
  });

  it("an ABSENT selectedFileByMode stays ABSENT, never null", () => {
    // `optionalKey`, not `optional` — the one thing `Schema.optional` would have
    // silently broken (an explicit `undefined` round-trips through `null`).
    const encoded = encodeRightPanel(
      decodeRightPanel({ activeTab: "code", codeMode: "browse" }),
    ) as Record<string, unknown>;
    expect("selectedFileByMode" in encoded).toBe(false);
  });
});
