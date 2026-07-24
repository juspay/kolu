/**
 * D1b pins (#1908) — the fire-and-collect seam OWNS its child's lifetime.
 *
 * The field incident: a `nix-store --realise` ssh child wedged ~10 minutes because
 * `runProgress`/`runCapture` spawned with no timeout, no kill path, resolving only on
 * the child's own `close`. These are the flipped RED bodies (R9: rewrites, not
 * `it.fails → it`), exercising the REAL helpers against REAL children:
 *
 *   - a `deadline` policy kills a never-closing child and settles `lifetime-expired`;
 *   - a `progress-liveness` policy kills a SILENT child but never a chatty one, and
 *     resets on ANY output (stdout too, not just stderr — R4d);
 *   - a killed child that forked a grandchild inheriting the stderr pipe still settles
 *     AT expiry (we group-kill and never await a `close` that may never fire — R2);
 *   - a child that IGNORES SIGTERM is still reaped after the grace (C8);
 *   - an abort settles as its own `aborted` arm.
 */
import { describe, expect, it } from "vitest";
import { runCapture, runProgress } from "./process";

// A never-closing child self-reaps at 5s so a REGRESSION (no bound) can't leak forever;
// the bounds we assert (≤1s) are far under it, so only the policy can settle these runs.
const SLEEP_5 = ["-c", "sleep 5"] as const;

