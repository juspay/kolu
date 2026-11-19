/**
 * WHAT THE REMEMBERED CONVERSATION CARRIES — and the one field a restart would
 * otherwise have to guess at.
 *
 * "This session has been taught" is a fact about the AGENT's memory of the
 * conversation, not about our rows: the transcript is capped
 * ({@link ROW_CAP}), so the message the standing prompt rode is gone long
 * before the conversation is, and a conductor that re-derived the answer from
 * what it still holds would teach a chat in progress again on every restart.
 * So it is saved beside the session id, and these are the two halves of that:
 * the record declares it, and what is written back carries what the live
 * conversation said.
 */

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
    // A store written before the field existed is walked to this shape by a
    // rung on the one ladder (`packages/server/src/stateLadder.ts`, 1.60.0).
    // Reading past a record that does not say would be this module inventing
    // an answer about somebody else's chat — so the decode refuses it, which
    // is what makes the rung owed rather than optional.
    const { taught: _taught, ...older } = EMPTY_PERSISTED_CONDUCTOR;
    expect(decode(older)._tag).toBe("Failure");
  });
});
