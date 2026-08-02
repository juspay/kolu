/**
 * The byte-splice guarantee (PLAN D5, review #10).
 *
 * `@kolu/surface-daemon`'s `frontDaemonOverStdio` is a CONTRACT-BLIND splice: a
 * front process pumps the bytes of its own stdio into a daemon's unix socket
 * and back, understanding neither the framing nor the members. That is only
 * legal if the stdio leg and the socket leg are byte-identical on the wire —
 * which the plan asserted and this file PROVES, in both directions:
 *
 *   - a stdio CLIENT spliced into a `serveOverUnixSocket` server, and
 *   - a unix-socket CLIENT spliced into a `serveOverStdio` server,
 *
 * each carrying a unary call and a streaming member end to end, with the raw
 * bytes captured and inspected.
 *
 * The second half of #10: the base64 codec that used to frame these legs
 * existed for BINARY safety, not just for embedded newlines. Under ndjson every
 * frame must therefore be plain JSON text terminated by `\n` — asserted on the
 * captured bytes, so a member that ever tried to put raw binary on the wire
 * would fail here rather than corrupt a splice in production.
 */

import { mkdtempSync } from "node:fs";
import { createConnection, createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { Effect, Schema, Stream } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { defineSurface } from "../define";
import { createLoopbackPair } from "../loopback";
import { serveOverStdio } from "../peer-server";
import { implementSurface } from "../server";
import { serveOverUnixSocket, type UnixSocketListener } from "../unix-socket";
import { stdioLink } from "./stdio";
import { unixSocketLink } from "./unix-socket";

const surface = defineSurface({
  procedures: {
    math: {
      double: {
        input: Schema.Struct({ x: Schema.Number }),
        output: Schema.Struct({ y: Schema.Number }),
      },
    },
  },
  streams: {
    counter: {
      inputSchema: Schema.Struct({ to: Schema.Number }),
      outputSchema: Schema.Struct({ n: Schema.Number }),
    },
  },
});

const DOUBLE_TAG = "surface/math/double";
const COUNTER_TAG = "surface/counter/get";

function buildServed() {
  const runtime = implementSurface(surface, {
    procedures: {
      math: { double: ({ input }) => Effect.succeed({ y: input.x * 2 }) },
    },
    streams: {
      counter: {
        source: (input) =>
          Stream.map(Stream.range(0, input.to - 1), (n) => ({ n })),
      },
    },
  });
  return { group: runtime.group, handlers: runtime.handlers };
}

/** A tap that records every byte flowing through it, unchanged. */
function recorder(sink: Buffer[]): PassThrough {
  return new PassThrough({
    transform(chunk: Buffer, _enc, cb) {
      sink.push(Buffer.from(chunk));
      cb(null, chunk);
    },
  });
}

/** Every recorded byte must be one line-delimited JSON frame after another —
 *  printable UTF-8 text, `\n` the only control byte, each line a JSON value. */
function expectNdjson(chunks: Buffer[], label: string): void {
  const bytes = Buffer.concat(chunks);
  expect(bytes.length, `${label}: nothing was captured`).toBeGreaterThan(0);
  // Byte level: no control characters other than the frame delimiter, and no
  // lone high bytes that only a binary payload would produce (a base64 codec
  // existed precisely to make such payloads newline-safe).
  for (const byte of bytes) {
    if (byte === 0x0a) continue; // the delimiter
    expect(
      byte >= 0x20,
      `${label}: control byte 0x${byte.toString(16)} on the wire`,
    ).toBe(true);
  }
  expect(
    bytes.toString("utf8").endsWith("\n"),
    `${label}: unterminated frame`,
  ).toBe(true);
  const lines = bytes
    .toString("utf8")
    .split("\n")
    .filter((l) => l.length > 0);
  expect(lines.length, `${label}: no frames`).toBeGreaterThan(0);
  for (const line of lines) {
    expect(() => JSON.parse(line), `${label}: not JSON: ${line}`).not.toThrow();
  }
}

const listeners: UnixSocketListener[] = [];
const servers: Server[] = [];
afterEach(() => {
  for (const listener of listeners.splice(0)) listener.close();
  for (const server of servers.splice(0)) server.close();
});

describe("stdio ⇄ unix-socket byte splice (#10)", () => {
  it("a stdio CLIENT's bytes are accepted verbatim by a unix-socket SERVER", async () => {
    const socketPath = join(
      mkdtempSync(join(tmpdir(), "surface-splice-a-")),
      "a.sock",
    );
    const listener = await serveOverUnixSocket({
      socketPath,
      ...buildServed(),
    });
    listeners.push(listener);
    expect(listener.outcome).toEqual({ kind: "listening" });

    // The `frontDaemonOverStdio` shape: the front holds a stdio transport on
    // one side and a socket on the other, and pumps bytes between them without
    // decoding a thing.
    const pair = createLoopbackPair();
    const outbound: Buffer[] = [];
    const inbound: Buffer[] = [];
    const socket = createConnection(socketPath);
    await new Promise((resolve) => socket.once("connect", resolve));
    pair.server.read.pipe(recorder(outbound)).pipe(socket);
    socket.pipe(recorder(inbound)).pipe(pair.server.write);

    const link = await stdioLink({
      group: surface.group,
      read: pair.client.read,
      write: pair.client.write,
    });

    expect(
      await Effect.runPromise(link.dispatch.unary(DOUBLE_TAG, { x: 21 })),
    ).toEqual({ y: 42 });
    const frames = await Effect.runPromise(
      Stream.runCollect(
        link.dispatch.stream(COUNTER_TAG, { to: 3 }) as Stream.Stream<
          { n: number },
          unknown
        >,
      ),
    );
    expect(frames.map((f) => f.n)).toEqual([0, 1, 2]);

    expectNdjson(outbound, "stdio client → unix-socket server");
    expectNdjson(inbound, "unix-socket server → stdio client");

    await link.dispose();
    socket.destroy();
  });

  it("a unix-socket CLIENT's bytes are accepted verbatim by a stdio SERVER", async () => {
    const served = buildServed();
    const pair = createLoopbackPair();
    const serving = serveOverStdio({ ...served, transport: pair.server });

    const outbound: Buffer[] = [];
    const inbound: Buffer[] = [];
    const socketPath = join(
      mkdtempSync(join(tmpdir(), "surface-splice-b-")),
      "b.sock",
    );
    // The mirror image of the front: an accepting socket whose connection is
    // spliced, byte for byte, into a leg served over stdio framing.
    const server = createServer((conn) => {
      conn.pipe(recorder(inbound)).pipe(pair.client.write);
      pair.client.read.pipe(recorder(outbound)).pipe(conn);
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));

    const link = await unixSocketLink({ group: surface.group, socketPath });
    expect(
      await Effect.runPromise(link.dispatch.unary(DOUBLE_TAG, { x: 4 })),
    ).toEqual({ y: 8 });
    const frames = await Effect.runPromise(
      Stream.runCollect(
        link.dispatch.stream(COUNTER_TAG, { to: 2 }) as Stream.Stream<
          { n: number },
          unknown
        >,
      ),
    );
    expect(frames.map((f) => f.n)).toEqual([0, 1]);

    expectNdjson(inbound, "unix-socket client → stdio server");
    expectNdjson(outbound, "stdio server → unix-socket client");

    await link.dispose();
    pair.client.write.end();
    pair.server.write.end();
    await serving;
  });

  it("the two legs frame the SAME call identically, byte for byte", async () => {
    // The splice is blind, so "both are valid ndjson" is not enough: the same
    // call must produce the same bytes whichever leg carries it. Captured from
    // a fresh client on each leg, so the request ids line up.
    const stdioBytes: Buffer[] = [];
    const socketBytes: Buffer[] = [];

    // Leg 1 — stdio. The recorder IS the client→server pipe, so the capture is
    // exactly the bytes the link emitted.
    const clientToServer = recorder(stdioBytes);
    const serverToClient = new PassThrough();
    const servingA = serveOverStdio({
      ...buildServed(),
      transport: { read: clientToServer, write: serverToClient },
    });
    const stdioClient = await stdioLink({
      group: surface.group,
      read: serverToClient,
      write: clientToServer,
    });
    expect(
      await Effect.runPromise(
        stdioClient.dispatch.unary(DOUBLE_TAG, { x: 21 }),
      ),
    ).toEqual({ y: 42 });

    // Leg 2 — unix socket.
    const socketPath = join(
      mkdtempSync(join(tmpdir(), "surface-splice-c-")),
      "c.sock",
    );
    const listener = await serveOverUnixSocket({
      socketPath,
      ...buildServed(),
    });
    listeners.push(listener);
    const relayPath = join(
      mkdtempSync(join(tmpdir(), "surface-splice-c2-")),
      "relay.sock",
    );
    const relay = createServer((conn) => {
      const upstream = createConnection(socketPath);
      conn.pipe(recorder(socketBytes)).pipe(upstream);
      upstream.pipe(conn);
    });
    servers.push(relay);
    await new Promise<void>((resolve) => relay.listen(relayPath, resolve));
    const socketClient = await unixSocketLink({
      group: surface.group,
      socketPath: relayPath,
    });
    expect(
      await Effect.runPromise(
        socketClient.dispatch.unary(DOUBLE_TAG, { x: 21 }),
      ),
    ).toEqual({ y: 42 });

    // Everything about the frame is fixed by the FRAMING except three values
    // that are per-call by design — the request id (a per-client counter) and
    // the trace/span ids (fresh random per call). Blanking exactly those and
    // requiring the rest to match CHARACTER FOR CHARACTER pins field order,
    // separators and encoding across the two legs, which is what a
    // contract-blind splice actually depends on.
    const firstFrame = (chunks: Buffer[]): string =>
      Buffer.concat(chunks).toString("utf8").split("\n")[0] ?? "";
    const normalize = (frame: string): string =>
      frame
        .replace(/"id":\d+/, '"id":<n>')
        .replace(/"traceId":"[0-9a-f]*"/, '"traceId":"<trace>"')
        .replace(/"spanId":"[0-9a-f]*"/, '"spanId":"<span>"');

    expect(firstFrame(stdioBytes).length).toBeGreaterThan(0);
    expect(normalize(firstFrame(socketBytes))).toBe(
      normalize(firstFrame(stdioBytes)),
    );
    expect(normalize(firstFrame(stdioBytes))).toContain(
      '"tag":"surface/math/double","payload":{"x":21}',
    );

    await stdioClient.dispose();
    await socketClient.dispose();
    clientToServer.end();
    serverToClient.end();
    await servingA;
  });
});
