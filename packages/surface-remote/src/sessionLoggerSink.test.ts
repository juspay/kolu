/**
 * SK1 red-first pin — the session's diagnostic sink must work with a
 * RECEIVER-SENSITIVE structured logger (pino-shaped: methods that need `this`).
 *
 * The field failure (bug-remote-kaval-contract-skew, defect C): both server
 * consumers dispatch severity via an extracted method reference —
 * `(severity === "error" ? log.error : … : log.info)({ line }, "…")` — so the
 * method runs unbound (`this === undefined`) and throws on EVERY line; the
 * session's compensating per-line try/catch swallows the throw, spams stderr,
 * and drops every diagnostic. This pin asserts the fixed contract: every
 * diagnostic line LANDS in the structured logger — the session dispatches
 * severity internally via an indexed, receiver-bound call on `log` — with
 * nothing leaking to stderr. (First landed RED against the onLog-shaped API
 * driven exactly the way the real consumers drove it: zero lines landed.)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { provisionAgent } from "./nixCopy";
import { makeSession } from "./session";
import { sshConnector } from "./sshConnector";

vi.mock("./nixCopy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./nixCopy")>()),
  provisionAgent: vi.fn(),
}));

const PROVISION_FAILURE = {
  ok: false as const,
  reason: "strictlog: 'nix copy --derivation' exited with code 1",
  // Reached the host, it rejected the closure — terminal (no retry storm).
  cause: "remote" as const,
};

/** A pino-shaped logger whose methods are RECEIVER-SENSITIVE: each level
 *  method reads a private field, so an extracted, unbound reference throws
 *  exactly like pino's `Symbol(pino.msgPrefix)` read does. Structurally the
 *  workspace `Logger` contract (`@kolu/log`). */
class StrictStructuredLogger {
  readonly #entries: Array<{
    level: "debug" | "info" | "warn" | "error";
    obj: Record<string, unknown>;
    msg: string;
  }> = [];

  get entries() {
    return this.#entries;
  }

  debug(obj: Record<string, unknown>, msg: string): void {
    this.#entries.push({ level: "debug", obj, msg });
  }
  info(obj: Record<string, unknown>, msg: string): void {
    this.#entries.push({ level: "info", obj, msg });
  }
  warn(obj: Record<string, unknown>, msg: string): void {
    this.#entries.push({ level: "warn", obj, msg });
  }
  error(obj: Record<string, unknown>, msg: string): void {
    this.#entries.push({ level: "error", obj, msg });
  }
}

describe("session diagnostics land in a receiver-sensitive structured logger", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(provisionAgent).mockResolvedValue(PROVISION_FAILURE);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("routes every diagnostic line to the logger, receiver-bound, nothing to stderr", async () => {
    const log = new StrictStructuredLogger();
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    const session = makeSession({
      initialConnection: "probing",
      connectOnce: sshConnector({
        host: "strictlog",
        binary: "agent",
        localEnv: {},
        resolveDrvPath: () => Promise.resolve("/nix/store/deadbeef-agent.drv"),
      }),
      reconnectDelayMs: 1000,
      // The logger is handed over WHOLE — the session dispatches severity
      // internally via an indexed (receiver-bound) call, so the consumer-side
      // unbound-method extraction that crashed per line (defect C) has no
      // spellable form left. A receiver-sensitive logger is exactly what pino
      // hands the production consumers.
      log,
      label: "host:strictlog",
    });

    // Drive the failing-provision lifecycle so transitions + lastError emit.
    session.pin().catch(() => {});
    await vi.advanceTimersByTimeAsync(20_000);

    // Every diagnostic landed in the STRUCTURED logger…
    expect(log.entries.length).toBeGreaterThan(0);
    expect(
      log.entries.some((e) => String(e.obj.line).includes("connection:")),
    ).toBe(true);
    // …with the session label as the message on every entry (the `{ line }` +
    // label contract the consumers' journals key on)…
    expect(log.entries.every((e) => e.msg === "host:strictlog")).toBe(true);
    // …and none of it fell to stderr (neither raw lines nor a swallowed
    // "sink threw" report — the compensating catch must not exist).
    const toTty = stderr.mock.calls.map((c) => String(c[0]));
    expect(toTty).toEqual([]);

    stderr.mockRestore();
    session.destroy();
  });
});
