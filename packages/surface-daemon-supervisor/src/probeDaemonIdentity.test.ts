import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { controlCoreFragment, controlCoreSurface } from "@kolu/surface-daemon";
import { defineSurface } from "@kolu/surface/define";
import { implementSurface, implementSurfaces } from "@kolu/surface/server";
import { serveOverUnixSocket } from "@kolu/surface/unix-socket";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isUnspeakableProtocolError } from "./convergence/unspeakable.ts";
import {
  probeDaemonIdentity,
  probeDaemonIdentityFrom,
  readControlCoreHello,
  UNSPEAKABLE_SILENCE_MS,
} from "./probeDaemonIdentity.ts";

const listeners: Array<{ close(): void }> = [];
const rawServers: Server[] = [];
afterEach(() => {
  for (const listener of listeners.splice(0)) listener.close();
  for (const server of rawServers.splice(0)) {
    (
      server as Server & { closeAllConnections?: () => void }
    ).closeAllConnections?.();
    server.close();
  }
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
        // Let the wire flush the drain response; real daemons close during the
        // lifecycle abort that follows the handler, not inside the write.
        onDrain: () => {
          setImmediate(() => listener?.close());
        },
      }),
    },
  );
  listener = await serveOverUnixSocket({
    socketPath: path,
    group: runtime.group,
    handlers: runtime.handlers,
  });
  listeners.push(listener);
  return listener;
}

/** A listener that accepts and then writes bytes no ndjson parser can decode —
 *  the shape of a daemon from the PREVIOUS protocol epoch, whose framing this
 *  build cannot speak at all (PLAN D6). */
