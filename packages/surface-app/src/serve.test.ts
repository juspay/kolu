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
import { get as httpsGet } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  exceedsFrameLimit,
  isFrameTooLargeClose,
  RPC_MAX_FRAME_BYTES,
} from "@kolu/surface/frame-limit";
import { surfaceProcessId } from "@kolu/surface/identity";
import { defineSurface } from "@kolu/surface/define";
import { exposeFace } from "@kolu/surface/expose";
import { implementSurface } from "@kolu/surface/server";
import { Cause, Context, Effect, Exit, Layer, Schema, Scope } from "effect";
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";
import { generate as generateSelfSigned } from "selfsigned";
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
  type SurfaceAppConnection,
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
 *  runtime passthrough — the whole reason `services` is generic. Generic in `H`
 *  for the same reason and one more: TypeScript infers no type argument
 *  partially, so a harness that pinned `serveSurfaceApp<Svc>` would hand every
 *  test the DEFAULT `H` and no test would ever reach the allowlist through the
 *  inference a consumer actually uses. */
async function boot<Svc = never, H extends string = never>(
  overrides: Partial<ServeSurfaceAppOptions<Svc, H>> = {},
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
    serveSurfaceApp<Svc, H>({
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

/** A throwaway certificate for `localhost` + `127.0.0.1`. Generated rather than
 *  committed: the TLS claims below are only worth anything against a REAL
 *  handshake, and a checked-in cert expires. `cA: true` because the clients
 *  below TRUST this cert as their certificate authority — see {@link httpsText}.
 *  The SAN entries are what make `https://127.0.0.1:<port>` verify, since that
 *  is the address the OS-chosen bind actually lands on. */
async function selfSignedTls(): Promise<{ key: string; cert: string }> {
  const pems = await generateSelfSigned(
    [{ name: "commonName", value: "localhost" }],
    {
      algorithm: "sha256",
      extensions: [
        { name: "basicConstraints", cA: true },
        {
          name: "subjectAltName",
          altNames: [
            { type: 2, value: "localhost" },
            { type: 7, ip: "127.0.0.1" },
          ],
        },
      ],
    },
  );
  return { key: pems.private, cert: pems.cert };
}

/** `GET` over TLS, with the throwaway cert supplied as the trusted CA. Node's
 *  global `fetch` has no seam for a per-request trust store, so this is
 *  `node:https` directly.
 *
 *  `ca` and NOT `rejectUnauthorized: false`: the two are not interchangeable
 *  here. Disabling verification would make the test pass against ANY
 *  certificate — including none of ours — which is exactly the assertion this
 *  test is trying to make. Trusting THIS cert keeps the handshake fully
 *  verified (chain, validity and hostname), so the test proves the listener is
 *  serving the material it was handed. */
function httpsText(
  url: string,
  ca: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    httpsGet(url, { ca }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        body += chunk;
      });
      response.on("end", () =>
        resolve({ status: response.statusCode ?? 0, body }),
      );
    }).on("error", reject);
  });
}

