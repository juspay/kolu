/**
 * `guardedMcpConnect` — the restart discipline's two failure arms, pinned:
 * a contract skew EXITS loud (the honest upgrade line, never a server left
 * serving a surface it can't represent); any other dial failure rethrows fast
 * with the typed `padi transport down:` prefix (retryable, nothing queues).
 */
import { DaemonContractSkewError } from "@kolu/surface-daemon-supervisor";
import { afterEach, describe, expect, it, vi } from "vitest";
import { guardedMcpConnect } from "./mcp.ts";

describe("guardedMcpConnect", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a contract skew writes the upgrade line to stderr and exits 1", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
      code?: number,
    ) => {
      throw new Error(`exit(${code})`);
    }) as never);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const connect = guardedMcpConnect(async () => {
      throw new DaemonContractSkewError({
        subject: "padi",
        daemonVersion: "9.0",
        requiredVersion: "4.1",
      });
    });
    await expect(connect()).rejects.toThrow("exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(String(stderrSpy.mock.calls[0]?.[0])).toContain(
      "padi contract skew",
    );
  });

  it("a transport failure rethrows TYPED and retryable — never queued", async () => {
    const connect = guardedMcpConnect(async () => {
      throw new Error("connect ECONNREFUSED /run/user/1000/padi-x/padi.sock");
    });
    await expect(connect()).rejects.toThrow(
      /^padi transport down: .*ECONNREFUSED.*retryable/,
    );
  });
});
