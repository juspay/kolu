/** The fold envelope must not depend on any validator's missing-key leniency, and its
 *  BYTES must be exactly `{"mapKey":…}` / `{"mapKey":…,"input":…}`.
 *
 *  A void-input member's call folds to `{ mapKey }` — NO `input` key. The old zod
 *  schema `z.object({ mapKey, input: z.void() })` only accepted that because zod
 *  <=4.3.6 treated a MISSING key as satisfying `z.void()`; zod >=4.3.7 REJECTS it
 *  ("expected nonoptional"), which silently broke every void-input fold over a real
 *  socket the moment a consumer's lockfile drifted onto a later zod patch (the drishti
 *  fleet incident). Effect Schema is stricter still: `Schema.Struct({ input:
 *  Schema.Void })` demands the key outright, so the same call would now fail on EVERY
 *  version rather than on a patch bump. The fix is unchanged and version-independent:
 *  a void member's schema declares NO `input` field, so its absence can never be
 *  rejected.
 *
 *  These pins hold that invariant at three levels:
 *    1. the encoder (`fold`) omits the field;
 *    2. the schema (`foldInput`) has no `input` field to reject its absence, and a
 *       `Schema.Void`/`Schema.Undefined` inner collapses onto the same schema;
 *    3. the BYTES on a real ndjson wire (the serializer the whole stack is pinned to —
 *       `RpcSerialization.layerNdjson`) carry `"payload":{"mapKey":"a"}` with no
 *       `input` key at all, and the with-input case carries it nested.
 *
 *  Level 3 is the one that would have caught the drishti incident: it reads the frame
 *  the socket actually emitted, not a schema's opinion about it. It replaces the old
 *  `StandardRPCSerializer` round-trip (the single most oRPC-specific test in the tree)
 *  with the same assertion made one layer lower — on raw bytes rather than on a
 *  serializer's in-memory output.
 */

