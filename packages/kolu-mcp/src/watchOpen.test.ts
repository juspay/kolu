/**
 * Pins `watch_open`'s ignoreSelf resolution — the face-level half. padi never
 * sees the boolean: this process either names its containing terminal as an
 * ignore id, or refuses the param.
 */

import type { PadiSurfaceClient } from "@kolu/padi-client/dial";
import type { PadiWatchOpenInput } from "@kolu/padi-client/surface";
import { ToolFailure } from "@kolu/surface-mcp";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { Effect, Stream } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveWatchOpenInput, watchOpenTool } from "./watchOpen.ts";

/** padi's input, or the refusal raised as the tool handler raises it — so these
 *  pins read as a caller experiences them, while the pure half answers in values
 *  like its CLI twin. The second argument is the ROSTER the stamp is confirmed
 *  against; `[]` is a padi that has never heard of this terminal. */
const plan = (
  ...args: Parameters<typeof resolveWatchOpenInput>
): PadiWatchOpenInput => {
  const parsed = resolveWatchOpenInput(...args);
  if (parsed.kind === "error") {
    throw new ToolFailure(parsed.message, parsed.detail);
  }
  return parsed.value;
};

const SELF = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as TerminalId;
const LANE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" as TerminalId;

describe("resolveWatchOpenInput", () => {
  it("passes ignoreIds through when ignoreSelf was not asked", () => {
    expect(
      plan({ name: "campaign", ignoreIds: [LANE] }, [], {}).ignoreIds,
    ).toEqual([LANE]);
    expect(Object.hasOwn(plan({ name: "campaign" }, [], {}), "ignoreIds")).toBe(
      false,
    );
  });

  it("unions ignoreSelf with listed mutes when the transport knows the caller", () => {
    const input = plan(
      { name: "campaign", ignoreIds: [LANE], ignoreSelf: true },
      [SELF, LANE],
      { KAVAL_TERMINAL_ID: SELF },
    );
    expect([...(input.ignoreIds ?? [])].sort()).toEqual([LANE, SELF].sort());
    expect(Object.hasOwn(input, "ignoreSelf")).toBe(false);
  });

  it("passes the cap through with its interval, and refuses it WITHOUT one", () => {
    const input = plan(
      { name: "campaign", nagMs: 300_000, nagCount: 2 },
      [],
      {},
    );
    expect(input.nagMs).toBe(300_000);
    expect(input.nagCount).toBe(2);

    // The same refusal the CLI gives --nag-count without --nag, in tool-arg
    // grammar: a cap on a repetition that never starts is nothing.
    const parsed = resolveWatchOpenInput(
      { name: "campaign", nagCount: 2 },
      [],
      {},
    );
    expect(parsed.kind).toBe("error");
    expect(parsed.kind === "error" && parsed.message).toMatch(/nagCount/);
    expect(parsed.kind === "error" && parsed.message).toMatch(/nagMs/);
  });

  it("refuses ignoreSelf when the transport cannot identify the caller", () => {
    try {
      plan({ name: "campaign", ignoreSelf: true }, [], {});
      expect.unreachable("should have refused");
    } catch (e) {
      expect(e).toBeInstanceOf(ToolFailure);
      expect((e as ToolFailure).message).toMatch(/KAVAL_TERMINAL_ID/);
      // This face's own sentence: a tool caller has `ignoreIds`, never
      // `--ignore <id>`, so padi holds the fact and not the wording.
      expect((e as ToolFailure).message).toMatch(/^ignoreSelf:/);
      expect((e as ToolFailure).message).toMatch(/ignoreIds/);
      expect((e as ToolFailure).detail).toEqual({
        kind: "ignore-self-unresolvable",
      });
    }
  });

  it("refuses when ignoreSelf mutes the only id the subscription is scoped to", () => {
    try {
      plan({ name: "campaign", ids: [SELF], ignoreSelf: true }, [SELF], {
        KAVAL_TERMINAL_ID: SELF,
      });
      expect.unreachable("should have refused");
    } catch (e) {
      expect(e).toBeInstanceOf(ToolFailure);
      expect((e as ToolFailure).message).toMatch(/can never match/);
      expect((e as ToolFailure).detail).toEqual({
        kind: "muted-covers-include",
      });
    }
  });

  it("refuses ids ∩ ignoreIds the same way, even without ignoreSelf", () => {
    try {
      plan({ name: "campaign", ids: [SELF], ignoreIds: [SELF] }, [], {});
      expect.unreachable("should have refused");
    } catch (e) {
      expect(e).toBeInstanceOf(ToolFailure);
      expect((e as ToolFailure).detail).toEqual({
        kind: "muted-covers-include",
      });
    }
  });

  it("refuses a STRAY stamp before it refuses the scope it would make empty", () => {
    // The stamp is resolved fully — fleet arm included — BEFORE the scope, so
    // this request (ids fully covered by a mute whose self is a stray stamp)
    // gets the SAME refusal the CLI gives it. Built the other way round, this
    // face said "can never match" and the CLI said "not in fleet".
    try {
      plan({ name: "campaign", ids: [SELF], ignoreSelf: true }, [LANE], {
        KAVAL_TERMINAL_ID: SELF,
      });
      expect.unreachable("should have refused");
    } catch (e) {
      expect((e as ToolFailure).detail).toEqual({
        kind: "ignore-self-not-in-fleet",
        id: SELF,
      });
    }
  });

  it("refuses ignoreSelf rather than guessing when the stamp is not a terminal id", () => {
    try {
      plan({ name: "campaign", ignoreSelf: true }, [], {
        KAVAL_TERMINAL_ID: "not-a-uuid",
      });
      expect.unreachable("should have refused");
    } catch (e) {
      expect(e).toBeInstanceOf(ToolFailure);
      expect((e as ToolFailure).detail).toEqual({
        kind: "ignore-self-invalid",
        raw: "not-a-uuid",
      });
    }
  });
});

