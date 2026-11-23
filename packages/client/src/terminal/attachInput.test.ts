/**
 * While the Conductor is in front, no request leaves a tile carrying a size.
 * Two of those requests are the attach's: the input each open sends, and the
 * input a transport retry would replay.
 */

import type { TerminalId } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import { attachRetry, tileAttachInput } from "./attachInput";

const ID = "11111111-1111-4111-8111-111111111111" as TerminalId;
const WANTED = { cols: 132, rows: 43 };

describe("the attach a tile opens", () => {
  it("asks for the grid it wants while its view is in front", () => {
    expect(
      tileAttachInput({
        id: ID,
        cause: "attach",
        wanted: WANTED,
        viewShown: true,
      }),
    ).toEqual({ id: ID, cause: "attach", resizeTo: WANTED });
  });

  it("asks for no size at all behind the Conductor — the key is absent", () => {
    const input = tileAttachInput({
      id: ID,
      cause: "foreign",
      wanted: WANTED,
      viewShown: false,
    });
    expect(input).toEqual({ id: ID, cause: "foreign" });
    // The wire refuses a present `undefined`, so absent is the claim.
    expect("resizeTo" in input).toBe(false);
  });
});

describe("a transport retry of a tile's attach", () => {
  const sized = tileAttachInput({
    id: ID,
    cause: "attach",
    wanted: WANTED,
    viewShown: true,
  });
  const unsized = tileAttachInput({
    id: ID,
    cause: "attach",
    wanted: WANTED,
    viewShown: false,
  });

  it("behind the Conductor, reopens a stream opened with a size instead of replaying it", () => {
    expect(attachRetry(sized, false)).toBe("reopen");
  });

  it("in front, replays as it always has", () => {
    expect(attachRetry(sized, true)).toBe("replay");
  });

  it("leaves a stream opened behind the Conductor alone, in front or behind", () => {
    expect(attachRetry(unsized, false)).toBe("replay");
    expect(attachRetry(unsized, true)).toBe("replay");
  });
});
