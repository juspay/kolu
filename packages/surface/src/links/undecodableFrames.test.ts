/**
 * What a leg is told when the ndjson parser refuses a read: the classification
 * a host reads to name a dropped connection, and the guarantee that the
 * parser's own throw still reaches Effect unchanged. Also the measure of the
 * second `BETA-ASSUMPTION` in `./undecodableFrames.ts` (the parser throws only
 * Effect's two classes).
 */

import { Effect } from "effect";
import { RpcSerialization } from "effect/rpc";
import { describe, expect, it } from "vitest";
import {
  classifyUndecodable,
  PARSER_MESSAGE_MAX_CHARS,
  type UndecodableFrame,
  undecodableAware,
} from "./undecodableFrames";

/** A parser from `undecodableAware`'s layer, plus every frame it reported. */
function awareParser(): {
  parser: RpcSerialization.Parser;
  reported: UndecodableFrame[];
} {
  const reported: UndecodableFrame[] = [];
  const serialization = Effect.runSync(
    Effect.gen(function* () {
      return yield* RpcSerialization.RpcSerialization;
    }).pipe(Effect.provide(undecodableAware((frame) => reported.push(frame)))),
  );
  return { parser: serialization.makeUnsafe(), reported };
}

/** What `decode` threw, or a test failure if it threw nothing. */
function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (thrown) {
    return thrown;
  }
  throw new Error("expected decode to throw");
}

describe("undecodableAware", () => {
  it("names a text read that is not JSON, and still throws the parser's own error", () => {
    const { parser, reported } = awareParser();
    const thrown = thrownBy(() => parser.decode("not json\n"));

    expect(thrown).toBeInstanceOf(RpcSerialization.NdjsonDecodeError);
    expect((thrown as RpcSerialization.NdjsonDecodeError).cause).toBeInstanceOf(
      SyntaxError,
    );
    expect(reported).toHaveLength(1);
    const [frame] = reported;
    expect(frame?.kind).toBe("invalidJson");
    if (frame?.kind !== "invalidJson") return;
    expect(frame.parserMessage).not.toBe("");
    expect(frame.read).toEqual({ unit: "utf16", length: 9 });
  });

  it("measures a binary read in bytes", () => {
    const { parser, reported } = awareParser();
    const bytes = new TextEncoder().encode("{ \u00e9\n");
    const thrown = thrownBy(() => parser.decode(bytes));

    expect(thrown).toBeInstanceOf(RpcSerialization.NdjsonDecodeError);
    expect(reported).toHaveLength(1);
    expect(reported[0]?.read).toEqual({
      unit: "bytes",
      length: bytes.byteLength,
    });
  });

  it("never runs for frames that decode", () => {
    const { parser, reported } = awareParser();
    expect(parser.decode('{"a":1}\n{"b":2}\n')).toEqual([{ a: 1 }, { b: 2 }]);
    expect(parser.decode(new TextEncoder().encode('{"c":3}\n'))).toEqual([
      { c: 3 },
    ]);
    expect(reported).toEqual([]);
  });
});

describe("classifyUndecodable", () => {
  it("bounds the parser's sentence, however long the engine made it", () => {
    const frame = classifyUndecodable(
      new RpcSerialization.NdjsonDecodeError({
        cause: new SyntaxError("x".repeat(5_000)),
      }),
      "whatever\n",
    );
    expect(frame.kind).toBe("invalidJson");
    if (frame.kind !== "invalidJson") return;
    expect(frame.parserMessage).toHaveLength(PARSER_MESSAGE_MAX_CHARS);
  });

  it("reads the cap from the parser's own over-cap error", () => {
    const parser = RpcSerialization.makeNdjson({
      maxBufferSize: 8,
    }).makeUnsafe();
    const line = "123456789\n";
    const thrown = thrownBy(() => parser.decode(line));

    expect(classifyUndecodable(thrown, line)).toEqual({
      kind: "overCap",
      cap: 8,
      read: { unit: "utf16", length: line.length },
    });
  });

  it("does not guess at a throw the parser never makes", () => {
    expect(classifyUndecodable(new RangeError("boom"), "x\n")).toEqual({
      kind: "unrecognized",
      read: { unit: "utf16", length: 2 },
    });
  });
});
