/**
 * The restart discipline's failure arms, pinned at the three places they now
 * live:
 *
 *   - `classifyDialFailure` (connect.ts) is where the supervisor's BRAND check
 *     runs — ONCE, at the raise site — turning a real `DaemonContractSkewError`
 *     into the `PadiContractSkew` tag and everything else into
 *     `PadiDialFailed`. This is the misrouting hazard's actual guard, so it is
 *     tested against a REAL skew error, not a stand-in.
 *   - `requireReachablePadi` (mcp.ts) is the #2148 open gate: ANY dial failure
 *     before the MCP handshake is a `CliFailure` (stderr + exit 1 via the
 *     package run edge — spawn-and-check-exit is a valid probe). A successful
 *     probe disposes the connection.
 *   - `guardedMcpDial` (mcp.ts) then routes mid-session by `_tag` alone: a skew
 *     EXITS loud (the honest upgrade line, never a server left serving a
 *     surface it can't represent); any other dial failure fails fast with the
 *     typed `padi transport down:` prefix (retryable, nothing queues).
 */
import { DaemonContractSkewError } from "@kolu/surface-daemon-supervisor";
import { Cause, Effect, Exit } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyDialFailure,
  type KoluCliConnection,
  PadiNotAddressable,
} from "./connect.ts";
import { CliFailure } from "./exit.ts";
import { guardedMcpDial, requireReachablePadi } from "./mcp.ts";

const skew = (): DaemonContractSkewError =>
  new DaemonContractSkewError({
    subject: "padi",
    daemonVersion: "9.0",
    requiredVersion: "4.1",
  });

describe("classifyDialFailure", () => {
  it("a real contract skew becomes the PadiContractSkew tag, message intact", () => {
    const classified = classifyDialFailure(skew());
    expect(classified._tag).toBe("PadiContractSkew");
    expect(classified.message).toContain("padi contract skew");
  });

  it("a brand-carrying skew from ANOTHER module realm still classifies as skew", () => {
    // The whole reason this is a brand check and not `instanceof`: a CLI face
    // and the dial kit that raised the error can sit on different module
    // instances of `@kolu/surface-daemon-supervisor` (a bundled binary, a
    // re-exported copy). A structural twin stands in for that second realm.
    const foreign = Object.assign(new Error("padi contract skew: 9.0 vs 4.1"), {
      isContractSkew: true as const,
      subject: "padi",
      daemonVersion: "9.0",
      requiredVersion: "4.1",
    });
    expect(classifyDialFailure(foreign)._tag).toBe("PadiContractSkew");
  });

  it("anything else becomes PadiDialFailed, carrying its message and cause", () => {
    const err = new Error(
      "connect ECONNREFUSED /run/user/1000/padi-x/padi.sock",
    );
    const classified = classifyDialFailure(err);
    expect(classified._tag).toBe("PadiDialFailed");
    expect(classified.message).toContain("ECONNREFUSED");
    expect((classified as { cause: unknown }).cause).toBe(err);
  });

  it("a non-Error rejection still carries a readable message", () => {
    // An unguarded `(err as Error).message` would read `undefined` here and
    // degrade the ONE diagnostic that says what broke.
    expect(classifyDialFailure("socket vanished").message).toBe(
      "socket vanished",
    );
  });
});

describe("requireReachablePadi", () => {
  it("a missing padi is a CliFailure with the face-prefixed line", () => {
    const exit = Effect.runSyncExit(
      requireReachablePadi(
        Effect.fail(
          new PadiNotAddressable({ message: "no running padi daemon found" }),
        ),
      ),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) return;
    const err = Cause.squash(exit.cause) as CliFailure;
    expect(err).toBeInstanceOf(CliFailure);
    expect(err.code).toBe(1);
    expect(err.stderr).toBe("kolu mcp: no running padi daemon found\n");
  });

  it("a refused socket is a CliFailure — not a clean MCP handshake", () => {
    const exit = Effect.runSyncExit(
      requireReachablePadi(
        Effect.fail(
          classifyDialFailure(new Error("connect ECONNREFUSED /tmp/gone.sock")),
        ),
      ),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) return;
    const err = Cause.squash(exit.cause) as CliFailure;
    expect(err).toBeInstanceOf(CliFailure);
    expect(err.code).toBe(1);
    expect(err.stderr).toContain("ECONNREFUSED");
    expect(err.stderr.startsWith("kolu mcp: ")).toBe(true);
  });

  it("a successful probe disposes the connection and continues", () => {
    const dispose = vi.fn();
    const conn = {
      client: {} as KoluCliConnection["client"],
      dispose,
    };
    Effect.runSync(requireReachablePadi(Effect.succeed(conn)));
    expect(dispose).toHaveBeenCalledOnce();
  });
});

describe("guardedMcpDial", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a contract skew exits 1 (loud mid-session — write is best-effort)", () => {
    // `exitMcpLoud` uses writeSync on stderr.fd (cannot spy on ESM node:fs);
    // the load-bearing pin is that process.exit(1) always runs after the write
    // attempt, even if the write throws.
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
      code?: number,
    ) => {
      throw new Error(`exit(${code})`);
    }) as never);
    const exit = Effect.runSyncExit(
      guardedMcpDial(Effect.fail(classifyDialFailure(skew()))),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("a transport failure fails TYPED and retryable — never queued", () => {
    const exit = Effect.runSyncExit(
      guardedMcpDial(
        Effect.fail(
          classifyDialFailure(new Error("connect ECONNREFUSED /run/padi.sock")),
        ),
      ),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) return;
    expect((Cause.squash(exit.cause) as Error).message).toMatch(
      /^padi transport down: .*ECONNREFUSED.*retryable/,
    );
  });

  it("a padi that cannot be ADDRESSED is a transport gap too, not a skew", () => {
    const exit = Effect.runSyncExit(
      guardedMcpDial(
        Effect.fail(
          new PadiNotAddressable({ message: "no running padi daemon found" }),
        ),
      ),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) return;
    expect((Cause.squash(exit.cause) as Error).message).toMatch(
      /^padi transport down: no running padi daemon found.*retryable/,
    );
  });

  it("a successful dial passes the connection straight through", () => {
    const conn = {
      client: {} as KoluCliConnection["client"],
      dispose: () => {},
    };
    expect(Effect.runSync(guardedMcpDial(Effect.succeed(conn)))).toBe(conn);
  });
});
