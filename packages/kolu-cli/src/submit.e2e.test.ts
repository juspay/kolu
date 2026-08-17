/**
 * The one-call submit, proved against a REAL padi driving a REAL PTY.
 *
 * The unit suite (`@kolu/padi`'s `submitInput.test.ts`) pins the predicate and
 * the four-step sequence over a stated world. What it cannot reach is the half
 * that only exists when bytes actually move: kaval's meaningful-output edge, the
 * quiet window measured against it, a TUI's bracketed-paste handling, and the
 * ordering of the two writes through a live pty. That is what this file is for.
 *
 * The target is `test-fixtures/mockAgentTui.mjs` — a scripted TUI, not a real
 * agent, and deliberately: a live Claude session needs credentials, is not
 * deterministic, and would make the timing nobody's to pin. The fixture
 * reproduces the three contract properties the doctrine turns on, including the
 * destructive one (a turn ending CLEARS the input box), so the loss this design
 * exists to prevent is DEMONSTRATED here rather than asserted in prose.
 *
 * Four proofs, one per shape the change ships:
 *   a. a message submitted to an IDLE terminal lands as exactly ONE message;
 *   b. a mid-turn dispatch REFUSES with nothing typed — beside a control leg
 *      showing that the manual "type now, Enter later" path loses the text;
 *   c. the OTHER refusal: when the TUI outlasts the caller's bound after the
 *      text is typed, `staged: true` is a true statement about that screen and
 *      the documented recovery (one Enter, no re-send) delivers it once;
 *   d. `lifecycle_create { run, message }` briefs a fresh agent with zero
 *      further calls, across a boot silence.
 *
 * …plus the CLI parity leg, because `kolu send --submit` is a face of the same
 * capability and a face that is never exercised is a face that has drifted.
 */

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertDaemonSpawnAllowed,
  describeDaemon,
} from "@kolu/daemon-test-gate";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { expect, it } from "vitest";
import {
  setupPadiHarness,
  sleep,
  toolJson,
  toolRefusal,
  TSX_LOADER,
} from "./padiHarness.testlib.ts";

const SRC = dirname(fileURLToPath(import.meta.url));
const MOCK_TUI = resolve(SRC, "../test-fixtures/mockAgentTui.mjs");
const KOLU_MAIN = resolve(SRC, "main.ts");

const harness = setupPadiHarness("kolu-submit-e2e");

/** How long a scripted turn runs in the mid-turn leg. Generous on purpose: this
 *  test's job is to prove a REFUSAL, and a turn that ends before the dispatch
 *  lands turns a real regression into a green run — the submit simply succeeds
 *  and every assertion below still passes for the wrong reason.
 *
 *  MEASURED, not guessed. Recording the PR's evidence drove the same four beats
 *  through a terminal at typing speed and a 12 s turn ran out underneath them
 *  TWICE, silently converting the mid-turn beat into an idle one. The e2e's
 *  beats are tighter than a recording's, but the margin they were relying on was
 *  the same one that proved too thin, so it is widened to where the failure was
 *  actually observed rather than left at the edge. The cost is the wait for the
 *  turn to end (bounded, and it only lengthens one leg). */
const TURN_MS = 25_000;

// ── Driving the fixture ──────────────────────────────────────────────────────

/** Open a terminal running the mock TUI and wait until it has painted a prompt.
 *
 *  The TUI is launched the way every kolu terminal launches anything — as a line
 *  TYPED at the shell — so the bytes under test travel the production path, not
 *  a spawn argv no face can produce. */
async function openMockTui(
  mcp: Client,
  env: Record<string, string> = {},
): Promise<string> {
  const { id } = toolJson(
    await mcp.callTool({
      name: "lifecycle_create",
      arguments: { placement: { kind: "toplevel" } },
    }),
  ) as { id: string };
  toolJson(
    await mcp.callTool({
      name: "lifecycle_sendInput",
      arguments: { id, text: `${runLine(env)}\r` },
    }),
  );
  await awaitScreen(mcp, id, "MOCK> ");
  return id;
}

