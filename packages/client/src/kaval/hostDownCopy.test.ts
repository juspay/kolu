/** Pins the Skew-UX host-down copy map — every typed `EntryFailedCause` has
 *  non-empty title + body. PURE (node-env vitest, no jsdom): it imports the copy
 *  map directly, never mounting the card. The compile-time `satisfies
 *  Record<EntryFailedCause, …>` in `hostDownCopy.ts` already fails the build if a
 *  cause is MISSING; this asserts the copy that IS there is real (non-blank), so a
 *  cause can't ship with an empty placeholder that renders a blank card. */

import { describe, expect, it } from "vitest";
import { HOST_DOWN_COPY, hostDownCopy } from "./hostDownCopy";

describe("hostDownCopy", () => {
  it("every cause has a non-empty title and body", () => {
    for (const [cause, copy] of Object.entries(HOST_DOWN_COPY)) {
      expect(copy.title.trim(), `${cause} title`).not.toBe("");
      expect(copy.body.trim(), `${cause} body`).not.toBe("");
    }
  });

  it("cross-supervisor is first-class — its own copy, never the generic `other`", () => {
    expect(hostDownCopy("cross-supervisor")).not.toEqual(HOST_DOWN_COPY.other);
    expect(hostDownCopy("cross-supervisor").title).toBe(
      "Another kolu owns this host",
    );
  });

  it("the lookup returns the same object the map holds for a cause", () => {
    expect(hostDownCopy("contract-skew-refused")).toBe(
      HOST_DOWN_COPY["contract-skew-refused"],
    );
  });
});
