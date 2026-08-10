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
import {
  exceedsFrameLimit,
  isFrameTooLargeClose,
  RPC_MAX_FRAME_BYTES,
} from "@kolu/surface/frame-limit";
import { surfaceProcessId } from "@kolu/surface/identity";
import { defineSurface } from "@kolu/surface/define";
import { implementSurface } from "@kolu/surface/server";
import { Context, Effect, Exit, Layer, Schema, Scope } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";
import { WebSocket as WsClient } from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSurfaceSocket } from "./connect";
import {
  STALE_PROCESS_CLOSE_CODE,
  SURFACE_WS_PATH,
  surfaceWsUrl,
} from "./index";
import {
  serveSurfaceApp,
  SurfaceAppListenFailed,
  type ServeSurfaceAppOptions,
  type SurfaceAppEvent,
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
        // `hosts/viewer` is in the same position), so the cast erases the
        // REQUIREMENT and nothing else: input and output stay checked, the way
        // kolu's own record-level erasure (`packages/server/src/router.ts`) does
        // it. `as never` would have made a wrong shape compile too.
        seen: (() =>
          Viewer.use((viewer) =>
            Effect.succeed({ seen: viewer.seen }),
          )) as unknown as () => Effect.Effect<{ readonly seen: string }>,
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
  /** IDEMPOTENT, and it de-registers itself — so a test that tears its own
   *  server down mid-body says exactly that, and nothing has to be crossed off a
   *  hand-maintained list afterwards. */
  teardown: () => Promise<void>;
}

const booted: Booted[] = [];

afterEach(async () => {
  while (booted.length > 0) await booted.pop()?.teardown();
});

/** Generic in `Svc`, so a test supplying `services` exercises the TYPE-level seam
 *  (a `Layer<Viewer>` reaching a handler that requires `Viewer`) and not only the
 *  runtime passthrough — the whole reason `services` is generic. */