/** A real dial at the served surface, over a real `ws` client socket. */
async function dial(
  server: Booted,
  url = server.wsUrl,
  /** Request headers to stamp on the UPGRADE — what a reverse proxy in front of
   *  the listener writes. A browser cannot set them, which is the whole reason
   *  they are worth anything when the proxy is the only way in. */
  headers?: Record<string, string>,
) {
  const socket = await createSurfaceSocket({
    group: server.runtime.group,
    url,
    retired: () => {},
    connect: (target) =>
      new WsClient(
        target,
        headers === undefined ? undefined : { headers },
      ) as unknown as WebSocket,
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

  it("numbers each connection, and says HOW its socket closed", async () => {
    // Both facts kolu's per-connection log lines are built from: the `ws:` field
    // that correlates a connect with its disconnect, and the close code that
    // tells an abrupt drop apart from a frame-cap 1009 or a deliberate goodbye.
    const events: SurfaceAppEvent[] = [];
    const server = await boot({ onEvent: (event) => events.push(event) });
    // A RAW socket, so the close is ours to spell — a surface client's own
    // `dispose` picks the code, and there would be nothing to assert about.
    const first = new WsClient(server.wsUrl);
    await new Promise<void>((resolve, reject) => {
      first.on("open", () => resolve());
      first.on("error", reject);
    });
    first.close(4001, "goodbye");
    await vi.waitFor(() => expect(events).toHaveLength(2));
    expect(events[0]).toMatchObject({
      _tag: "Connected",
      connection: { id: 1 },
    });
    expect(events[1]).toMatchObject({
      _tag: "Disconnected",
      connection: { id: 1 },
      code: 4001,
      reason: "goodbye",
    });

    // The next connection is the next ordinal — not a reused 1, and not global.
    const second = await dial(server);
    await Effect.runPromise(
      second.link.dispatch.unary("surface/echo/length", { text: "2" }),
    );
    expect(events[2]).toMatchObject({
      _tag: "Connected",
      connection: { id: 2 },
    });
    await second.dispose();
  });
});

describe("serveSurfaceApp — the upgrade facts a connection carries", () => {
  /** Read whatever `pick` makes of the accepted connection back out through a
   *  real dispatch, so every claim below is about what a HANDLER sees — not
   *  about an object a test built. JSON, because the facts under test are a
   *  record and `Viewer` carries one string. */
  const readConnection = async <H extends string = never>(
    pick: (connection: SurfaceAppConnection<H>) => unknown,
    options: Partial<ServeSurfaceAppOptions<Viewer, H>> = {},
    headers?: Record<string, string>,
  ): Promise<unknown> => {
    const server = await boot<Viewer, H>({
      ...options,
      services: (connection) =>
        Layer.succeed(Viewer)({ seen: JSON.stringify(pick(connection)) }),
    });
    const socket = await dial(server, server.wsUrl, headers);
    const answer = await Effect.runPromise(
      socket.link.dispatch.unary("surface/viewer/seen", {}),
    );
    await socket.dispose();
    return JSON.parse((answer as { seen: string }).seen);
  };

  it("carries the headers the app NAMED, under the app's own spelling — and no others", async () => {
    // The whole claim in one assertion, because the interesting half is what is
    // ABSENT: `cookie` and `authorization` were sent on this very upgrade and
    // are not named, so the context cannot see them. A name with no header
    // behind it contributes no key at all rather than an `undefined` a consumer
    // would have to tell apart from an empty value.
    await expect(
      readConnection(
        (connection) => connection.headers,
        { upgradeHeaders: ["Tailscale-User-Login", "Tailscale-User-Name"] },
        {
          "Tailscale-User-Login": "ada@example.com",
          Cookie: "session=hunter2",
          Authorization: "Bearer hunter2",
        },
      ),
    ).resolves.toEqual({ "Tailscale-User-Login": "ada@example.com" });
  });

  it("names no headers by DEFAULT — the whole bag is never the fallback", async () => {
    await expect(
      readConnection(
        (connection) => connection.headers,
        {},
        {
          "Tailscale-User-Login": "ada@example.com",
          Cookie: "session=hunter2",
        },
      ),
    ).resolves.toEqual({});
  });

  it("matches a name case-insensitively, and keeps an EMPTY value as a value", async () => {
    // HTTP field names are case-insensitive and node lowercases what arrives, so
    // an app that spells a name the way its proxy documents it must still be
    // answered. And a header the proxy sent EMPTY is present-and-empty, not
    // absent: a seam that reports what a request carried must not invent a value
    // it did not receive, and an app that treats "sent, but blank" as a reason
    // to distrust a proxy claim has to be able to see it.
    await expect(
      readConnection(
        (connection) => connection.headers,
        { upgradeHeaders: ["x-forwarded-for", "X-Empty"] },
        { "X-Forwarded-For": "10.0.0.1", "x-empty": "" },
      ),
    ).resolves.toEqual({ "x-forwarded-for": "10.0.0.1", "X-Empty": "" });
  });

  it("keeps a name that collides with Object.prototype honest, both ways", async () => {
    // `constructor` and `__proto__` are valid HTTP field names and are ALREADY
    // lowercase, so they survive the fold onto node's own keys. On a plain `{}`
    // the first would answer with `Object`'s constructor for a header nobody
    // sent, and assigning the second would hit the setter and store nothing.
    // Both are read through `Object.hasOwn` onto a null-prototype record, so
    // an unsent one is absent and a sent one is its value.
    await expect(
      readConnection(
        (connection) => connection.headers,
        { upgradeHeaders: ["constructor", "__proto__"] },
        { __proto__: "sent" },
      ),
    ).resolves.toEqual({ __proto__: "sent" });
  });

  it("makes a read the allowlist does not name a COMPILE error, not a silent undefined", async () => {
    // The other half of the serve-time check: a name outside the grammar takes
    // the bind down, and a name outside the ALLOWLIST does not compile. Both
    // close the same failure — a header read that answers `undefined` forever
    // and looks exactly like an honest "the proxy did not send it".
    //
    // Read off the connection a REAL `serveSurfaceApp` hands a REAL `services`
    // callback, so what is under test is the path a consumer is actually on:
    // `H` inferred from `upgradeHeaders` one object literal over, while `Svc`
    // is being inferred in the same breath. A connection this test annotated
    // for itself would prove the guarantee about its own annotation.
    //
    // The `@ts-expect-error`s ARE the assertion — `just check` fails the moment
    // either bad read starts compiling. The runtime expectation keeps the good
    // read live: `undefined` does not survive `JSON.stringify`, so the two bad
    // ones contribute no key.
    await expect(
      readConnection(
        (connection) => ({
          right: connection.headers["x-forwarded-for"],
          // @ts-expect-error — not in the allowlist `H` was inferred from.
          wrongCase: connection.headers["X-Forwarded-For"],
          // @ts-expect-error — a plain typo, the same way.
          typo: connection.headers["x-forwarded-fro"],
        }),
        { upgradeHeaders: ["x-forwarded-for"] },
        { "X-Forwarded-For": "10.0.0.1" },
      ),
    ).resolves.toEqual({ right: "10.0.0.1" });
  });

  it("carries the direct peer's address — the fact a proxy header is weighed against", async () => {
    // kolu's `viewerAddress`. Loopback, since that is where `boot` binds; the
    // point is that it IS the socket's peer and not a guess.
    await expect(
      readConnection((connection) => connection.remoteAddress),
    ).resolves.toMatch(/^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/);
  });

  it("refuses to bind on a name that is not an HTTP field name", async () => {
    // A name no header can ever match would read to the app as "the proxy never
    // sends it" — a silent, permanent absence. It takes the bind down instead.
    await expect(
      boot({ upgradeHeaders: ["X-Ok", "not a name"] }),
    ).rejects.toThrow(/"not a name" is not an HTTP header name/);
  });
});

describe("serveSurfaceApp — the shell it serves", () => {
  it("serves the manifest with NO built bundle, and answers no shell at all", async () => {
    // The dev shape, and the one that used to force kolu to hand-compose the two
    // granular layers: the manifest is served UNCONDITIONALLY (a dev proxy
    // forwards `/manifest.webmanifest` here) while the statics wait for a build.
    const server = await boot({
      clientDist: undefined,
      manifest: { name: "dev shell", icons: [] },
    });

    const manifest = await fetch(`${server.url}/manifest.webmanifest`);
    expect(manifest.status).toBe(200);
    expect(manifest.headers.get("content-type")).toContain(
      "application/manifest+json",
    );
    expect(((await manifest.json()) as { name: string }).name).toBe(
      "dev shell",
    );

    // A missing dist is NO route, never a degraded one: an unmatched path 404s
    // through the router rather than answering some placeholder shell.
    expect((await fetch(`${server.url}/`)).status).toBe(404);

    // …and the surface is served regardless. The websocket leg does not wait on
    // a bundle, which is exactly what makes `just dev` work.
    const socket = await dial(server);
    expect(
      await Effect.runPromise(
        socket.link.dispatch.unary("surface/echo/length", { text: "dev" }),
      ),
    ).toEqual({ length: 3 });
    await socket.dispose();
  });

  it("wraps every HTTP request in the app's middleware — and never the websocket", async () => {
    // What a middleware is FOR at this seam: kolu's bridge from the serving
    // stack to pino. It wraps the whole HANDLED pipeline — the response bytes are
    // already on the wire by the time it sees an outcome, which is why kolu's own
    // two halves log and re-raise rather than rewrite — so what it observes, and
    // what it does NOT, is the whole contract.
    //
    // Recorded on the way IN, deliberately. An outcome-side `Effect.map` would
    // see only the SUCCESS channel, and the SPA shell does not reliably arrive
    // there: `GET /` intermittently comes back as a Fail CARRYING its own
    // fully-formed `HttpServerResponse` (the index.html file stream), which is
    // load-dependent — see `packages/server/src/httpMiddleware.ts`, where the
    // same fact is the reason `routeErrorLogging` inspects the cause instead of
    // treating every failure as a fault. A first draft of this test asserted on
    // the outcome, passed on an idle machine and on darwin, and failed on the
    // busy linux CI box. Entry is the channel-independent observation, and it is
    // also the one kolu's own request log is written from.
    const seen: string[] = [];
    const server = await boot({
      routes: HttpRouter.add("GET", "/mcp", HttpServerResponse.text("ok")),
      middleware: (httpApp) =>
        Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) => {
          seen.push(request.url);
          return httpApp;
        }),
    });

    // Both halves of what the handler serves — the SHELL and the app's own
    // routes — go through the one middleware, because it wraps the merged app
    // rather than either layer.
    await fetch(`${server.url}/`);
    await fetch(`${server.url}/mcp`);
    expect(seen).toEqual(["/", "/mcp"]);

    // The upgrade never reaches the request handler — it is answered off the
    // `upgrade` event this module owns, which is why `middleware` is an HTTP-leg
    // option and not a listener-wide one.
    const socket = await dial(server);
    await Effect.runPromise(
      socket.link.dispatch.unary("surface/echo/length", { text: "ws" }),
    );
    expect(seen).toHaveLength(2);
    await socket.dispose();
  });
});

