import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { controlCoreFragment, controlCoreSurface } from "@kolu/surface-daemon";
import { defineSurface } from "@kolu/surface/define";
import { implementSurface, implementSurfaces } from "@kolu/surface/server";
import { serveOverUnixSocket } from "@kolu/surface/unix-socket";
import {
  probeDaemonIdentity,
  probeDaemonIdentityFrom,
} from "./probeDaemonIdentity.ts";

const silentLog = { debug() {}, error() {} };
const listeners: Array<{ close(): void }> = [];
afterEach(() => {
  for (const listener of listeners.splice(0)) listener.close();
});

function socketPath(label: string): string {
  return join(mkdtempSync(join(tmpdir(), label)), "daemon.sock");
}

async function serveControl(path: string): Promise<{ close(): void }> {
  let listener: { close(): void } | undefined;
  const runtime = implementSurfaces(
    { control: controlCoreSurface },
    {},
    {
      control: controlCoreFragment({
        stateRoot: "/state/daemon",
        surfaceVersion: "2.4",
        startedAt: 99,
        commit: "abc1234",
        buildId: "build-9",
        // Let oRPC flush the drain response; real daemons close during the
        // lifecycle abort that follows the handler, not inside the wire write.
        onDrain: () => {
          setImmediate(() => listener?.close());
        },
      }),
    },
  );
  listener = await serveOverUnixSocket({
    socketPath: path,
    router: runtime.router as never,
    log: silentLog,
  });
  listeners.push(listener);
  return listener;
}

describe("probeDaemonIdentity", () => {
  it("returns null only when no listener exists", async () => {
    const probe = probeDaemonIdentity({ capability: "not-drainable" });
    await expect(probe(socketPath("probe-absent-"))).resolves.toBeNull();
  });

  it("throws when a listener cannot answer the frozen hello", async () => {
    const empty = defineSurface({});
    const runtime = implementSurface(empty, {});
    const path = socketPath("probe-bad-hello-");
    const listener = await serveOverUnixSocket({
      socketPath: path,
      router: runtime.router as never,
      log: silentLog,
    });
    listeners.push(listener);
    const probe = probeDaemonIdentity({ capability: "not-drainable" });
    await expect(probe(path)).rejects.toThrow();
  });

  it("returns the full drainable probe and confirms exit by hello-gone polling", async () => {
    const path = socketPath("probe-drain-");
    await serveControl(path);
    const probe = await probeDaemonIdentity({
      capability: "drainable",
      drainCeilingMs: 1000,
    })(path);
    expect(probe).not.toBeNull();
    expect(probe?.identity).toEqual({
      contractVersion: "2.4",
      build: { kind: "known", id: "build-9" },
    });
    expect(probe?.instanceKey).toEqual({ kind: "instance", key: 99 });
    const exit = probe?.awaitExit(new AbortController().signal);
    await probe?.fireDrain();
    await expect(exit).resolves.toBeUndefined();
    probe?.dispose();
  });

  it("cancels an in-flight hello poll when the drain ceiling aborts", async () => {
    const path = socketPath("probe-abort-poll-");
    let helloCalls = 0;
    const runtime = implementSurfaces(
      { control: controlCoreSurface },
      {},
      {
        control: {
          procedures: {
            core: {
              hello: async () => {
                helloCalls += 1;
                if (helloCalls > 1) await new Promise<void>(() => {});
                return {
                  stateRoot: "/state/daemon",
                  surfaceVersion: "2.4",
                  controlCoreVersion: "1.0",
                  startedAt: 99,
                  commit: "abc1234",
                  buildId: "build-9",
                };
              },
              drain: async () => {},
            },
          },
        },
      },
    );
    const listener = await serveOverUnixSocket({
      socketPath: path,
      router: runtime.router as never,
      log: silentLog,
    });
    listeners.push(listener);
    const probe = await probeDaemonIdentity({
      capability: "drainable",
      drainCeilingMs: 1000,
    })(path);
    if (probe === null) throw new Error("expected probe");

    const abort = new AbortController();
    const exit = probe.awaitExit(abort.signal);
    await new Promise((resolve) => setTimeout(resolve, 20));
    abort.abort();
    await expect(exit).resolves.toBeUndefined();
    probe.dispose();
  });
});

describe("probeDaemonIdentityFrom", () => {
  it("bounds a frozen hello that never answers", async () => {
    vi.useFakeTimers();
    try {
      const pending = probeDaemonIdentityFrom({
        client: {
          surface: {
            control: {
              core: {
                hello: () => new Promise(() => {}),
                drain: async () => {},
              },
            },
          },
        },
        dispose: () => {},
        capability: "not-drainable",
      });
      const rejection = expect(pending).rejects.toThrow(
        "control-core hello timed out after 30000ms",
      );
      await vi.advanceTimersByTimeAsync(30_000);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects an invalid drain ceiling before touching the wire", async () => {
    let helloCalls = 0;
    await expect(
      probeDaemonIdentityFrom({
        client: {
          surface: {
            control: {
              core: {
                hello: async () => {
                  helloCalls += 1;
                  throw new Error("must not be called");
                },
                drain: async () => {},
              },
            },
          },
        },
        dispose: () => {},
        capability: "drainable",
        drainCeilingMs: 0,
        awaitExit: async () => {},
      }),
    ).rejects.toThrow("drainCeilingMs must be a positive number");
    expect(helloCalls).toBe(0);
  });

  it("is the single full-probe assembler for an already-dialed client", async () => {
    let drained = 0;
    let disposed = 0;
    const awaitExit = async (_signal: AbortSignal): Promise<void> => {};
    const probe = await probeDaemonIdentityFrom({
      client: {
        surface: {
          control: {
            core: {
              hello: async () => ({
                stateRoot: "/state/remote",
                surfaceVersion: "3.1",
                controlCoreVersion: "1.0",
                startedAt: 123,
                commit: "def5678",
                buildId: "remote-build",
              }),
              drain: async () => {
                drained += 1;
              },
            },
          },
        },
      },
      dispose: () => {
        disposed += 1;
      },
      capability: "drainable",
      drainCeilingMs: 6000,
      awaitExit,
    });

    expect(probe.identity).toEqual({
      contractVersion: "3.1",
      build: { kind: "known", id: "remote-build" },
    });
    expect(probe.instanceKey).toEqual({ kind: "instance", key: 123 });
    expect(probe.awaitExit).toBe(awaitExit);
    await probe.fireDrain();
    probe.dispose();
    expect({ drained, disposed }).toEqual({ drained: 1, disposed: 1 });
  });

  it("rejects a contradictory frozen-core version", async () => {
    await expect(
      probeDaemonIdentityFrom({
        client: {
          surface: {
            control: {
              core: {
                hello: async () => ({
                  stateRoot: "/state/remote",
                  surfaceVersion: "3.1",
                  controlCoreVersion: "2.0",
                  startedAt: 123,
                  commit: "def5678",
                  buildId: "remote-build",
                }),
                drain: async () => {},
              },
            },
          },
        },
        dispose: () => {},
        capability: "not-drainable",
      }),
    ).rejects.toThrow("unsupported control-core version 2.0; expected 1.0");
  });
});
