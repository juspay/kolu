import type { PadiSurfaceClient } from "@kolu/padi-client/dial";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import {
  isPadiHistoryStale,
  materializeHistoryPage,
  readHistoryPage,
  readWholeHistory,
} from "./read.ts";

const ID = "a1b2c3d4-0000-4000-8000-000000000000" as TerminalId;

type Reply =
  | { kind: "chunk"; chunk: string; topLine: number; exhausted: boolean }
  | { kind: "stale" };

function fakeClient(replies: readonly Reply[]): {
  readonly client: PadiSurfaceClient;
  readonly calls: Array<Record<string, unknown>>;
} {
  const calls: Array<Record<string, unknown>> = [];
  let next = 0;
  const client = {
    surface: {
      screen: {
        history: (input: Record<string, unknown>) => {
          calls.push(input);
          const reply = replies[next++];
          return reply === undefined
            ? Effect.fail(new Error("pager asked for more pages than exist"))
            : Effect.succeed(reply);
        },
      },
    },
  } as unknown as PadiSurfaceClient;
  return { client, calls };
}

describe("materializeHistoryPage", () => {
  it("emits a non-empty chunk verbatim", () => {
    expect(materializeHistoryPage("older\n", 100, 50)).toBe("older\n");
  });

  it("materializes an all-blank spanning page as blank lines", () => {
    expect(materializeHistoryPage("", 80, 77)).toBe("\n\n\n");
  });

  it("skips an empty page that spans zero rows", () => {
    expect(materializeHistoryPage("", 80, 80)).toBeNull();
  });

  it("skips an empty self-seeded first page (before undefined, span unknown)", () => {
    expect(materializeHistoryPage("", undefined, 40)).toBeNull();
  });
});

describe("readWholeHistory", () => {
  it("walks the cursor back and returns the pages OLDEST-first", async () => {
    const { client, calls } = fakeClient([
      { kind: "chunk", chunk: "c-new\n", topLine: 94, exhausted: false },
      { kind: "chunk", chunk: "", topLine: 92, exhausted: false },
      { kind: "chunk", chunk: "c-old\n", topLine: 80, exhausted: true },
    ]);

    const pages = await Effect.runPromise(readWholeHistory(client, ID));

    expect(pages).toEqual(["c-old\n", "\n\n", "c-new\n"]);
    expect("before" in (calls[0] as object)).toBe(false);
    expect(calls[1]?.before).toBe(94);
    expect(calls[2]?.before).toBe(92);
  });

  it("keeps walking past an all-blank page — only `exhausted` ends the dump", async () => {
    const { client } = fakeClient([
      { kind: "chunk", chunk: "", topLine: 50, exhausted: false },
      {
        kind: "chunk",
        chunk: "reached-the-top\n",
        topLine: 0,
        exhausted: true,
      },
    ]);
    expect(await Effect.runPromise(readWholeHistory(client, ID))).toEqual([
      "reached-the-top\n",
    ]);
  });

  it("FAILS on a stale reply rather than returning the prefix it already read", async () => {
    const { client } = fakeClient([
      { kind: "chunk", chunk: "c-new\n", topLine: 94, exhausted: false },
      { kind: "stale" },
    ]);
    const exit = await Effect.runPromiseExit(readWholeHistory(client, ID));
    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) return;
    expect(isPadiHistoryStale(Cause.squash(exit.cause))).toBe(true);
  });
});

describe("readHistoryPage", () => {
  it("asks for ONE page with no cursor, so the host self-seeds", async () => {
    const { client, calls } = fakeClient([
      { kind: "chunk", chunk: "just-above\n", topLine: 40, exhausted: false },
    ]);
    expect(await Effect.runPromise(readHistoryPage(client, ID, 25))).toBe(
      "just-above\n",
    );
    expect(calls[0]).toEqual({ id: ID, max: 25 });
  });

  it("FAILS on a stale reply", async () => {
    const { client } = fakeClient([{ kind: "stale" }]);
    const exit = await Effect.runPromiseExit(readHistoryPage(client, ID, 25));
    expect(Exit.isFailure(exit)).toBe(true);
  });
});
