/**
 * The `screen.history` PAGER, pinned apart from a socket.
 *
 * The walk is the part with a silent failure mode — a truncated dump that exits
 * 0 — so what is asserted here is the whole protocol discipline: the first call
 * OMITS `before` (an explicit `undefined` is a decode failure on a
 * `Schema.optionalKey`, not a self-seed request), each reply's `topLine` becomes
 * the next `before`, an all-blank page contributes its exact row span rather
 * than being dropped, `exhausted` is the ONLY terminator, and a `stale` reply
 * FAILS rather than returning the prefix read so far.
 *
 * The branch cases match `kaval-tui/src/historyPage.test.ts`'s — the copy this
 * graduated past — so the two can be compared line for line until that one is
 * retired with its TUI.
 */

import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import type { PadiSurfaceClient } from "../dial.ts";
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

/** A padi client that serves a canned reply sequence and RECORDS the inputs it
 *  was called with — the cursor walk is the thing under test, so what the pager
 *  ASKED for matters as much as what it built. */
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
      // Empty chunk spanning 94 - 92 = 2 rows: real blank scrollback.
      { kind: "chunk", chunk: "", topLine: 92, exhausted: false },
      { kind: "chunk", chunk: "c-old\n", topLine: 80, exhausted: true },
    ]);

    const pages = await Effect.runPromise(readWholeHistory(client, ID));

    expect(pages).toEqual(["c-old\n", "\n\n", "c-new\n"]);
    // The first call must OMIT `before` — the host self-seeds from the screen
    // top, and an explicit `undefined` would be a decode failure instead.
    expect("before" in (calls[0] as object)).toBe(false);
    expect(calls[1]?.before).toBe(94);
    expect(calls[2]?.before).toBe(92);
  });

  it("keeps walking past an all-blank page — only `exhausted` ends the dump", async () => {
    // The bug this guards: treating an empty chunk as the end would cut off
    // every line ABOVE a blank run.
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
    // A `break` here would have printed one page and exited 0 — indistinguishable
    // from a complete dump to whatever is reading it.
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