/** The shell line that launches the fixture with `env` in front of it.
 *
 *  `process.execPath`, never a bare `node` (`.claude/rules/e2e-testing.md`):
 *  whether the spawned shell's PATH resolves `node` is a different question from
 *  the one these scenarios ask, and on a host where node lives only in the dev
 *  shell the difference presents as a phantom product bug. */
function runLine(env: Record<string, string>): string {
  const assignments = Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  return `${assignments}${assignments === "" ? "" : " "}${process.execPath} ${MOCK_TUI}`;
}

const screenOf = async (mcp: Client, id: string): Promise<string> =>
  toolJson(
    await mcp.callTool({ name: "screen_text", arguments: { id, tail: 200 } }),
  ) as string;

/** Poll the screen until `needle` appears, or fail LOUD with what was there —
 *  never a bare timeout, which reads as "slow" when it means "wrong". */
async function awaitScreen(
  mcp: Client,
  id: string,
  needle: string,
  ms = 30_000,
): Promise<string> {
  const deadline = Date.now() + ms;
  let screen = "";
  while (Date.now() < deadline) {
    screen = await screenOf(mcp, id);
    if (screen.includes(needle)) return screen;
    await sleep(200);
  }
  throw new Error(
    `screen never showed ${JSON.stringify(needle)}; last read:\n${screen}`,
  );
}

/** How many times the fixture announced a submitted message with this body.
 *  A COUNT, not a `toContain`: "landed as ONE message" is the claim, and a
 *  double-delivery would satisfy a containment check exactly as well. */
function submittedCount(screen: string, message: string): number {
  const marker = `<<SUBMITTED:${JSON.stringify(message)}>>`;
  return screen.split(marker).length - 1;
}

// ── The proofs ───────────────────────────────────────────────────────────────

