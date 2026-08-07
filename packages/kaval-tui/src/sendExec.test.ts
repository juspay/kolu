import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { planSend } from "./send.ts";
import { executeSendPlan, SEND_WRITE_DEADLINE_MS } from "./sendExec.ts";

const START = "\x1b[200~";
const END = "\x1b[201~";

describe("executeSendPlan — ordered writes", () => {
  it("issues each planned write in order via the sink", async () => {
    const captured: string[] = [];
    const plan = planSend({
      kind: "text",
      text: "hello world",
      paste: undefined,
      fromStream: false,
    });
    await Effect.runPromise(
      executeSendPlan(
        plan,
        (data) =>
          Effect.sync(() => {
            captured.push(data);
          }),
        "term1234",
      ),
    );
    expect(captured).toEqual(["hello world"]);
  });
});

describe("executeSendPlan — bounded write deadline (Bug C: no hang)", () => {
  // Fake timers so we assert the deadline FIRES without waiting real seconds —
  // the point is that a stalled write fails within the deadline, not that the
  // test itself hangs for 8s.
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // A sink that never resolves — the exact shape of the Bug C hang: a terminal
  // (a plain `cat` whose output has backed up) that stops draining its input, so
  // the write never acks.
  const neverDrains = (): Effect.Effect<void> => Effect.never;

  it("fails loud when a write stalls past the deadline, instead of hanging", async () => {
    const plan = planSend({
      kind: "text",
      text: "a 6KB brief that the terminal never reads",
      paste: undefined,
      fromStream: true,
    });
    // Capture the outcome up front so the rejection is always handled while we
    // advance the fake clock.
    const outcome = Effect.runPromise(
      executeSendPlan(plan, neverDrains, "cat9f3a"),
    ).then(
      () => "resolved",
      (err: Error) => err,
    );
    await vi.advanceTimersByTimeAsync(SEND_WRITE_DEADLINE_MS);
    const err = await outcome;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/stalled/);
  });

  it("the loud message names the stalled terminal and the deadline", async () => {
    const plan = planSend({
      kind: "text",
      text: "x",
      paste: undefined,
      fromStream: false,
    });
    const outcome = Effect.runPromise(
      executeSendPlan(plan, neverDrains, "cat9f3a"),
    ).then(
      () => "resolved",
      (err: Error) => err.message,
    );
    await vi.advanceTimersByTimeAsync(SEND_WRITE_DEADLINE_MS);
    const msg = await outcome;
    expect(msg).toContain("cat9f3a"); // names the stalled terminal
    expect(msg).toContain(String(SEND_WRITE_DEADLINE_MS)); // and the bound
  });

  it("does NOT fire for a write that completes before the deadline", async () => {
    const plan = planSend({
      kind: "text",
      text: "quick",
      paste: undefined,
      fromStream: false,
    });
    const captured: string[] = [];
    // Resolves on a microtask, well inside the deadline — advancing the clock a
    // hair proves the timer is cleared, not left to fire later.
    await Effect.runPromise(
      executeSendPlan(
        plan,
        (data) =>
          Effect.sync(() => {
            captured.push(data);
          }),
        "term",
      ),
    );
    await vi.advanceTimersByTimeAsync(SEND_WRITE_DEADLINE_MS);
    expect(captured).toEqual(["quick"]);
  });
});

describe("--file payload path — byte-exact, no shell mangling", () => {
  it("a payload with backticks and $( ) reaches the wire verbatim", async () => {
    // The exact class `"$(cat file)"` mangled: the shell would execute the
    // backticks / $( ) / ${...}. Reading the file as raw bytes (as the --file
    // path does — readFileSync utf8 → planSend → executeSendPlan) keeps every
    // byte intact because no shell is in the loop.
    // Built by concatenation so the literal `${` (a shell metachar under test,
    // NOT a JS template placeholder) never appears adjacent in source and trips
    // the linter. The payload string itself carries the exact bytes.
    const dollarBrace = "$" + "{HOME}";
    const payload = `set \`identity\` to $(whoami) and ${dollarBrace}; run \`rm -rf /\`\nsecond line`;
    const dir = mkdtempSync(join(tmpdir(), "kaval-send-"));
    const file = join(dir, "brief.md");
    writeFileSync(file, payload, "utf8");
    try {
      const text = readFileSync(file, "utf8");
      const plan = planSend({
        kind: "text",
        text,
        paste: undefined,
        fromStream: true,
      });
      const captured: string[] = [];
      await Effect.runPromise(
        executeSendPlan(
          plan,
          (data) =>
            Effect.sync(() => {
              captured.push(data);
            }),
          "term",
        ),
      );
      // One bracketed-paste write carrying the payload byte-for-byte.
      expect(captured).toEqual([`${START}${payload}${END}`]);
      expect(captured[0]).toContain("`identity`");
      expect(captured[0]).toContain("$(whoami)");
      expect(captured[0]).toContain(dollarBrace); // the literal ${HOME} bytes
      expect(captured[0]).toContain("`rm -rf /`");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
