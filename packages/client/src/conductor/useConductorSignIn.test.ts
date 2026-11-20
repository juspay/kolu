import { Effect } from "effect";
import type { ConductorSignInResult } from "kolu-common/conductor";
import { beforeEach, describe, expect, it, vi } from "vitest";

const seam = vi.hoisted(() => ({
  answer: { outcome: "signed-in", restart: { kind: "restarted" } } as
    | ConductorSignInResult
    | { readonly failed: string },
  toasts: [] as { level: string; text: string }[],
  ran: [] as Promise<unknown>[],
}));

vi.mock("solid-sonner", () => ({
  toast: {
    success: (text: string) => seam.toasts.push({ level: "success", text }),
    error: (text: string) => seam.toasts.push({ level: "error", text }),
    warning: (text: string) => seam.toasts.push({ level: "warning", text }),
    info: (text: string) => seam.toasts.push({ level: "info", text }),
  },
}));
vi.mock("../wire", () => ({
  app: {
    procedures: {
      conductor: {
        signIn: () =>
          "failed" in seam.answer
            ? Effect.fail(new Error(seam.answer.failed))
            : Effect.succeed(seam.answer),
      },
    },
  },
}));
vi.mock("../runAction", () => ({
  runAction: (_label: string, effect: Effect.Effect<unknown, unknown>) => {
    seam.ran.push(Effect.runPromise(effect as Effect.Effect<unknown, never>));
  },
}));
vi.mock("./useConductorFacts", () => ({ useConductorFacts: () => () => ({}) }));
vi.mock("./transcriptScroll", () => ({ pinTranscript: () => {} }));
vi.mock("../createSharedRoot", () => ({
  createSharedRoot: <T>(build: () => T) => {
    let made: T | undefined;
    return () => (made ??= build());
  },
}));

import { useConductor } from "./useConductor";

const press = async (answer: typeof seam.answer): Promise<void> => {
  seam.answer = answer;
  useConductor().signIn("console-login");
  await Promise.all(seam.ran.splice(0, seam.ran.length));
};

beforeEach(() => {
  seam.toasts = [];
});

describe("a sign-in that landed", () => {
  it("says so, and says the agent restarted", async () => {
    await press({ outcome: "signed-in", restart: { kind: "restarted" } });
    expect(seam.toasts).toEqual([
      { level: "success", text: "Signed in — the agent restarted" },
    ]);
  });

  it("says BOTH facts when the agent did not restart, and never 'failed'", async () => {
    await press({
      outcome: "signed-in",
      restart: {
        kind: "did-not-restart",
        why: "the agent is in the middle of a turn. Stop the turn, or wait for it to end, and restart the agent then",
      },
    });
    const only = seam.toasts[0];
    expect(seam.toasts).toHaveLength(1);
    expect(only?.level).toBe("warning");
    expect(only?.text).toContain("Signed in");
    expect(only?.text).toContain("did not restart");
    expect(only?.text).toContain("Stop the turn");
    expect(only?.text).not.toContain("Sign-in failed");
  });
});

describe("a sign-in that did not", () => {
  it("says the login did not complete", async () => {
    await press({ outcome: "failed", restart: { kind: "not-due" } });
    expect(seam.toasts).toEqual([
      { level: "error", text: "Sign-in did not complete" },
    ]);
  });

  it("says nothing for a cancel", async () => {
    await press({ outcome: "cancelled", restart: { kind: "not-due" } });
    expect(seam.toasts).toEqual([]);
  });

  it("carries the server's own words when the CALL failed", async () => {
    await press({ failed: "This kolu is shutting down" });
    expect(seam.toasts).toEqual([
      { level: "error", text: "Sign-in failed: This kolu is shutting down" },
    ]);
  });
});