async function boot<Svc = never>(
  overrides: Partial<ServeSurfaceAppOptions<Svc>> = {},
): Promise<Booted> {
  const dist = makeDist();
  const runtime = makeRuntime();
  const scope = Scope.makeUnsafe();
  let closed = false;
  let entry: Booted | undefined;
  // The three-step release, owned here whether the bind succeeded or not — a
  // failed bind still leaves a scope to close, a runtime to stop and a temp dist
  // to remove. Idempotent, and it de-registers itself, so a test that tears its
  // own server down mid-body needs no bookkeeping afterwards.
  const release = async () => {
    if (closed) return;
    closed = true;
    const at = entry === undefined ? -1 : booted.indexOf(entry);
    if (at >= 0) booted.splice(at, 1);
    await Effect.runPromise(Scope.close(scope, Exit.void));
    await runtime.close();
    dist.cleanup();
  };
  const bound = await Effect.runPromise(
    serveSurfaceApp<Svc>({
      group: runtime.group,
      handlers: runtime.handlers,
      clientDist: dist.dir,
      host: "127.0.0.1",
      // The OS picks — a fixed port would make this suite a lottery on a busy
      // machine, which is the failure the primitive's own error type is about.
      port: 0,
      allowedOrigins: [],
      ...overrides,
    }).pipe(Scope.provide(scope), Effect.result),
  );
  // `Effect.result` so the TYPED failure survives the promise boundary intact —
  // a `runPromise` rejection would hand the test a wrapper to unpick, and the
  // whole claim of `SurfaceAppListenFailed` is that it arrives whole.
  if (bound._tag === "Failure") {
    await release();
    throw bound.failure;
  }
  const url = bound.success;
  entry = {
    url,
    // The SAME derivation the browser leg uses, so this suite dials what a real
    // client dials rather than a lookalike built by string surgery.
    wsUrl: surfaceWsUrl(url),
    runtime,
    teardown: release,
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

  it("refuses a frame whose BYTES bust the budget, agreeing with the published predicate", async () => {
    // The two caps count different units: `ws`'s `maxPayload` counts UTF-8
    // BYTES, the RPC decoder's `maxBufferSize` counts UTF-16 code units. For
    // non-ASCII text the decoder is the LAXER of the two — and that laxness is
    // not a promise. `exceedsFrameLimit(bytes)` is what every sender in this repo
    // budgets against, so the wire must refuse exactly what it refuses.
    // Three UTF-8 bytes per character, so one char past a third of the budget is
    // the SMALLEST string that makes both claims below — no reason to build a
    // 1.5x-larger one and carry the peak memory for it.
    const text = "あ".repeat(Math.floor(RPC_MAX_FRAME_BYTES / 3) + 1);
    const bytes = Buffer.byteLength(text, "utf8");
    // Under the decoder's code-unit cap…
    expect(text.length).toBeLessThan(RPC_MAX_FRAME_BYTES);
    // …and over the published byte budget.
    expect(exceedsFrameLimit(bytes)).toBe(true);

    const server = await boot();
    const raw = new WsClient(server.wsUrl, { origin: server.url });
    await new Promise<void>((resolve, reject) => {
      raw.on("open", () => resolve());
      raw.on("error", reject);
    });
    const code = await new Promise<number>((resolve) => {
      raw.on("close", (closeCode) => resolve(closeCode));
      raw.send(text);
    });
    // The wire and the predicate agree: what senders were told to refuse is
    // exactly what the transport refuses.
    expect(isFrameTooLargeClose(code)).toBe(true);
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

  it("narrates a connection's whole life on the ONE sink", async () => {
    // The inc/dec pair a live-connection count is built from — the example's
    // `serverStats.connections`, and the reason the sink has lifecycle arms at
    // all rather than only fault arms.
    const events: SurfaceAppEvent[] = [];
    const server = await boot({ onEvent: (event) => events.push(event) });
    const socket = await dial(server);
    // One answered call, so the socket is demonstrably open and served before
    // the narration is read (the link dials lazily).
    await Effect.runPromise(
      socket.link.dispatch.unary("surface/echo/length", { text: "hi" }),
    );
    expect(events.map((event) => event._tag)).toEqual(["Connected"]);
    await socket.dispose();
    await vi.waitFor(() =>
      expect(events.map((event) => event._tag)).toEqual([
        "Connected",
        "Disconnected",
      ]),
    );
    // The SAME connection both times: a counter keyed on it can pair them.
    const [connected, disconnected] = events;
    expect(
      connected?._tag === "Connected" && disconnected?._tag === "Disconnected"
        ? connected.connection === disconnected.connection
        : false,
    ).toBe(true);
  });
});

describe("serveSurfaceApp — the gates in front of dispatch", () => {
  it("refuses a cross-site Origin BEFORE the upgrade", async () => {
    const onEvent = vi.fn();
    const server = await boot({ onEvent });
    const raw = new WsClient(server.wsUrl, {
      origin: "http://evil.example",
    });
    await new Promise<void>((resolve, reject) => {
      raw.on("error", () => resolve());
      raw.on("open", () => reject(new Error("the upgrade was allowed")));
    });
    expect(onEvent).toHaveBeenCalledWith({
      _tag: "DisallowedOrigin",
      origin: "http://evil.example",
      // The refused upgrade's own target — the gate runs one line after the
      // parse, so the sink never has to say "some upgrade, somewhere".
      url: expect.any(URL),
    });
    // …and nothing was ever narrated as a connection: the gate is in front.
    expect(onEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ _tag: "Connected" }),
    );
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
    const onEvent = vi.fn();
    const server = await boot({ onEvent });
    const stale = new WsClient(`${server.wsUrl}?pid=a-process-that-is-gone`);
    const code = await new Promise<number>((resolve) => {
      stale.on("close", (closeCode) => resolve(closeCode));
    });
    expect(code).toBe(STALE_PROCESS_CLOSE_CODE);
    expect(onEvent).toHaveBeenCalledWith({
      _tag: "StaleTab",
      claimedPid: "a-process-that-is-gone",
      url: expect.any(URL),
    });
    // The gate is in FRONT of the accept: a rejected tab is never narrated as a
    // connection, because it never became one.
    expect(onEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ _tag: "Connected" }),
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
    // The SAME harness, so the six required options and the three-step teardown
    // are spelled once — `boot` re-raises the typed failure as a rejection, and
    // `SurfaceAppListenFailed` being an `Error` is exactly what makes that legal.
    const failure = await boot({ port }).catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(SurfaceAppListenFailed);
    // The `cause` is carried verbatim, which is what lets a consumer write a
    // port policy against `EADDRINUSE` instead of matching on a message string.
    const listenFailed = failure as SurfaceAppListenFailed;
    expect(listenFailed.cause).toMatchObject({ code: "EADDRINUSE" });
    expect(listenFailed.message).toContain(`127.0.0.1:${port}`);
  });

  it("closing the scope RELEASES each connection's serving stack, not just its socket", async () => {
    // The listener owns ACCEPTANCE, so it owns RELEASE. A `SurfaceSocketServing`
    // holds this connection's RPC fibers and every in-flight subscription it
    // opened; terminating the raw socket and awaiting nothing would resolve the
    // finalizer while those releases were still running. A per-connection layer
    // finalizer is the observable proof: it runs inside the serving stack's own
    // scope, and it has run by the time teardown resolves.
    const released: string[] = [];
    const server = await boot({
      services: () =>
        Layer.effect(Viewer)(
          Effect.acquireRelease(Effect.succeed({ seen: "live" }), () =>
            Effect.sync(() => {
              released.push("released");
            }),
          ),
        ),
    });
    const socket = await dial(server);
    await Effect.runPromise(
      socket.link.dispatch.unary("surface/viewer/seen", {}),
    );
    expect(released).toEqual([]);

    await server.teardown();
    expect(released).toEqual(["released"]);
    await socket.dispose();
  });

  it("stops ACCEPTING before the drain, so nothing is built mid-teardown", async () => {
    // The defect this pins: `acceptor.stop()` only clears the heartbeat interval
    // — it does NOT stop accepting. `await`ing the drain then yields the event
    // loop with the listener still live, so an upgrade landing in that window
    // built a whole serving stack AFTER the `[...servings]` snapshot and was
    // never awaited — reintroducing exactly what the drain exists to prevent.
    const connected: URL[] = [];
    const server = await boot({
      onEvent: (event) => {
        if (event._tag === "Connected") connected.push(event.connection.url);
      },
      services: () =>
        Layer.effect(Viewer)(
          Effect.acquireRelease(Effect.succeed({ seen: "live" }), () =>
            // A SLOW release, so the drain is a real window rather than an
            // instant — the window is the whole subject of this test.
            Effect.promise(
              () => new Promise<void>((resolve) => setTimeout(resolve, 500)),
            ),
          ),
        ),
    });
    const socket = await dial(server);
    await Effect.runPromise(
      socket.link.dispatch.unary("surface/viewer/seen", {}),
    );
    expect(connected).toHaveLength(1);

    const torndown = server.teardown();
    // Comfortably inside the drain: teardown has begun and cannot have finished.
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    const late = new WsClient(server.wsUrl);
    const refused = await new Promise<boolean>((resolve) => {
      late.on("error", () => resolve(true));
      late.on("open", () => resolve(false));
    });
    await torndown;

    // The listening socket was already closed, so the late dial never reached an
    // upgrade at all…
    expect(refused).toBe(true);
    // …and no second serving stack was built behind the drain's back.
    expect(connected).toHaveLength(1);
    await socket.dispose();
  }, 20_000);

  it("closing the scope DROPS a live connection and frees the port", async () => {
    const server = await boot();
    const socket = await dial(server);
    // A live websocket AND a keep-alive HTTP connection — the two a browser
    // holds, and the two that used to make `server.close()` hang forever.
    await fetch(`${server.url}/`);
    const port = Number(new URL(server.url).port);

    await server.teardown();

    // The port is free: a second server binds it, which it could not do while
    // anything was still listening.
    const again = await boot({ port });
    expect(Number(new URL(again.url).port)).toBe(port);
    await socket.dispose();
  });
});
