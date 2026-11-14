/** The watched entry's two halves. The GRAMMAR (the last-slash split) is
 *  `kolu-mcp/fleetRef`'s and is tested there; what is this module's own, and
 *  all that is pinned here, is the validation on top — the browser only
 *  resolves a ref whose halves are a canonical host key and a terminal id. */

import { describe, expect, it } from "vitest";
import { splitWatchedRef } from "./watchedRef";

const ID = "aaaaaaaa-0000-4000-8000-000000000001";

describe("splitting a watched ref", () => {
  it("splits a ref whose halves are both resolvable", () => {
    expect(splitWatchedRef(`local/${ID}`)).toEqual({ host: "local", id: ID });
    // Through the shared grammar, so a host key keeps its own slashes.
    expect(splitWatchedRef(`remote:ssh://box/3/${ID}`)).toEqual({
      host: "remote:ssh://box/3",
      id: ID,
    });
  });

  it("answers null rather than guessing", () => {
    // Not a reference at all — the grammar's refusal, passed through.
    expect(splitWatchedRef(ID)).toBeNull();
    // A host key that is not canonical, and an id that is not a terminal id:
    // the panel draws the entry anyway and says it cannot resolve it.
    expect(splitWatchedRef(`elsewhere/${ID}`)).toBeNull();
    expect(splitWatchedRef("local/not-a-uuid")).toBeNull();
  });
});
