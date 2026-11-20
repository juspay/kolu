import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { Effect, Stream } from "effect";
import { ptyHostClientOver } from "kaval";
import { describe, expect, it } from "vitest";
import { PtyHostTerminalProxy } from "./local.ts";

function recordingClient(): {
  client: ReturnType<typeof ptyHostClientOver>;
  calls: { tag: string; payload: unknown }[];
} {
  const calls: { tag: string; payload: unknown }[] = [];
  const client = ptyHostClientOver({
    unary: (tag, payload) => {
      calls.push({ tag, payload });
      return Effect.succeed({ text: "", kind: "chunk", chunk: "", topLine: 0 });
    },
    stream: (tag, payload) => {
      calls.push({ tag, payload });
      return Stream.empty;
    },
  });
  return { client, calls };
}

function readyProxy(): ReturnType<typeof recordingClient> & {
  proxy: PtyHostTerminalProxy;
} {
  const rec = recordingClient();
  const proxy = new PtyHostTerminalProxy("t1" as TerminalId, rec.client, {
    submits: () => false,
    onSubmit: () => {},
  });
  proxy.markReady(4242);
  return { ...rec, proxy };
}

describe("getHistory forwards absent cursors as ABSENT KEYS", () => {
  it("omits `before` and `epoch` when the caller sent neither", async () => {
    const { proxy, calls } = readyProxy();

    await proxy.getHistory(undefined, 100, undefined);

    const payload = calls.at(-1)?.payload as Record<string, unknown>;
    expect(Object.hasOwn(payload, "before")).toBe(false);
    expect(Object.hasOwn(payload, "epoch")).toBe(false);
    expect(payload).toEqual({ id: "t1", max: 100 });
  });

  it("omits only `epoch` when the caller sent a cursor but no reflow epoch", async () => {
    const { proxy, calls } = readyProxy();

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
