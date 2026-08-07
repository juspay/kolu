/**
 * The listener-lifecycle telemetry falsifier (juspay/kolu#2101 N3).
 *
 * MASTER logged post-listen server faults — `v2.2.0:packages/surface/src/unix-socket.ts:318`
 * spelled `server.on("error", err => log?.error({ err }, "unix-socket server error"))`.
 * The Effect port replaced that with a bare `server.on("error", () => {})` and deleted the
 * `log` seam outright, so the #2101 field incident — a kaval whose listening socket went
 * comatose after a macOS suspend/resume — produced ZERO error or warn lines for its entire
 * life. Whatever the kernel did to that socket would have left a trace on master and left
 * none here.
 *
 * These tests drive the REAL `net.Server` the module binds (captured through a thin
 * `createServer` wrapper — everything else in `node:net` stays actual, including the
 * `createConnection` the bind-time probe uses) and assert one structured line per listener
 * lifecycle event, each naming the socket path.
 */
import { mkdtempSync } from "node:fs";
import type { Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({ servers: [] as Server[] }));

vi.mock("node:net", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:net")>();
  const createServer = ((...args: unknown[]) => {
    const server = (actual.createServer as (...a: unknown[]) => Server)(
      ...args,
    );
    captured.servers.push(server);
    return server;
  }) as typeof actual.createServer;
  return { ...actual, createServer, default: { ...actual, createServer } };
});

const { defineSurface } = await import("./define");
const { implementSurface } = await import("./server");
const { serveOverUnixSocket } = await import("./unix-socket");
type UnixSocketListener = import("./unix-socket").UnixSocketListener;

const surface = defineSurface({
  procedures: {
    math: {
      double: {
        input: Schema.Struct({ x: Schema.Number }),
        output: Schema.Struct({ y: Schema.Number }),
      },
    },
  },
});

function buildServed() {
  const runtime = implementSurface(surface, {
    procedures: {
      math: { double: ({ input }) => Effect.succeed({ y: input.x * 2 }) },
    },
  });
  return { group: runtime.group, handlers: runtime.handlers };
}

/** A structured sink that keeps the WHOLE line — level, context object, and
 *  message — so a test can assert the socket path travelled as data, not as
 *  prose a grep would have to parse back out. */
function recordingLogger() {
  const lines: {
    level: "debug" | "info" | "warn" | "error";
    ctx: Record<string, unknown>;
    msg: string;
  }[] = [];
  const at =
    (level: "debug" | "info" | "warn" | "error") =>
    (ctx: Record<string, unknown>, msg: string) => {
      lines.push({ level, ctx, msg });
    };
  return {
    lines,
    log: {
      debug: at("debug"),
      info: at("info"),
      warn: at("warn"),
      error: at("error"),
    },
  };
}

function freshSocketPath(): string {
  return join(
    mkdtempSync(join(tmpdir(), "surface-usock-telemetry-")),
    "a.sock",
  );
}

describe("serveOverUnixSocket — listener lifecycle telemetry (#2101 N3)", () => {
  let open: UnixSocketListener | undefined;
  afterEach(() => {
    open?.close();
    open = undefined;
    captured.servers.length = 0;
  });

  it("logs ONE structured line naming the socket path when the listener binds", async () => {
    const { lines, log } = recordingLogger();
    const socketPath = freshSocketPath();
    open = await serveOverUnixSocket({ socketPath, ...buildServed(), log });

    const bound = lines.filter((l) => l.msg.includes("bound"));
    expect(bound).toHaveLength(1);
    expect(bound[0]?.level).toBe("info");
    expect(bound[0]?.ctx.socketPath).toBe(socketPath);
  });

  it("logs a POST-LISTEN server error — the master behaviour the Effect port silenced", async () => {
    const { lines, log } = recordingLogger();
    const socketPath = freshSocketPath();
    open = await serveOverUnixSocket({ socketPath, ...buildServed(), log });

    const server = captured.servers.at(-1);
    if (server === undefined) throw new Error("no net.Server was captured");
    lines.length = 0;

    // The field shape: the listening socket faults AFTER bind, with nobody
    // dialing and no handler in flight. Master turned this into a log line;
    // the Effect port swallowed it in `server.on("error", () => {})`.
    server.emit("error", new Error("post-listen listener fault"));

    const errors = lines.filter((l) => l.level === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.ctx.socketPath).toBe(socketPath);
    expect((errors[0]?.ctx.err as Error | undefined)?.message).toBe(
      "post-listen listener fault",
    );
  });

  it("logs ONE structured line when the listener closes", async () => {
    const { lines, log } = recordingLogger();
    const socketPath = freshSocketPath();
    const listener = await serveOverUnixSocket({
      socketPath,
      ...buildServed(),
      log,
    });
    lines.length = 0;
    listener.close();

    const closed = lines.filter((l) => l.msg.includes("closed"));
    expect(closed).toHaveLength(1);
    expect(closed[0]?.level).toBe("info");
    expect(closed[0]?.ctx.socketPath).toBe(socketPath);
  });

  it("close() is idempotent — a second call narrates nothing", async () => {
    const { lines, log } = recordingLogger();
    const socketPath = freshSocketPath();
    const listener = await serveOverUnixSocket({
      socketPath,
      ...buildServed(),
      log,
    });
    listener.close();
    lines.length = 0;
    listener.close();
    expect(lines).toHaveLength(0);
  });
});
