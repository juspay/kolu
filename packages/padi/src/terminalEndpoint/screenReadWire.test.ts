/**
 * The padi→kaval SCREEN-READ seam — `screen.text` / `screen.history` forwarded
 * onto kaval's wire.
 *
 * Both of padi's screen reads are pure FORWARDERS: `servePadi`'s handlers hand
 * `input.startLine` / `input.endLine` / `input.before` / `input.epoch` straight
 * to the terminal handle, and every one of those is `Schema.optionalKey` on BOTH
 * wires — so an omitted key arrives at the forwarder as a plain `undefined`.
 * kaval's client face DECODES its input (`packages/surface/src/client.ts` —
 * `Schema.decodeUnknownSync` at the edge), and `optionalKey` accepts an ABSENT
 * key while REJECTING a present-`undefined` one, where zod's `.optional()` took
 * either. So re-spelling the forwarded `undefined` throws inside padi before the
 * call ever reaches kaval — the same #17 mapping hazard that killed the daemon
 * on `lastAgentCommand` and painted a ParseError into the diff pane on `oldPath`.
 *
 * These pins drive the REAL producer (`PtyHostTerminalProxy`) through the REAL
 * spec-derived face (`ptyHostClientOver`), so the decode gate under test is the
 * production one, not a paraphrase. Falsify by re-spelling either key: the
 * failures read `Expected number, got undefined at ["before"]` /
 * `... at ["startLine"]` verbatim.
 */

import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { Effect, Stream } from "effect";
import { ptyHostClientOver } from "kaval";
import { describe, expect, it } from "vitest";
import { PtyHostTerminalProxy } from "./local.ts";

/** A dispatch that RECORDS what the face handed it, after the face's own input
 *  decode ran — so a recorded payload is proof the input was wire-legal, and a
 *  throw out of the call is proof it was not. */
function recordingClient(): {
  client: ReturnType<typeof ptyHostClientOver>;
  calls: { tag: string; payload: unknown }[];
} {
  const calls: { tag: string; payload: unknown }[] = [];
  const client = ptyHostClientOver({
    unary: (tag, payload) => {
      calls.push({ tag, payload });
      // Enough of each reply for the proxy's destructuring; the assertion is on
      // what went OUT, not what came back.
      return Effect.succeed({ text: "", kind: "chunk", chunk: "", topLine: 0 });
    },
    stream: (tag, payload) => {
      calls.push({ tag, payload });
      return Stream.empty;
    },
  });
  return { client, calls };
}

/** A proxy already past its spawn gate — every verb below awaits `ready`. */
function readyProxy(): ReturnType<typeof recordingClient> & {
  proxy: PtyHostTerminalProxy;
} {
  const rec = recordingClient();
  const proxy = new PtyHostTerminalProxy("t1" as TerminalId, rec.client);
  proxy.markReady(4242);
  return { ...rec, proxy };
}

describe("getHistory forwards absent cursors as ABSENT KEYS", () => {
  it("omits `before` and `epoch` when the caller sent neither", async () => {
    const { proxy, calls } = readyProxy();

    // The self-seeding first page — exactly what the `screen_history` MCP tool
    // sends (`{ id, max }`), forwarded by `servePadi` as `(undefined, max,
    // undefined)`. Under the pre-fix spelling this REJECTED at the face.
    await proxy.getHistory(undefined, 100, undefined);

    const payload = calls.at(-1)?.payload as Record<string, unknown>;
    expect(Object.hasOwn(payload, "before")).toBe(false);
    expect(Object.hasOwn(payload, "epoch")).toBe(false);
    expect(payload).toEqual({ id: "t1", max: 100 });
  });

  it("omits only `epoch` when the caller sent a cursor but no reflow epoch", async () => {
    const { proxy, calls } = readyProxy();

    // The browser's ordinary backfill against a snapshot that carried no
    // `reflowEpoch` (`Terminal.tsx` spreads `epoch`, so padi's handler reads it
    // as `undefined`).
    await proxy.getHistory(40, 100, undefined);

    const payload = calls.at(-1)?.payload as Record<string, unknown>;
    expect(payload).toEqual({ id: "t1", before: 40, max: 100 });
    expect(Object.hasOwn(payload, "epoch")).toBe(false);
  });

  it("still sends both when both are known", async () => {
    const { proxy, calls } = readyProxy();
    await proxy.getHistory(40, 100, 7);
    expect(calls.at(-1)?.payload).toEqual({
      id: "t1",
      before: 40,
      max: 100,
      epoch: 7,
    });
  });
});

describe("getScreenText forwards a HALF-open range as an absent bound", () => {
  it("omits `endLine` when only a start bound was asked for", async () => {
    const { proxy, calls } = readyProxy();

    await proxy.getScreenText(5, undefined, undefined);

    const payload = calls.at(-1)?.payload as {
      extent: Record<string, unknown>;
    };
    expect(payload.extent).toEqual({ kind: "range", startLine: 5 });
    expect(Object.hasOwn(payload.extent, "endLine")).toBe(false);
  });

  it("omits `startLine` when only an end bound was asked for", async () => {
    const { proxy, calls } = readyProxy();

    await proxy.getScreenText(undefined, 9, undefined);

    const payload = calls.at(-1)?.payload as {
      extent: Record<string, unknown>;
    };
    expect(payload.extent).toEqual({ kind: "range", endLine: 9 });
    expect(Object.hasOwn(payload.extent, "startLine")).toBe(false);
  });

  it("keeps the `full` and `tail` arms intact", async () => {
    const { proxy, calls } = readyProxy();

    await proxy.getScreenText(undefined, undefined, undefined);
    expect(calls.at(-1)?.payload).toEqual({
      id: "t1",
      extent: { kind: "full" },
    });

    await proxy.getScreenText(undefined, undefined, 20);
    expect(calls.at(-1)?.payload).toEqual({
      id: "t1",
      extent: { kind: "tail", lines: 20 },
    });
  });
});