async function serveGarbage(
  path: string,
  bytes: string,
  opts: { endAfterWrite?: boolean } = {},
): Promise<Server> {
  const server = createServer((socket) => {
    socket.on("error", () => {});
    socket.write(bytes);
    if (opts.endAfterWrite) socket.end();
  });
  rawServers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server;
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
      group: runtime.group,
      handlers: runtime.handlers,
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
              hello: () =>
                Effect.suspend(() => {
                  helloCalls += 1;
                  if (helloCalls > 1) return Effect.never;
                  return Effect.succeed({
                    stateRoot: "/state/daemon",
                    surfaceVersion: "2.4",
                    controlCoreVersion: "1.0",
                    startedAt: 99,
                    commit: "abc1234",
                    buildId: "build-9",
                  });
                }),
              drain: () => Effect.void,
            },
          },
        },
      },
    );
    const listener = await serveOverUnixSocket({
      socketPath: path,
      group: runtime.group,
      handlers: runtime.handlers,
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

  // ── PLAN D6 / review #3 + #9 — the epoch break, at the first frame ─────────

  it("classifies an undecodable first frame as unspeakable — not absent, not a generic failure", async () => {
    const path = socketPath("probe-unspeakable-");
    await serveGarbage(path, "not ndjson at all\n");
    const probe = probeDaemonIdentity({ capability: "not-drainable" });
    const err = await probe(path).then(
      (value) => {
        throw new Error(`expected a rejection, got ${JSON.stringify(value)}`);
      },
      (e: unknown) => e,
    );
    expect(isUnspeakableProtocolError(err)).toBe(true);
    if (!isUnspeakableProtocolError(err)) throw new Error("unreachable");
    expect(err.socketPath).toBe(path);
    // Evidence as a FIELD, JSON-quoted so a hostile peer's newlines or control
    // bytes cannot reshape the operator log line it lands in — and never
    // re-parsed back out of the prose.
    expect(err.evidence.trigger).toBe("undecodable-frame");
    if (err.evidence.trigger !== "undecodable-frame") {
      throw new Error("unreachable");
    }
    expect(err.evidence.frame).toContain("not ndjson at all");
    expect(err.evidence.frame).toBe(JSON.stringify("not ndjson at all\n"));
  });

  it("classifies at the decode, not by waiting out the 30s hello deadline (#9)", async () => {
    const path = socketPath("probe-unspeakable-bound-");
    await serveGarbage(path, "]]] garbage\n");
    const probe = probeDaemonIdentity({ capability: "not-drainable" });
    // The frozen hello's own deadline is 30_000ms. If the classification rode
    // that deadline instead of the first-frame decode, the 2s bound would win.
    const outcome = await Promise.race([
      probe(path).then(
        () => "resolved" as const,
        (e: unknown) =>
          isUnspeakableProtocolError(e)
            ? ("unspeakable" as const)
            : ("other" as const),
      ),
      new Promise<"rode-the-hello-deadline">((resolve) =>
        setTimeout(() => resolve("rode-the-hello-deadline"), 2_000),
      ),
    ]);
    expect(outcome).toBe("unspeakable");
  });

  // ── The SECOND trigger: a peer that accepts and never speaks ──────────────
  //
  // A real previous-release daemon never gets as far as an undecodable frame:
  // its oRPC server waits for a client hello it can recognise, our ndjson is not
  // one, and nobody says anything until the protocol's own ping timeout kills
  // the connection ~10 s later as an ordinary transport death. That is the
  // measured failure `previousRelease.e2e` hit (probe-failed ⇒ refuse ⇒ the old
  // daemon left standing), and these three tests are its fix.

  it("classifies a peer that accepts and stays SILENT as unspeakable", async () => {
    const path = socketPath("probe-silent-");
    // Accept, read everything, answer nothing — ever. That is what a peer from
    // another protocol epoch does: it parses our frames and recognises none of
    // them, so it goes on waiting for a greeting that will never come.
    const server = createServer((socket) => {
      socket.on("error", () => {});
      socket.resume();
    });
    rawServers.push(server);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(path, () => {
        server.off("error", reject);
        resolve();
      });
    });

    const started = Date.now();
    const err = await probeDaemonIdentity({ capability: "not-drainable" })(
      path,
    ).then(
      (value) => {
        throw new Error(`expected a rejection, got ${JSON.stringify(value)}`);
      },
      (e: unknown) => e,
    );
    const elapsed = Date.now() - started;

    expect(isUnspeakableProtocolError(err)).toBe(true);
    if (!isUnspeakableProtocolError(err)) throw new Error("unreachable");
    expect(err.socketPath).toBe(path);
    expect(err.evidence).toEqual({
      trigger: "silence",
      silentForMs: UNSPEAKABLE_SILENCE_MS,
    });
    // The bound must WIN against the RPC protocol's own ping timeout — past
    // that the connection is dead of an ordinary transport error and there is
    // nothing left to classify. This is the assertion that would have caught
    // the previousRelease regression at unit scale.
    expect(elapsed).toBeLessThan(9_500);
  }, 20_000);

  it("brackets the silence bound between the protocol's ping and its ping timeout", () => {
    // Not a magic number: Effect's RPC socket protocol pings every 5 s (so a
    // peer of this epoch has demonstrably spoken by then, below its handlers)
    // and fails the connection after two unanswered intervals.
    expect(UNSPEAKABLE_SILENCE_MS).toBeGreaterThan(5_000);
    expect(UNSPEAKABLE_SILENCE_MS).toBeLessThan(10_000);
  });

  it("does NOT misfire on a slow-but-speaking daemon: a pong is speech (#9)", async () => {
    const path = socketPath("probe-slow-hello-");
    // A hello that answers only AFTER the silence bound would have expired if
    // nothing else spoke. Nothing else has to: the protocol's 5 s ping draws a
    // pong from the peer's protocol layer while its handler is still parked,
    // and that byte disarms the deadline. This is why the floor is the ping
    // interval and not the handler's latency.
    const runtime = implementSurfaces(
      { control: controlCoreSurface },
      {},
      {
        control: {
          procedures: {
            core: {
              hello: () =>
                Effect.succeed({
                  stateRoot: "/state/daemon",
                  surfaceVersion: "2.4",
                  controlCoreVersion: "1.0",
                  startedAt: 99,
                  commit: "abc1234",
                  buildId: "build-9",
                }).pipe(Effect.delay(UNSPEAKABLE_SILENCE_MS - 2_000)),
              drain: () => Effect.void,
            },
          },
        },
      },
    );
    const listener = await serveOverUnixSocket({
      socketPath: path,
      group: runtime.group,
      handlers: runtime.handlers,
    });
    listeners.push(listener);

    const probe = await probeDaemonIdentity({ capability: "not-drainable" })(
      path,
    );
    expect(probe?.identity).toEqual({
      contractVersion: "2.4",
      build: { kind: "known", id: "build-9" },
    });
    probe?.dispose();
  }, 30_000);

  it("a peer whose framing decodes is SPEAKABLE even when its payload is not ours", async () => {
    // A well-framed ndjson line that is not an RPC message at all. The
    // classification is about FRAMING, never semantics — and that narrowness is
    // exactly what keeps `probe-failed` from being widened — so this stays an
    // ordinary probe failure.
    const path = socketPath("probe-speakable-junk-");
    // The peer hangs up right after its well-framed line, so the hello that
    // will never be answered fails on the transport rather than sitting out its
    // 30s deadline — the failure this test cares about is the CLASSIFICATION,
    // not the wait.
    await serveGarbage(path, '{"hello":"i am well framed"}\n', {
      endAfterWrite: true,
    });
    const probe = probeDaemonIdentity({ capability: "not-drainable" });
    const outcome = await probe(path).then(
      () => "resolved" as const,
      (e: unknown) =>
        isUnspeakableProtocolError(e)
          ? ("unspeakable" as const)
          : ("other" as const),
    );
    expect(outcome).toBe("other");
  });
});

describe("probeDaemonIdentityFrom", () => {
  it.each([
    ["missing buildId", { commit: "def5678" }],
    ["missing commit", { buildId: "remote-build" }],
    ["empty buildId", { buildId: "", commit: "def5678" }],
    ["empty commit", { buildId: "remote-build", commit: "" }],
  ])("reader rejects a frozen hello with %s", async (_label, identity) => {
    await expect(
      readControlCoreHello({
        surface: {
          control: {
            core: {
              hello: async () => ({
                stateRoot: "/state/remote",
                surfaceVersion: "3.1",
                controlCoreVersion: "1.0",
                startedAt: 123,
                ...identity,
              }),
              drain: async () => {},
            },
          },
        },
      }),
    ).rejects.toThrow(
      "incomplete control-core identity: buildId and commit must be both absent, both empty, or both non-empty",
    );
  });

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

  it("accepts the honest off-nix pair emitted by a current fragment", async () => {
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
                buildId: "",
                commit: "",
              }),
              drain: async () => {},
            },
          },
        },
      },
      dispose: () => {},
      capability: "not-drainable",
    });

    expect(probe.identity.build).toEqual({ kind: "off-nix" });
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
