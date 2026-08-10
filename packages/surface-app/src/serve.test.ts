/**
 * `serveSurfaceApp` — the whole listener, driven for real.
 *
 * Nothing here is stubbed: a real `http.Server` on a real (OS-chosen) port, a
 * real `ws` upgrade, a real `websocketLink` dialling it, real ndjson frames, and
 * a real `implementSurface` runtime answering. That is deliberate — the thing
 * this primitive owns is an ORDER between five steps that each live in a
 * different layer, and an order is only observable end to end.
 *
 * The regression surface: the origin gate must run before the upgrade, the
 * stale-tab gate before any dispatch, the inbound frame cap must be the
 * FRAMEWORK's rather than a consumer's guess, and closing the scope must drop
 * live connections rather than hang on them.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RPC_MAX_FRAME_BYTES } from "@kolu/surface/frame-limit";
import { surfaceProcessId } from "@kolu/surface/identity";
import { defineSurface } from "@kolu/surface/define";
import { implementSurface } from "@kolu/surface/server";
import { Context, Effect, Exit, Layer, Schema, Scope } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";
import { WebSocket as WsClient } from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSurfaceSocket } from "./connect";
import { STALE_PROCESS_CLOSE_CODE, SURFACE_WS_PATH } from "./index";
import {
  serveSurfaceApp,
  SurfaceAppListenFailed,
  type ServeSurfaceAppOptions,
} from "./serve";

/** A viewer fact only a per-connection `Layer` can supply — the seam kolu's
 *  `viewerAddress` rides. Declared here so the passthrough is proven, not
 *  assumed. */
class Viewer extends Context.Service<Viewer, { readonly seen: string }>()(
  "surface-app-test/Viewer",
) {}

/** A surface with one procedure that takes a payload as large as the caller
 *  likes (so the frame cap is observable) and one that can only be answered by
 *  reading the per-connection service. */
const testSurface = defineSurface({
  procedures: {
    echo: {
      length: {
        input: Schema.Struct({ text: Schema.String }),
        output: Schema.Struct({ length: Schema.Number }),
      },
    },
    viewer: {
      seen: {
        input: Schema.Struct({}),
        output: Schema.Struct({ seen: Schema.String }),
      },
    },
  },
});

const makeRuntime = () =>
  implementSurface(testSurface, {
    procedures: {
      echo: {
        length: ({ input }) => Effect.succeed({ length: input.text.length }),
      },
      viewer: {
        // This handler REQUIRES a service no in-process caller supplies — it is
        // satisfied per CONNECTION, which is exactly the claim under test. The
        // deps type has no room for an unsatisfied requirement (kolu's own
        // `hosts/viewer` is in the same position), so the cast is the seam.
        seen: (() =>
          Viewer.use((viewer) =>
            Effect.succeed({ seen: viewer.seen }),
          )) as never,
      },
    },
  });

