import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { resolveSocketPath } from "./socketTarget.ts";

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
    expect(message).toContain("empty value");
    expect(message).not.toContain("mutually exclusive");
  });

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
