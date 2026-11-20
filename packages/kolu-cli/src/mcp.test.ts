import { DaemonContractSkewError } from "@kolu/surface-daemon-supervisor";
import { Cause, Effect, Exit } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyDialFailure,
  type KoluCliConnection,
  PadiNotAddressable,
} from "./connect.ts";
import { CliFailure } from "./exit.ts";
import { midSessionDial, probePadiAtStartup } from "./mcp.ts";

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
    expect(classifyDialFailure("socket vanished").message).toBe(
      "socket vanished",
    );
  });
});

describe("probePadiAtStartup", () => {
  it("a missing padi is a CliFailure with the face-prefixed line", () => {
    const exit = Effect.runSyncExit(
      probePadiAtStartup(
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
      probePadiAtStartup(
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
    Effect.runSync(probePadiAtStartup(Effect.succeed(conn)));
    expect(dispose).toHaveBeenCalledOnce();
  });
});

describe("midSessionDial", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a contract skew exits 1 (loud mid-session — write is best-effort)", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
      code?: number,
    ) => {
      throw new Error(`exit(${code})`);
    }) as never);
    const exit = Effect.runSyncExit(
      midSessionDial(Effect.fail(classifyDialFailure(skew()))),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("a transport failure fails TYPED and retryable — never queued", () => {
    const exit = Effect.runSyncExit(
      midSessionDial(
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
      midSessionDial(
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
    expect(Effect.runSync(midSessionDial(Effect.succeed(conn)))).toBe(conn);
  });
});
