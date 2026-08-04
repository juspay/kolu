/**
 * The stdio readiness gate, at the BYTE level (juspay/kolu#2101).
 *
 * The gate is the only thing standing between an `RpcClient` (and its pinger)
 * and a peer of unknown protocol epoch, so every one of its five outcomes is
 * pinned here against real stream mechanics rather than a mocked reader:
 *
 *  1. **the over-read** — banner and first RPC frame in ONE chunk. The load-
 *     bearing case: the frame must survive, byte for byte, on the same stream.
 *  2. **split across chunks** — a banner delivered a few bytes at a time.
 *  3. **silence** → the deadline, which is the previous-epoch presentation.
 *  4. **an undecodable prelude** → classified, with a bounded excerpt.
 *  5. **a refused verdict** → a typed rejection carrying the app's opaque anomaly.
 *
 * Plus the brand itself: a hand-rolled look-alike is not a proof, and
 * `stdioLink` refuses it.
 */

import { PassThrough } from "node:stream";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { defineSurface } from "../define";
import {
  awaitStdioReadiness,
  isStdioReadinessError,
  isStdioReadinessProof,
  STDIO_READINESS_KEY,
  type StdioReadinessError,
  writeStdioReadiness,
} from "./readiness";
import { stdioLink } from "./stdio";

const READY_BANNER = `{"${STDIO_READINESS_KEY}":{"v":1,"verdict":"ready"}}\n`;

/** Read every remaining byte off a stream once the gate has handed it back. */
function drain(stream: PassThrough): Promise<string> {
  return new Promise((resolve) => {
    let out = "";
    stream.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf-8");
    });
    stream.once("end", () => resolve(out));
  });
}

describe("awaitStdioReadiness — byte discipline", () => {
  it("consumes ONLY the banner line when the first RPC frame rides the same chunk", async () => {
    // THE case the gate must not get wrong. A child that greets and answers in
    // the same write lands both in one chunk; a reader that consumed the whole
    // chunk would swallow the frame and the first call would hang forever.
    const frame = `{"_tag":"Request","id":"1"}\n`;
    const read = new PassThrough();
    const proof = awaitStdioReadiness({
      read,
      deadlineMs: 5_000,
      describe: "one-chunk peer",
    });
    read.write(`${READY_BANNER}${frame}`);

    expect(isStdioReadinessProof(await proof)).toBe(true);
    read.end();
    // Byte-exact: everything after the banner's newline is still on the stream.
    expect(await drain(read)).toBe(frame);
  });

  it("assembles a banner split across chunks, and keeps the trailing bytes", async () => {
    const read = new PassThrough();
    const proof = awaitStdioReadiness({
      read,
      deadlineMs: 5_000,
      describe: "dribbling peer",
    });
    // Byte-by-byte-ish delivery, with the newline arriving in its own chunk and
    // a frame fragment glued to it.
    read.write(READY_BANNER.slice(0, 10));
    read.write(READY_BANNER.slice(10, 25));
    read.write(`${READY_BANNER.slice(25)}{"_tag":"Pong"}\n`);

    expect(isStdioReadinessProof(await proof)).toBe(true);
    read.end();
    expect(await drain(read)).toBe(`{"_tag":"Pong"}\n`);
  });

  it("classifies a peer that accepts the pipe and says nothing as `silent`", async () => {
    // The previous-epoch presentation, verbatim: the peer is waiting for a
    // greeting in a protocol we no longer speak. Pre-gate this is where the
    // pinger took over and the failure became indistinguishable from a down host.
    const read = new PassThrough();
    const err = await awaitStdioReadiness({
      read,
      deadlineMs: 40,
      describe: "mute peer",
    }).catch((e: unknown) => e);

    expect(isStdioReadinessError(err)).toBe(true);
    expect((err as StdioReadinessError).kind).toBe("silent");
    expect((err as StdioReadinessError).message).toContain("mute peer");
  });

  it("classifies a non-banner first line as `undecodable`, quoting bounded evidence", async () => {
    const read = new PassThrough();
    const failure = awaitStdioReadiness({
      read,
      deadlineMs: 5_000,
      describe: "chatty peer",
    }).catch((e: unknown) => e);
    // A control byte and a quote, to prove the excerpt is JSON-quoted rather
    // than pasted raw into an operator's log line.
    read.write(`${String.fromCharCode(7)}not a banner "at all"\n`);

    const err = (await failure) as StdioReadinessError;
    expect(isStdioReadinessError(err)).toBe(true);
    expect(err.kind).toBe("undecodable");
    expect(err.message).toContain('\\u0007not a banner \\"at all\\"');
  });

  it("rejects a `refused` verdict with the app's opaque anomaly intact", async () => {
    // The framework does not know what an anomaly IS — it must move whatever the
    // app put there across the pipe unchanged, so the binder can decode it with
    // its own schema instead of parsing a sentence.
    const anomaly = {
      kind: "unconverged",
      cause: { kind: "unspeakable-protocol", pid: 25494 },
    };
    const read = new PassThrough();
    const failure = awaitStdioReadiness({
      read,
      deadlineMs: 5_000,
      describe: "refusing peer",
    }).catch((e: unknown) => e);
    writeStdioReadiness(read, {
      verdict: "refused",
      detail: "this host's padi speaks a previous protocol epoch",
      anomaly,
    });

    const err = (await failure) as StdioReadinessError;
    expect(err.kind).toBe("refused");
    expect(err.message).toContain("previous protocol epoch");
    expect(err.anomaly).toEqual(anomaly);
  });

  it("treats a banner of a different banner VERSION as undecodable, never as ready", async () => {
    // Guessing about a peer's epoch is the one thing this module exists to stop.
    const read = new PassThrough();
    const failure = awaitStdioReadiness({
      read,
      deadlineMs: 5_000,
      describe: "future peer",
    }).catch((e: unknown) => e);
    read.write(`{"${STDIO_READINESS_KEY}":{"v":2,"verdict":"ready"}}\n`);

    expect(((await failure) as StdioReadinessError).kind).toBe("undecodable");
  });
});

describe("the readiness brand", () => {
  const surface = defineSurface({
    procedures: {
      sys: { ping: { input: Schema.Undefined, output: Schema.Boolean } },
    },
  });

  it("refuses a hand-rolled look-alike at `stdioLink`", () => {
    // The WeakSet is un-reflectable, so the only way to hold a proof is to have
    // read a banner. A structural copy carries the shape and none of the meaning.
    // The refusal is a SYNCHRONOUS throw: no protocol layer, and therefore no
    // pinger, is built before it fires.
    const forged = { describe: "stdio" };
    expect(isStdioReadinessProof(forged)).toBe(false);
    expect(() =>
      stdioLink({
        group: surface.group,
        read: new PassThrough(),
        write: new PassThrough(),
        readiness: forged,
      }),
    ).toThrow(/was not minted by `awaitStdioReadiness`/);
  });
});