/** A padi whose roster is exactly `live`, and whose `watch.open` records what it
 *  was handed. `terminals.keys` opens with a SNAPSHOT frame, as the real one
 *  does — `readTerminalKeys` treats an empty stream as a link failure. */
const fakePadi = (live: readonly TerminalId[]) => {
  const opened: PadiWatchOpenInput[] = [];
  const client = {
    surface: {
      terminals: { keys: () => Stream.make(live) },
      watch: {
        open: (input: PadiWatchOpenInput) => {
          opened.push(input);
          return Effect.succeed({ name: input.name, reattached: false });
        },
      },
    },
  } as unknown as PadiSurfaceClient;
  return { client, opened };
};

describe("watch_open — ignoreSelf against a fleet that has never heard of us", () => {
  beforeEach(() => {
    process.env.KAVAL_TERMINAL_ID = SELF;
  });
  afterEach(() => {
    delete process.env.KAVAL_TERMINAL_ID;
  });

  it("opens when the containing terminal IS in this padi's roster", async () => {
    const { client, opened } = fakePadi([SELF, LANE]);
    await Effect.runPromise(
      watchOpenTool.handler(
        { name: "campaign", ignoreSelf: true },
        client,
        undefined,
      ),
    );
    expect(opened[0]?.ignoreIds).toEqual([SELF]);
  });

  it("REFUSES when it is not — the same question the CLI asks, on the face that used to skip it", async () => {
    // `kolu mcp` honors --host / --socket, so this server can be fronting
    // another machine's fleet. Fail-open here would mute nobody and return
    // success, which is the one thing ignoreSelf refuses to do.
    const { client, opened } = fakePadi([LANE]);
    await expect(
      Effect.runPromise(
        watchOpenTool.handler(
          { name: "campaign", ignoreSelf: true },
          client,
          undefined,
        ),
      ),
    ).rejects.toThrow(/never heard of terminal/);
    expect(opened).toEqual([]);
  });

  it("names the terminal, the way out, and the restart that re-keys them", async () => {
    const { client } = fakePadi([LANE]);
    // On the ERROR channel — which is what `failFrom` reads the detail off, and
    // what keeps a refusal from looking like a defect in this server.
    const err: ToolFailure = await Effect.runPromise(
      Effect.catch(
        watchOpenTool.handler(
          { name: "campaign", ignoreSelf: true },
          client,
          undefined,
        ) as Effect.Effect<never, ToolFailure>,
        (e) => Effect.succeed(e),
      ),
    );
    expect(err).toBeInstanceOf(ToolFailure);
    expect(err.message).toContain(SELF);
    expect(err.message).toMatch(/ignoreIds/);
    expect(err.message).toMatch(/restart/);
    expect(err.detail).toEqual({ kind: "ignore-self-not-in-fleet", id: SELF });
  });

  it("does NOT read the roster when ignoreSelf was never asked", async () => {
    const client = {
      surface: {
        terminals: {
          keys: () => {
            throw new Error("the roster must not be read here");
          },
        },
        watch: { open: () => Effect.succeed({ name: "x", reattached: false }) },
      },
    } as unknown as PadiSurfaceClient;
    await Effect.runPromise(
      watchOpenTool.handler({ name: "campaign" }, client, undefined),
    );
  });
});
