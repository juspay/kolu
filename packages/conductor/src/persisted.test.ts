import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONDUCTOR_STATE } from "kolu-common/conductor";
import {
  EMPTY_PERSISTED_CONDUCTOR,
  PersistedConductorSchema,
  persistedFrom,
} from "./persisted.ts";

const decode = Schema.decodeUnknownResult(PersistedConductorSchema);

describe("the conversation a restart comes back to", () => {
  it("remembers whether the standing prompt has already gone out", () => {
    const written = persistedFrom(
      {
        ...DEFAULT_CONDUCTOR_STATE,
        sessionId: "sess-1",
        cwd: "/home/u",
        fleet: ["local/7f3e0a91-0000-4000-8000-000000000000"],
      },
      true,
    );
    expect(written.taught).toBe(true);
    expect(decode(written)._tag).toBe("Success");
  });

  it("... and says so for a conversation that has not been", () => {
    expect(persistedFrom(DEFAULT_CONDUCTOR_STATE, false).taught).toBe(false);
    expect(EMPTY_PERSISTED_CONDUCTOR.taught).toBe(false);
  });

  it("REFUSES a record that does not say, rather than guessing", () => {
    const { taught: _taught, ...older } = EMPTY_PERSISTED_CONDUCTOR;
    expect(decode(older)._tag).toBe("Failure");
  });
});