import { PassThrough } from "node:stream";
import { defineSurface, surfaceTag } from "@kolu/surface/define";
import { directDispatch } from "@kolu/surface/links/direct";
import {
  awaitStdioReadiness,
  writeStdioReadiness,
} from "@kolu/surface/links/readiness";
import { stdioLink } from "@kolu/surface/links/stdio";
import { serveOverStdio } from "@kolu/surface/peer-server";
import { implementSurface, inMemoryStore } from "@kolu/surface/server";
import { Effect, Schema, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { foldInput } from "./define";
import {
  fold,
  INPUT_FIELD,
  MAP_KEY_FIELD,
  unfoldInput,
  unfoldKeyField,
} from "./envelope";
import {
  buildTestMap,
  connected,
  HostKeySchema,
  identityCodec,
  makeRegistry,
} from "./mapHarness.testlib";
import { serveSurfaceMap } from "./server";

const decodes = (schema: ReturnType<typeof foldInput>, value: unknown) =>
  Schema.decodeUnknownExit(schema)(value)._tag === "Success";

const KEY = Schema.decodeUnknownSync(HostKeySchema)("a");

describe("fold envelope — a void member carries no input key, by construction", () => {
  it("fold(mapKey, undefined) emits NO input key; a real input keeps it", () => {
    const voidFrame = fold("remote:B", undefined) as Record<string, unknown>;
    expect(INPUT_FIELD in voidFrame).toBe(false);
    expect(voidFrame[MAP_KEY_FIELD]).toBe("remote:B");

    const inputFrame = fold("remote:B", { key: "k" }) as Record<
      string,
      unknown
    >;
    expect(inputFrame[INPUT_FIELD]).toEqual({ key: "k" });
  });

  it("the void-member schema has NO Schema.Void field — a missing key can't be rejected", () => {
    // The FRAGILE shape, for contrast: a declared `input: Schema.Void` field REJECTS
    // the frame the wire actually delivers (the key absent). That is the failure mode
    // the omit-the-field design makes unspellable.
    const fragile = Schema.Struct({
      [MAP_KEY_FIELD]: Schema.String,
      [INPUT_FIELD]: Schema.Void,
    });
    expect(Schema.decodeUnknownExit(fragile)({ mapKey: "x" })._tag).toBe(
      "Failure",
    );

    // The real schema: no `input` field at all, so an absent key decodes.
    expect(decodes(foldInput(), { mapKey: "x" })).toBe(true);
    // Explicit Schema.Void / Schema.Undefined inners collapse onto the same schema.
    expect(decodes(foldInput(Schema.Void), { mapKey: "x" })).toBe(true);
    expect(decodes(foldInput(Schema.Undefined), { mapKey: "x" })).toBe(true);
    // A member WITH input still enforces its shape.
    const withInput = foldInput(Schema.Struct({ key: Schema.String }));
    expect(decodes(withInput, { mapKey: "x", input: { key: "k" } })).toBe(true);
    expect(decodes(withInput, { mapKey: "x", input: { key: 1 } })).toBe(false);
    expect(decodes(withInput, { mapKey: "x" })).toBe(false);
  });

  it("unfold reads the key and the exact input back out", () => {
    const voidWire = fold("remote:B", undefined);
    expect(unfoldKeyField(voidWire)).toBe("remote:B");
    expect(unfoldInput(voidWire)).toBeUndefined();
    const wire = fold("remote:B", { key: "k" });
    expect(unfoldKeyField(wire)).toBe("remote:B");
    expect(unfoldInput(wire)).toEqual({ key: "k" });
  });
});

// ── The BYTES on a real ndjson wire ───────────────────────────────────────────

function recorder(sink: Buffer[]): PassThrough {
  return new PassThrough({
    transform(chunk: Buffer, _enc, cb) {
      sink.push(Buffer.from(chunk));
      cb(null, chunk);
    },
  });
}

/** Every recorded client→server line, as parsed ndjson frames. */
function frames(chunks: Buffer[]): Array<Record<string, unknown>> {
  return Buffer.concat(chunks)
    .toString("utf8")
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

/** Assert every captured byte is printable-or-newline — the ndjson framing the whole
 *  stack is pinned to (a binary payload would corrupt a contract-blind byte splice). */
function expectNdjson(chunks: Buffer[]): void {
  for (const byte of Buffer.concat(chunks)) {
    if (byte === 0x0a) continue;
    expect(byte >= 0x20, `control byte 0x${byte.toString(16)}`).toBe(true);
  }
}

/** Serve a map over a real stdio wire and hand back the link + the recorded
 *  client→server bytes. */
async function serveMapOverWire(served: {
  group: ReturnType<typeof serveSurfaceMap>["group"];
  handlers: ReturnType<typeof serveSurfaceMap>["handlers"];
}) {
  const clientToServer: Buffer[] = [];
  const c2s = recorder(clientToServer);
  const s2c = new PassThrough();
  const serving = serveOverStdio({
    group: served.group,
    handlers: served.handlers,
    transport: { read: c2s, write: s2c },
  });
  // Greet on the server→client direction, which is NOT the recorded one: the
  // byte assertions below capture client→server, so the gate leaves them
  // untouched (juspay/kolu#2101).
  writeStdioReadiness(s2c, { verdict: "ready" });
  const link = await stdioLink({
    group: served.group,
    read: s2c,
    write: c2s,
    readiness: await awaitStdioReadiness({
      read: s2c,
      deadlineMs: 10_000,
      describe: "map stdio leg",
    }),
  });
  return {
    link,
    clientToServer,
    close: async () => {
      await link.dispose();
      c2s.end();
      s2c.end();
      await serving;
    },
  };
}

const unarySurface = defineSurface({
  procedures: {
    demo: {
      // NO declared input — the void member.
      ping: { output: Schema.String },
      echo: {
        input: Schema.Struct({ text: Schema.String }),
        output: Schema.String,
      },
    },
  },
});
const PING_TAG = surfaceTag(unarySurface.tagPrefix, "demo", "ping");
const ECHO_TAG = surfaceTag(unarySurface.tagPrefix, "demo", "echo");

const cellSurface = defineSurface({
  cells: { tick: { schema: Schema.Number, default: 0, verbs: ["get"] } },
});
const TICK_TAG = surfaceTag(cellSurface.tagPrefix, "tick", "get");

describe("fold envelope — the ndjson bytes a map call actually puts on the wire", () => {
  it('a void UNARY member frames payload {"mapKey":…} with NO input key; an input member nests it', async () => {
    const entry = implementSurface(unarySurface, {
      procedures: {
        demo: {
          ping: () => Effect.succeed("pong"),
          echo: ({ input }) => Effect.succeed(input.text.toUpperCase()),
        },
      },
    });
    const map = buildTestMap({
      key: HostKeySchema,
      entry: unarySurface,
      codec: identityCodec,
    });
    const reg = makeRegistry();
    const served = serveSurfaceMap(map, reg.registry);
    reg.addSession(KEY, directDispatch(entry), connected(0));

    const wire = await serveMapOverWire(served);

    expect(
      await Effect.runPromise(
        wire.link.dispatch.unary(PING_TAG, fold("a", undefined)),
      ),
    ).toBe("pong");
    expect(
      await Effect.runPromise(
        wire.link.dispatch.unary(ECHO_TAG, fold("a", { text: "hi" })),
      ),
    ).toBe("HI");

    const requests = frames(wire.clientToServer).filter(
      (f) => f._tag === "Request",
    );
    const ping = requests.find((f) => f.tag === PING_TAG);
    const echo = requests.find((f) => f.tag === ECHO_TAG);
    expect(ping, "no ping request frame captured").toBeDefined();
    expect(echo, "no echo request frame captured").toBeDefined();

    // BYTE-level: the void member's payload is literally `{"mapKey":"a"}` — no
    // `input` key, not even `"input":null`. This is the assertion the drishti fleet
    // incident needed and that no schema-level pin can make.
    expect(JSON.stringify(ping?.payload)).toBe('{"mapKey":"a"}');
    expect(JSON.stringify(echo?.payload)).toBe(
      '{"mapKey":"a","input":{"text":"hi"}}',
    );
    expectNdjson(wire.clientToServer);

    await wire.close();
    served.dispose();
  });

  it('a void STREAMING member frames the same {"mapKey":…} payload', async () => {
    const entry = implementSurface(cellSurface, {
      cells: { tick: { store: inMemoryStore(7) } },
    });
    const map = buildTestMap({
      key: HostKeySchema,
      entry: cellSurface,
      codec: identityCodec,
    });
    const reg = makeRegistry();
    const served = serveSurfaceMap(map, reg.registry);
    reg.addSession(KEY, directDispatch(entry), connected(0));

    const wire = await serveMapOverWire(served);

    const first = await Effect.runPromise(
      Stream.runCollect(
        Stream.take(
          wire.link.dispatch.stream(
            TICK_TAG,
            fold("a", undefined),
          ) as Stream.Stream<number, unknown>,
          1,
        ),
      ),
    );
    expect(first).toEqual([7]);

    const request = frames(wire.clientToServer).find(
      (f) => f._tag === "Request" && f.tag === TICK_TAG,
    );
    expect(JSON.stringify(request?.payload)).toBe('{"mapKey":"a"}');
    expectNdjson(wire.clientToServer);

    await wire.close();
    served.dispose();
  });
});