describe("serveSurfaceApp — TLS", () => {
  it("serves HTTPS when handed TLS material, and says so in the URL it returns", async () => {
    const tls = await selfSignedTls();
    const server = await boot({ tls });
    // The returned URL is what an operator is told to open, so the scheme has to
    // be the one the listener actually speaks.
    expect(server.url.startsWith("https://")).toBe(true);

    // A FULLY VERIFIED handshake (see `httpsText`), so this passing means the
    // listener really served the cert it was handed.
    const shell = await httpsText(`${server.url}/`, tls.cert);
    expect(shell.status).toBe(200);
    expect(shell.body).toContain("<title>shell</title>");

    // And the surface rides the SAME server, so it is `wss://` — derived by
    // `surfaceWsUrl` off the returned URL, exactly as a browser derives it.
    expect(server.wsUrl.startsWith("wss://")).toBe(true);
    const socket = await createSurfaceSocket({
      group: server.runtime.group,
      url: server.wsUrl,
      retired: () => {},
      connect: (target) =>
        // Same trust decision as above, and for the same reason: the cert is
        // trusted, verification is not switched off.
        new WsClient(target, { ca: tls.cert }) as unknown as WebSocket,
    });
    expect(
      await Effect.runPromise(
        socket.link.dispatch.unary("surface/echo/length", { text: "tls" }),
      ),
    ).toEqual({ length: 3 });
    await socket.dispose();
  }, 20_000);
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
    //
    // The guard is the listener's OWN `draining` flag, not `server.close()`
    // having been called early: the close moved to the very end of teardown (it
    // hangs under bun if a socket was open when it was requested), so the
    // listening socket is still up throughout this window and the upgrade has to
    // be refused by us. That is why the assertion below is "the dial never
    // became a connection", which holds either way, rather than "the TCP connect
    // was refused", which would only have held under the old order.
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

    // The upgrade was refused — `draining` destroys the raw socket, so the dial
    // errors instead of opening…
    expect(refused).toBe(true);
    // …and no second serving stack was built behind the drain's back, which is
    // the claim that survives whichever way the listening socket is closed.
    expect(connected).toHaveLength(1);
    await socket.dispose();
  }, 20_000);

  it("closes the listening socket LAST, with nothing left for it to wait on", async () => {
    // The bun hang, pinned by its MECHANISM rather than its symptom. Bun's
    // `server.close` callback never fires when a socket was open at the moment
    // close was requested, so a finalizer that registered the close FIRST — as
    // this one did, to lean on node stopping accepting synchronously — never
    // settled: the runtime never unwound and a SIGINT'd process never exited.
    // Node settles either way, so no node test can observe the HANG; what it can
    // observe is the ordering that makes the hang impossible.
    //
    // The port is that observation, and it is deterministic (a bind either
    // succeeds or does not — no delivery race): mid-drain the listening socket
    // must still be BOUND. Under the old order it was already closed by then, so
    // this second bind would have succeeded.
    const server = await boot({
      services: () =>
        Layer.effect(Viewer)(
          Effect.acquireRelease(Effect.succeed({ seen: "live" }), () =>
            // A slow release, so the drain is a real window to look inside.
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
    const port = Number(new URL(server.url).port);

    const torndown = server.teardown();
    // Comfortably inside the drain: teardown has begun and cannot have finished.
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    const midDrain = await boot({ port }).catch((cause: unknown) => cause);
    expect(midDrain).toBeInstanceOf(SurfaceAppListenFailed);

    await torndown;
    // …and released by the time teardown resolves, which is the other half: last
    // is not "never".
    const after = await boot({ port });
    expect(Number(new URL(after.url).port)).toBe(port);
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

describe("serveSurfaceApp — this face's expose", () => {
  it("serves what the map names and refuses what it does not, over a real socket", async () => {
    // The browser face gets `echo.length` and nothing else. `viewer.seen` stays
    // for a trusted face — the whole point of a PER-FACE map (juspay/kolu#2169).
    const server = await boot<Viewer>({
      expose: exposeFace(testSurface, { "echo.length": "tool" }),
      services: () => Layer.succeed(Viewer)({ seen: "10.0.0.1" }),
    });
    const socket = await dial(server);

    await expect(
      Effect.runPromise(
        socket.link.dispatch.unary("surface/echo/length", { text: "hello" }),
      ),
    ).resolves.toEqual({ length: 5 });

    const exit = await Effect.runPromise(
      Effect.exit(socket.link.dispatch.unary("surface/viewer/seen", {})),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.pretty(exit.cause)).toContain(
        '"surface/viewer/seen" is not exposed on this face',
      );
    }

    // The refusal is ONE request's answer: the connection is still serving.
    await expect(
      Effect.runPromise(
        socket.link.dispatch.unary("surface/echo/length", { text: "again" }),
      ),
    ).resolves.toEqual({ length: 5 });
    await socket.dispose();
  });

  it("refuses to bind on an exposure that does not describe the served surface", async () => {
    // A gate that silently matches nothing denies EVERYTHING and the listener
    // still binds — the one failure mode that looks like success from outside —
    // so a mismatch has to take the bind down with it.
    const other = defineSurface({
      procedures: { other: { ping: { output: Schema.String } } },
    });
    await expect(
      boot({ expose: exposeFace(other, { "other.ping": "tool" }) }),
    ).rejects.toThrow(
      /built from a different surface than the group being served/,
    );
  });

  it("keeps the reserved system members reachable on a gated face", async () => {
    // A client's watchdog rides `system/live`; gating it off would not restrict
    // the face, it would make every client reconnect forever.
    const server = await boot({ expose: exposeFace(testSurface, {}) });
    const socket = await dial(server);
    await expect(
      Effect.runPromise(socket.link.dispatch.unary("surface/system/live", {})),
    ).resolves.toEqual({});
    await socket.dispose();
  });
});
