/**
 * `padi-tui`'s argv→socket step — the refusals a driving script sees.
 *
 * These exist because this face's socket resolution had NO test at all while it
 * hand-rolled its own refusal sentences, and that is precisely how it drifted:
 * its `many` message never mentioned `$PADI_SOCKET`, and its `none` case fell
 * through to a success that dialed a socket nothing serves. The policy now lives
 * in `@kolu/padi`'s `localPadiSocket` (tested there); what is pinned HERE is the
 * part that is still this face's own — which flags it refuses before resolving.
 */

import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { resolveSocketPath } from "./socketTarget.ts";

/** The stderr line this face would print — read off the `CliFailure` the effect
 *  failed with, so the assertions below are against what a user actually sees
 *  rather than against a tag. */
function refusalOf(flags: {
  socket: string | undefined;
  stateRoot: string | undefined;
}): string {
  const exit = Effect.runSyncExit(
    Effect.match(resolveSocketPath(flags), {
      onFailure: (err) => ({ refused: err.stderr }),
      onSuccess: (socket) => ({ socket }),
    }),
  );
  if (Exit.isFailure(exit)) {
    throw new Error(`resolveSocketPath died instead of failing cleanly`);
  }
  const result = exit.value;
  if (!("refused" in result)) {
    throw new Error(`expected a refusal, got socket ${result.socket}`);
  }
  return result.refused;
}

describe("resolveSocketPath — what this face refuses before it resolves", () => {
  it("refuses --socket and --state-root together — two names for one daemon", () => {
    expect(
      refusalOf({ socket: "/run/a.sock", stateRoot: "/srv/padi" }),
    ).toContain("mutually exclusive");
  });

  // The regression this pins: with the primary rule, a blank --socket no longer
  // fails loudly downstream. `""` is treated as "no socket given", so resolution
  // falls through to discovery — which now SUCCEEDS on a multi-daemon host by
  // picking the primary. Without this guard, `padi-tui status --socket "$SOCK"`
  // with $SOCK unset silently drives a different workspace's terminals.
  it("refuses a PRESENT but empty --socket — never a silent fall-through to the primary", () => {
    const message = refusalOf({ socket: "", stateRoot: undefined });
    expect(message).toContain("--socket");
    expect(message).toContain("empty value");
    expect(message).toContain("will not quietly fall back");
  });

  it("refuses a whitespace-only flag — the same accident with a quoted space", () => {
    expect(refusalOf({ socket: "   ", stateRoot: undefined })).toContain(
      "empty value",
    );
    expect(refusalOf({ socket: undefined, stateRoot: "\t" })).toContain(
      "--state-root",
    );
  });

  it("names BOTH flags when both are blank, rather than only the first", () => {
    const message = refusalOf({ socket: "", stateRoot: "" });
    expect(message).toContain("--socket and --state-root");
    // Asserting the blank-specific wording, not just the flag names: with the
    // checks in the other order this case reaches the mutual-exclusion branch
    // instead, whose sentence ALSO names both flags — so a bare
    // `toContain("--socket and --state-root")` passes either way and pins
    // nothing. It did, for one commit.
    expect(message).toContain("empty value");
    expect(message).not.toContain("mutually exclusive");
  });

  // The ordering the case above can no longer hide: a blank flag is still
  // PRESENT, so a mutual-exclusion check that runs first answers "pass just one"
  // — advice that is wrong, because the user meaningfully named exactly one.
  it("reports the BLANK flag, not exclusivity, when one is blank and one is real", () => {
    const message = refusalOf({ socket: "", stateRoot: "/srv/padi" });
    expect(message).toContain("empty value");
    expect(message).toContain("--socket");
    expect(message).not.toContain("mutually exclusive");
  });

  it("passes a NAMED socket straight through — the flag is honored verbatim", () => {
    expect(
      Effect.runSync(
        resolveSocketPath({ socket: "/run/named.sock", stateRoot: undefined }),
      ),
    ).toBe("/run/named.sock");
  });
});