describe("D1b — deadline policy (#1908)", () => {
  it("kills a never-closing child at its deadline and settles lifetime-expired", {
    timeout: 10_000,
  }, async () => {
    const start = Date.now();
    const res = await runProgress("sh", SLEEP_5, {
      policy: { kind: "deadline", ms: 400 },
    });
    expect(res.kind).toBe("lifetime-expired");
    expect(res.ok).toBe(false);
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it("settles AT expiry even when a grandchild inherits the stderr pipe (R2 group-kill)", {
    timeout: 10_000,
  }, async () => {
    // The child forks a grandchild that inherits stderr and outlives a child-only
    // kill — the eternal-await relocation the single-process stub couldn't catch. With
    // a detached group-kill + settle-at-expiry, the run still settles in its bound.
    const start = Date.now();
    const res = await runCapture("sh", ["-c", "sh -c 'sleep 30' & sleep 30"], {
      policy: { kind: "deadline", ms: 400 },
    });
    expect(res.kind).toBe("lifetime-expired");
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it("still settles at the deadline when the child IGNORES SIGTERM (C8 → SIGKILL escalation)", {
    timeout: 10_000,
  }, async () => {
    const start = Date.now();
    const res = await runProgress("sh", ["-c", 'trap "" TERM; sleep 30'], {
      policy: { kind: "deadline", ms: 400 },
    });
    // We settle at expiry (never waiting for the child to honour TERM); the grace
    // SIGKILL reaps the trap-ignoring child in the background.
    expect(res.kind).toBe("lifetime-expired");
    expect(Date.now() - start).toBeLessThan(2000);
  });
});

describe("D1b — progress-liveness policy (#1908)", () => {
  it("reassembles stderr lines split across child chunks", async () => {
    const lines: string[] = [];
    const res = await runCapture(
      "sh",
      [
        "-c",
        "printf 'Could not ' >&2; sleep 0.05; printf 'resolve host\\n' >&2",
      ],
      {
        policy: { kind: "deadline", ms: 5000 },
        onProgress: (line) => lines.push(line),
      },
    );

    expect(res.ok).toBe(true);
    expect(lines).toEqual(["Could not resolve host"]);
  });

  it("fails loudly instead of buffering an unbounded stderr line", async () => {
    const res = await runCapture(
      process.execPath,
      ["-e", 'process.stderr.write("x".repeat(1024 * 1024))'],
      { policy: { kind: "deadline", ms: 5000 } },
    );

    expect(res.kind).toBe("output-error");
    expect(res.ok).toBe(false);
  });

  it("kills a SILENT child once the silence bound passes", {
    timeout: 10_000,
  }, async () => {
    const start = Date.now();
    const res = await runCapture("sh", SLEEP_5, {
      policy: { kind: "progress-liveness", silenceMs: 400 },
    });
    expect(res.kind).toBe("lifetime-expired");
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it("never kills a CHATTY child — output resets the silence bound (stderr)", {
    timeout: 10_000,
  }, async () => {
    // Emits on stderr every 150ms for ~600ms — never 400ms silent → clean exit.
    const res = await runProgress(
      "sh",
      ["-c", "for i in 1 2 3 4; do echo tick 1>&2; sleep 0.15; done"],
      { policy: { kind: "progress-liveness", silenceMs: 400 } },
    );
    expect(res).toEqual({ ok: true, kind: "exit", code: 0 });
  });

  it("resets on ANY output — a STDOUT-only child is not killed (R4d)", {
    timeout: 10_000,
  }, async () => {
    // runCapture's stdout never becomes a progress line, so a stderr-only reset would
    // starve this child. Emits on stdout only, every 150ms.
    const res = await runCapture(
      "sh",
      ["-c", "for i in 1 2 3 4; do echo out; sleep 0.15; done"],
      { policy: { kind: "progress-liveness", silenceMs: 400 } },
    );
    expect(res.ok).toBe(true);
    expect(res.stdout).toContain("out");
  });
});

describe("D1b — abort (#1908 R6b)", () => {
  it("settles as its own `aborted` arm and group-kills the child", {
    timeout: 10_000,
  }, async () => {
    const ac = new AbortController();
    const start = Date.now();
    const p = runCapture("sh", SLEEP_5, {
      policy: { kind: "deadline", ms: 5000 },
      signal: ac.signal,
    });
    setTimeout(() => ac.abort(), 200);
    const res = await p;
    expect(res.kind).toBe("aborted");
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it("an ALREADY-aborted signal never spawns the (side-effecting) child (F2)", {
    timeout: 10_000,
  }, async () => {
    const ac = new AbortController();
    ac.abort(); // aborted BEFORE the call
    const res = await runCapture("sh", ["-c", "echo RAN"], {
      policy: { kind: "deadline", ms: 5000 },
      signal: ac.signal,
    });
    // Settles aborted with no output — the command (a stand-in for `nix copy`) never ran.
    expect(res.kind).toBe("aborted");
    expect(res.stdout).not.toContain("RAN");
  });
});

describe("D1b — group reap (#1908 F1)", () => {
  it("SIGKILLs a TERM-ignoring grandchild that outlived the leader's close", {
    timeout: 10_000,
  }, async () => {
    // The leader prints its pid (== its process-group id, since detached), forks a
    // grandchild that IGNORES SIGTERM, then exits 0 on its own TERM — so the leader's
    // `close` fires while the grandchild is still alive. The escalation must NOT be
    // cleared on that close; the grace SIGKILL reaps the grandchild.
    const res = await runCapture(
      "sh",
      ["-c", 'echo $$; trap "exit 0" TERM; ( trap "" TERM; sleep 30 ) & wait'],
      { policy: { kind: "deadline", ms: 400 } },
    );
    expect(res.kind).toBe("lifetime-expired");
    const pgid = Number.parseInt(res.stdout.trim(), 10);
    expect(Number.isFinite(pgid)).toBe(true);
    // Wait past the TERM→KILL grace, then the whole group must be gone (ESRCH).
    await new Promise((r) => setTimeout(r, 2600));
    expect(() => process.kill(-pgid, 0)).toThrow();
  });

  it("runProgress resets progress-liveness on STDOUT (not just stderr) — F11", {
    timeout: 10_000,
  }, async () => {
    // runProgress ignores stdout for capture, but must still DRAIN it to bump liveness,
    // or a healthy stdout-only child is killed as silent. Emits stdout only, every 150ms.
    const res = await runProgress(
      "sh",
      ["-c", "for i in 1 2 3 4; do echo out; sleep 0.15; done"],
      { policy: { kind: "progress-liveness", silenceMs: 400 } },
    );
    expect(res).toEqual({ ok: true, kind: "exit", code: 0 });
  });
});
