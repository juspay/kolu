/** The watched entry's two halves. The rule that matters is the LAST slash: a
 *  remote host key may carry one, a terminal id never does. */

import { describe, expect, it } from "vitest";
import { splitWatchedRef } from "./watchedRef";

const ID = "aaaaaaaa-0000-4000-8000-000000000001";

describe("splitting a watched ref", () => {
  it("splits a local ref", () => {
    expect(splitWatchedRef(`local/${ID}`)).toEqual({ host: "local", id: ID });
  });

  it("splits at the LAST slash, so a host key keeps its own", () => {
    expect(splitWatchedRef(`remote:ssh://box/3/${ID}`)).toEqual({
      host: "remote:ssh://box/3",
      id: ID,
    });
  });

  it("answers null rather than guessing", () => {
    // No separator at all; a bare id would otherwise be sent to whichever
    // host sorted first.
    expect(splitWatchedRef(ID)).toBeNull();
    expect(splitWatchedRef(`/${ID}`)).toBeNull();
    expect(splitWatchedRef("local/")).toBeNull();
    // A host key that is not canonical, and an id that is not a terminal id:
    // the panel draws the entry anyway and says it cannot resolve it.
    expect(splitWatchedRef(`elsewhere/${ID}`)).toBeNull();
    expect(splitWatchedRef("local/not-a-uuid")).toBeNull();
  });
});
