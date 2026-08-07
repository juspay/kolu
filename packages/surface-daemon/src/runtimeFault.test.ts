/**
 * `armRuntimeFaultExit` — the daemon-side disposition of an OWNED surface-runtime
 * fault (juspay/kolu#2101 G2). These pin the three things the deploy-#2 incident
 * got wrong: the fault must be FATAL (not logged-and-survived), the log must carry
 * the WHOLE error (the incident's line was message-only, so the failing cell was
 * unidentifiable), and the exit must run the daemon's last rites first.
 */

import { describe, expect, it } from "vitest";
import type { Logger } from "./logger.ts";
import {
  armRuntimeFaultExit,
  DAEMON_RUNTIME_FAULT_MARKER,
} from "./runtimeFault.ts";

interface Line {
  obj: Record<string, unknown>;
  msg: string;
}

/** A logger that keeps each line WHOLE — the `err` value included — because
 *  "did the stack survive?" is exactly what these tests ask. */
function recordingLog(lines: Line[]): Logger {
  const rec =
    () =>
    (obj: Record<string, unknown>, msg: string): void => {
      lines.push({ obj, msg });
    };
  return { debug: rec(), info: rec(), warn: rec(), error: rec() };
}

/** Let the `done.catch` microtask run. */
const flush = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

describe("armRuntimeFaultExit", () => {
  it("a faulting runtime aborts the shutdown signal AFTER the last rites, logging the WHOLE error", async () => {
    const lines: Line[] = [];
    const rites: unknown[] = [];
    const boom = new Error("derived cell connector: install() threw");
    const signal = armRuntimeFaultExit({
      done: Promise.reject(boom),
      log: recordingLog(lines),
      subject: "padi surface runtime",
      lastRites: (err) => {
        // Ordering matters: the capture must happen while the daemon is still
        // whole, i.e. BEFORE the shutdown is triggered.
        expect(signal.aborted).toBe(false);
        rites.push(err);
      },
    });
    expect(signal.aborted).toBe(false); // nothing has faulted yet

    await flush();

    expect(signal.aborted).toBe(true); // the tenure ends — this is the fatal half
    expect(rites).toEqual([boom]); // last rites ran, with the reason
    expect(lines).toHaveLength(1);
    const [line] = lines;
    // The WHOLE Error object — not `err.message` — so a pino sink serializes the
    // stack and an operator can name the faulting member. This is the assertion
    // the incident's `{"err":"timed out after 1500ms"}` line would fail.
    expect(line?.obj.err).toBe(boom);
    expect(line?.obj.marker).toBe(DAEMON_RUNTIME_FAULT_MARKER);
    expect(line?.msg).toContain("padi surface runtime faulted");
    expect(line?.msg).toContain("non-zero exit");
  });

  it("a non-Error rejection is reported verbatim under `reason`, never coerced into a fake Error", async () => {
    const lines: Line[] = [];
    const signal = armRuntimeFaultExit({
      done: Promise.reject("the string nobody expected"),
      log: recordingLog(lines),
      subject: "kaval pty-host surface runtime",
    });
    await flush();
    expect(signal.aborted).toBe(true);
    expect(lines[0]?.obj.err).toBeUndefined();
    expect(lines[0]?.obj.reason).toBe("the string nobody expected");
  });

  it("last rites that THROW do not resurrect the zombie — the exit still happens, loudly", async () => {
    const lines: Line[] = [];
    const signal = armRuntimeFaultExit({
      done: Promise.reject(new Error("wiring death")),
      log: recordingLog(lines),
      subject: "padi surface runtime",
      lastRites: () => {
        throw new Error("the session store is gone");
      },
    });
    await flush();
    expect(signal.aborted).toBe(true); // the whole point: still fatal
    expect(lines).toHaveLength(2);
    expect(String(lines[1]?.msg)).toContain("last rites threw");
    expect((lines[1]?.obj.err as Error).message).toBe(
      "the session store is gone",
    );
  });

  it("a CLEAN close never trips the fault arm (a resolved `done` is end-of-life, not death)", async () => {
    const lines: Line[] = [];
    const signal = armRuntimeFaultExit({
      done: Promise.resolve(),
      log: recordingLog(lines),
      subject: "padi surface runtime",
      lastRites: () => {
        throw new Error("must not run on a clean close");
      },
    });
    await flush();
    expect(signal.aborted).toBe(false);
    expect(lines).toEqual([]);
  });
});