describeDaemon("the one-call submit against a real padi", () => {
  it("delivers a message to an IDLE terminal as exactly one submitted message", async () => {
    const padi = await harness.startPadi();
    const mcp = await harness.serveMcpOverPadi(padi.socketPath, "submit-idle");
    const id = await openMockTui(mcp);

    const landed = toolJson(
      await mcp.callTool({
        name: "lifecycle_sendInput",
        arguments: { id, text: "review this PR", submit: true },
      }),
    ) as {
      submitted: boolean;
      readyAfterMs: number;
      settledAfterMs: number;
      sent: { textBytes: number };
    };

    // The frame says what happened, not merely that something did.
    expect(landed.submitted).toBe(true);
    expect(landed.sent.textBytes).toBe("review this PR".length);
    expect(landed.readyAfterMs).toBeGreaterThanOrEqual(0);
    expect(landed.settledAfterMs).toBeGreaterThanOrEqual(0);

    const screen = await awaitScreen(mcp, id, "<<SUBMITTED:");
    expect(submittedCount(screen, "review this PR")).toBe(1);
  }, 120_000);

  it("carries a MULTILINE brief as one paste and one submit", async () => {
    // The property a brief actually depends on: newlines inside the paste are
    // content, so the agent takes the whole thing as ONE message instead of
    // firing a half-written prompt per line — and the Enter that follows is
    // outside the paste, which is what makes it a submit at all.
    const padi = await harness.startPadi();
    const mcp = await harness.serveMcpOverPadi(
      padi.socketPath,
      "submit-multiline",
    );
    const id = await openMockTui(mcp);
    const brief = "line one\nline two\nline three";

    toolJson(
      await mcp.callTool({
        name: "lifecycle_sendInput",
        arguments: { id, text: brief, submit: true },
      }),
    );

    const screen = await awaitScreen(mcp, id, "<<SUBMITTED:");
    expect(submittedCount(screen, brief)).toBe(1);
  }, 120_000);

  it("REFUSES a mid-turn dispatch with nothing typed — where the manual path loses the text", async () => {
    const padi = await harness.startPadi();
    const mcp = await harness.serveMcpOverPadi(
      padi.socketPath,
      "submit-midturn",
    );
    const id = await openMockTui(mcp, { MOCK_TURN_MS: String(TURN_MS) });

    // Put the target mid-turn: this submit lands and starts a long turn.
    toolJson(
      await mcp.callTool({
        name: "lifecycle_sendInput",
        arguments: { id, text: "first", submit: true },
      }),
    );
    await awaitScreen(mcp, id, "<<SUBMITTED:");

    // ── The documented choice ────────────────────────────────────────────
    // A dispatch into that turn refuses, bounded, having typed NOTHING.
    // `timeoutMs` well under the turn: this leg is about the REFUSAL, so the
    // bound has to expire while the target is still demonstrably busy. Left at
    // the daemon's 60s default it would outlast the turn and the submit would
    // simply succeed — a green run proving nothing.
    const refusal = toolRefusal(
      await mcp.callTool({
        name: "lifecycle_sendInput",
        arguments: {
          id,
          text: "SECOND-MESSAGE",
          submit: true,
          settleMs: 800,
          timeoutMs: 2_000,
        },
      }),
    );
    expect(refusal.detail).toMatchObject({
      kind: "submit-refused",
      phase: "ready",
      reason: "busy",
      // The field a driver branches on: nothing is left in any input box, so a
      // retry is free (and the retry at the bottom of this test is that claim
      // being cashed).
      staged: false,
    });
    // The NAME, not just the value. This assertion read `typed: false` for one
    // commit after the field became `staged` — and `typed` is precisely the
    // question the rename exists to stop drivers asking, because a terminal that
    // died mid-delivery was typed into and has nothing left to finish. A face
    // that grows the old key back is a face that answers the wrong question.
    expect(refusal.detail).not.toHaveProperty("typed");
    expect(refusal.message).toMatch(/NOTHING was typed/);

    // …and the screen agrees. This is the assertion that makes the refusal
    // worth having: a "safe" design that still typed would show the text here.
    expect(await screenOf(mcp, id)).not.toContain("SECOND-MESSAGE");

    // ── The control leg: why refusing beats typing ───────────────────────
    // The manual "type now, submit when it settles" path, run against the same
    // mid-turn agent. The write reports success — and the text is destroyed
    // when the turn ends. This is the 2026-08-17 grok failure, reproduced.
    toolJson(
      await mcp.callTool({
        name: "lifecycle_sendInput",
        arguments: { id, text: "LOST-MESSAGE" },
      }),
    );
    const cleared = await awaitScreen(mcp, id, "<<CLEARED:", 60_000);
    expect(cleared).toContain('<<CLEARED:"LOST-MESSAGE">>');
    expect(submittedCount(cleared, "LOST-MESSAGE")).toBe(0);

    // ── And the refused message still gets through, once ─────────────────
    // The whole point of refusing rather than losing: the caller retries.
    toolJson(
      await mcp.callTool({
        name: "lifecycle_sendInput",
        arguments: { id, text: "SECOND-MESSAGE", submit: true },
      }),
    );
    const after = await awaitScreen(mcp, id, '<<SUBMITTED:"SECOND-MESSAGE">>');
    expect(submittedCount(after, "SECOND-MESSAGE")).toBe(1);
  }, 180_000);

  it("a settle-phase refusal really does leave the text STAGED — one Enter finishes it", async () => {
    // The OTHER refusal, and the one whose report a driver can obey wrongly.
    // `staged: true` is a claim about the far side of a pty — the message is
    // sitting in that input box — and until now nothing checked it was true;
    // only that the projection computed it. Here the fixture keeps repainting
    // for longer than the caller's bound allows, which is what a TUI still
    // taking a big paste looks like, so the text is typed and the Enter is
    // withheld.
    const padi = await harness.startPadi();
    const mcp = await harness.serveMcpOverPadi(
      padi.socketPath,
      "submit-staged",
    );
    const id = await openMockTui(mcp, { MOCK_PASTE_CHATTER_MS: "20000" });

    // MULTILINE, and that is load-bearing rather than decorative: the shared send
    // policy brackets a paste only when the text needs one, so a single-line
    // message reaches the fixture as plain keystrokes with no END marker — the
    // chatter never starts, the terminal is quiet, and the submit simply
    // succeeds. (It did, on the first CI run of this test.) A brief is multi-line
    // anyway, which is the shape this refusal exists for.
    const brief = "STAGED-MESSAGE\nsecond line of the brief";

    const refusal = toolRefusal(
      await mcp.callTool({
        name: "lifecycle_sendInput",
        arguments: {
          id,
          text: brief,
          submit: true,
          settleMs: 800,
          timeoutMs: 4_000,
        },
      }),
    );
    expect(refusal.detail).toMatchObject({
      kind: "submit-refused",
      phase: "settle",
      reason: "busy",
      staged: true,
    });

    // The claim, cashed: the text IS on that screen and it was NOT submitted.
    const stagedScreen = await screenOf(mcp, id);
    expect(stagedScreen).toContain("STAGED-MESSAGE");
    expect(submittedCount(stagedScreen, brief)).toBe(0);

    // …and the documented recovery is the whole recovery: an Enter, with no
    // re-send, delivers the message exactly once. A driver that re-dispatched
    // instead would have put the brief in twice, which is the failure the
    // `staged` field exists to prevent.
    toolJson(
      await mcp.callTool({
        name: "lifecycle_sendInput",
        arguments: { id, key: "Enter" },
      }),
    );
    const after = await awaitScreen(mcp, id, "<<SUBMITTED:");
    expect(submittedCount(after, brief)).toBe(1);
  }, 180_000);

  it("create + message briefs a fresh agent in ONE call, across a boot silence", async () => {
    const padi = await harness.startPadi();
    const mcp = await harness.serveMcpOverPadi(
      padi.socketPath,
      "create-message",
    );

    // A 2.5s boot silence — the gap between a shell exec'ing an agent and that
    // agent painting. A narrow quiet window would read it as an idle prompt and
    // type the brief into a process with no input box yet; the first message's
    // wider window is what out-waits it.
    const created = toolJson(
      await mcp.callTool({
        name: "lifecycle_create",
        arguments: {
          placement: { kind: "toplevel" },
          intent: "briefed worker",
          run: runLine({ MOCK_BOOT_MS: "2500" }),
          message: "carry out the plan",
        },
      }),
    ) as { id: string; ran: string; briefed: string };

    expect(created.briefed).toBe("carry out the plan");

    // ZERO further calls were needed to put the worker to work — the read
    // below is the TEST checking, not the driver dispatching.
    const screen = await awaitScreen(
      mcp,
      created.id,
      '<<SUBMITTED:"carry out the plan">>',
    );
    expect(submittedCount(screen, "carry out the plan")).toBe(1);
  }, 180_000);

  it("CLI parity: `kolu send --submit` delivers the same way", async () => {
    // The CLI is a face of the same padi member, and a face nobody exercises
    // is a face that has drifted. This runs the SHIPPED launcher shape (tsx
    // over `main.ts`), pointed at the test padi by `--socket`.
    const padi = await harness.startPadi();
    const mcp = await harness.serveMcpOverPadi(padi.socketPath, "cli-parity");
    const id = await openMockTui(mcp);

    const done = await runKolu([
      "send",
      id,
      "--socket",
      padi.socketPath,
      "--submit",
      "from the CLI",
    ]);
    expect(done.code).toBe(0);
    expect(done.stderr).toMatch(/· submitted \(waited \d+ms for the prompt/);

    const screen = await awaitScreen(mcp, id, '<<SUBMITTED:"from the CLI">>');
    expect(submittedCount(screen, "from the CLI")).toBe(1);
  }, 120_000);
});

/** Run the `kolu` CLI as the shipped launcher does, and collect its outcome.
 *  Never inherits `$PADI_SOCKET`: this suite may itself run inside a kolu
 *  terminal, and an inherited value would drive the developer's real daemon. */
function runKolu(
  argv: readonly string[],
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((res, rej) => {
    // The runtime leash, at the call site that forks — `describeDaemon` around
    // the test is not enough on its own, and the gate's own hygiene test proves
    // it: helper indirection is exactly how a fork gets smuggled past a
    // block-level gate (juspay/kolu#1334/#1375).
    assertDaemonSpawnAllowed("the `kolu` CLI over tsx (drives a real padi)");
    const env = { ...process.env };
    delete env.PADI_SOCKET;
    const child = spawn(
      process.execPath,
      ["--import", TSX_LOADER, KOLU_MAIN, ...argv],
      { stdio: ["ignore", "pipe", "pipe"], env },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", rej);
    child.on("exit", (code) => res({ code, stdout, stderr }));
  });
}