/** A client bundle on disk: the shell the static layer serves. */
function makeDist(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "surface-app-serve-"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>shell</title>");
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Everything one booted server holds, and the one call that drops it all. */
interface Booted {
  url: string;
  wsUrl: string;
  runtime: ReturnType<typeof makeRuntime>;
  teardown: () => Promise<void>;
}

const booted: Booted[] = [];

afterEach(async () => {
  while (booted.length > 0) await booted.pop()?.teardown();
});

async function boot(
  overrides: Partial<ServeSurfaceAppOptions> = {},
): Promise<Booted> {
  const dist = makeDist();
  const runtime = makeRuntime();
  const scope = Scope.makeUnsafe();
  const url = await Effect.runPromise(
    serveSurfaceApp({
      group: runtime.group,
      handlers: runtime.handlers,
      clientDist: dist.dir,
      host: "127.0.0.1",
      // The OS picks — a fixed port would make this suite a lottery on a busy
      // machine, which is the failure the primitive's own error type is about.
      port: 0,
      allowedOrigins: [],
      ...overrides,
    }).pipe(Scope.provide(scope)),
  );
  const entry: Booted = {
    url,
    wsUrl: `${url.replace(/^http/, "ws")}${SURFACE_WS_PATH}`,
    runtime,
    teardown: async () => {
      await Effect.runPromise(Scope.close(scope, Exit.void));
      await runtime.close();
      dist.cleanup();
    },
  };
  booted.push(entry);
  return entry;
}

/** A real dial at the served surface, over a real `ws` client socket. */
async function dial(server: Booted, url = server.wsUrl) {
  const socket = await createSurfaceSocket({
    group: server.runtime.group,
    url,
    retired: () => {},
    connect: (target) => new WsClient(target) as unknown as WebSocket,
  });
  return socket;
}

describe("serveSurfaceApp — the whole listener in one call", () => {
  it("serves the shell over HTTP and the surface over one websocket", async () => {
    const server = await boot();

    const shell = await fetch(`${server.url}/`);
    expect(shell.status).toBe(200);
    expect(await shell.text()).toContain("<title>shell</title>");
    // The freshness contract the shell layer owns — proof the layer is mounted,
    // not merely constructed.
    expect(shell.headers.get("cache-control")).toBe("no-store");

    const socket = await dial(server);
    const answer = await Effect.runPromise(
      socket.link.dispatch.unary("surface/echo/length", { text: "hello" }),
    );
    expect(answer).toEqual({ length: 5 });
    await socket.dispose();
  });

  it("merges the app's OWN routes, and they beat the shell's catch-all", async () => {
    const server = await boot({
      routes: HttpRouter.add(
        "GET",
        "/mcp",
        HttpServerResponse.text("the app's own route"),
      ),
    });
    const answer = await fetch(`${server.url}/mcp`);
    expect(await answer.text()).toBe("the app's own route");
    // …while an unclaimed path still falls through to the SPA shell.
    expect(
      await (await fetch(`${server.url}/some/deep/link`)).text(),
    ).toContain("<title>shell</title>");
  });

  it("carries a frame the FRAMEWORK's cap allows — not a consumer's guess at it", async () => {
    // The recorded defect (olai's `frame-cap`): an app set `ws`'s `maxPayload` to
    // 8 MiB while `RPC_MAX_FRAME_BYTES` says 16 MiB. Both police the same inbound
    // leg, so the lower one silently governed and a frame the framework promises
    // to carry — one `exceedsFrameLimit` reports as fine, and every margin derived
    // from it sizes against — died at the raw `ws` layer instead of on the handled
    // path. The size here is DERIVED from the constant, so an undercut of any size
    // fails this rather than only the historic 8 MiB one.
    const server = await boot();
    const socket = await dial(server);
    // Room for the frame's own JSON envelope (tag, id, headers) under the cap.
    const text = "x".repeat(RPC_MAX_FRAME_BYTES - 4096);
    const answer = await Effect.runPromise(
      socket.link.dispatch.unary("surface/echo/length", { text }),
    );
    expect(answer).toEqual({ length: text.length });
    await socket.dispose();
  }, 60_000);

  it("supplies each connection's own services to its handlers", async () => {
    const server = await boot({
      services: (connection) =>
        Layer.succeed(Viewer)({ seen: connection.url.pathname }),
    });
    const socket = await dial(server);
    const answer = await Effect.runPromise(
      socket.link.dispatch.unary("surface/viewer/seen", {}),
    );
    expect(answer).toEqual({ seen: SURFACE_WS_PATH });
    await socket.dispose();
  });
});

describe("serveSurfaceApp — the gates in front of dispatch", () => {
  it("refuses a cross-site Origin BEFORE the upgrade", async () => {
    const onDisallowedOrigin = vi.fn();
    const server = await boot({ onDisallowedOrigin });
    const raw = new WsClient(server.wsUrl, {
      origin: "http://evil.example",
    });
    await new Promise<void>((resolve, reject) => {
      raw.on("error", () => resolve());
      raw.on("open", () => reject(new Error("the upgrade was allowed")));
    });
    expect(onDisallowedOrigin).toHaveBeenCalledWith("http://evil.example");
  });

  it("allows a same-origin browser through the gate", async () => {
    const server = await boot();
    const origin = server.url;
    const socket = await createSurfaceSocket({
      group: server.runtime.group,
      url: server.wsUrl,
      retired: () => {},
      connect: (target) =>
        new WsClient(target, { origin }) as unknown as WebSocket,
    });
    expect(
      await Effect.runPromise(
        socket.link.dispatch.unary("surface/echo/length", { text: "ok" }),
      ),
    ).toEqual({ length: 2 });
    await socket.dispose();
  });

  it("upgrades on the surface path and destroys every other one", async () => {
    const server = await boot();
    const stray = new WsClient(`${server.url.replace(/^http/, "ws")}/nope`);
    await new Promise<void>((resolve, reject) => {
      stray.on("error", () => resolve());
      stray.on("open", () => reject(new Error("a stray path was upgraded")));
    });
  });

  it("closes a tab bound to a PREVIOUS process, and never serves it", async () => {
    const onStaleTab = vi.fn();
    const server = await boot({ onStaleTab });
    const stale = new WsClient(`${server.wsUrl}?pid=a-process-that-is-gone`);
    const code = await new Promise<number>((resolve) => {
      stale.on("close", (closeCode) => resolve(closeCode));
    });
    expect(code).toBe(STALE_PROCESS_CLOSE_CODE);
    expect(onStaleTab).toHaveBeenCalledWith(
      "a-process-that-is-gone",
      expect.any(URL),
    );
  });

  it("serves a tab presenting THIS process's id", async () => {
    const server = await boot();
    const socket = await dial(
      server,
      `${server.wsUrl}?pid=${encodeURIComponent(surfaceProcessId())}`,
    );
    expect(
      await Effect.runPromise(
        socket.link.dispatch.unary("surface/echo/length", { text: "live" }),
      ),
    ).toEqual({ length: 4 });
    await socket.dispose();
  });
});

describe("serveSurfaceApp — binding and teardown", () => {
  it("reports a bind failure as SurfaceAppListenFailed, cause intact", async () => {
    const taken = await boot();
    const port = Number(new URL(taken.url).port);
    const dist = makeDist();
    const runtime = makeRuntime();
    const scope = Scope.makeUnsafe();
    // `flip` so the failure IS the value: a bind failure has to be a typed
    // failure a consumer can catch, never a defect.
    const failure = await Effect.runPromise(
      serveSurfaceApp({
        group: runtime.group,
        handlers: runtime.handlers,
        clientDist: dist.dir,
        host: "127.0.0.1",
        port,
        allowedOrigins: [],
      }).pipe(Scope.provide(scope), Effect.flip),
    );
    expect(failure).toBeInstanceOf(SurfaceAppListenFailed);
    // The `cause` is carried verbatim, which is what lets a consumer write a
    // port policy against `EADDRINUSE` instead of matching on a message string.
    expect(failure.cause).toMatchObject({ code: "EADDRINUSE" });
    expect(failure.message).toContain(`127.0.0.1:${port}`);
    await Effect.runPromise(Scope.close(scope, Exit.void));
    await runtime.close();
    dist.cleanup();
  });

  it("closing the scope DROPS a live connection and frees the port", async () => {
    const server = await boot();
    const socket = await dial(server);
    // A live websocket AND a keep-alive HTTP connection — the two a browser
    // holds, and the two that used to make `server.close()` hang forever.
    await fetch(`${server.url}/`);
    const port = Number(new URL(server.url).port);

    await server.teardown();
    booted.length = 0;

    // The port is free: a second server binds it, which it could not do while
    // anything was still listening.
    const again = await boot({ port } as Partial<ServeSurfaceAppOptions>);
    expect(Number(new URL(again.url).port)).toBe(port);
    await socket.dispose();
  });
});
