/**
 * Pins `kolu watch`'s supervision GRAMMAR — the argv half, which is all this
 * face owns. What a bucket is (`isWaitState`) and what a knob means are padi's;
 * how a duration is spelled, and what a bad one reads like, is argv, and it is
 * decided here BEFORE anything dials a daemon.
 */

import { shortId } from "@kolu/padi/render";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { describe, expect, it } from "vitest";
import {
  planHeartbeat,
  planIgnoreSelf,
  planSupervision,
  planWatch,
  planWatchScope,
  refuseSelfNotInFleet,
  resolveIgnoreQueries,
  type WatchArgs,
} from "./watch.ts";

const args = (over: Partial<WatchArgs> = {}): WatchArgs =>
  ({
    id: undefined,
    json: false,
    ignore: [],
    ignoreSelf: false,
    heartbeat: undefined,
    ...over,
  }) as WatchArgs;

const SELF = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as TerminalId;
const LANE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" as TerminalId;

describe("planSupervision", () => {
  it("plans NOTHING when no knob was named — bare `kolu watch` is still the change tail", () => {
    const plan = planSupervision(args());
    expect(plan).toEqual({ kind: "ok", value: undefined });
  });

  it("sends only the knobs the user actually spelled — the defaults are padi's", () => {
    expect(planSupervision(args({ nag: "5m" }))).toEqual({
      kind: "ok",
      value: { nagMs: 300_000 },
    });
  });

  it("reads every duration unit", () => {
    const held = (raw: string) =>
      planSupervision(args({ heldFor: raw })) as {
        value: { heldForMs: number };
      };
    expect(held("500ms").value.heldForMs).toBe(500);
    expect(held("60s").value.heldForMs).toBe(60_000);
    expect(held("5m").value.heldForMs).toBe(300_000);
    expect(held("2h").value.heldForMs).toBe(7_200_000);
    // `d`, because the feed's own hold column is rendered with `relativeTime`,
    // which prints `2d`. A grammar you can read out of the output and not type
    // back in is half a grammar.
    expect(held("1d").value.heldForMs).toBe(86_400_000);
  });

  it("reads a bare number as MILLISECONDS — the spelling the rest of the binary uses", () => {
    // `--timeout 10000`, `--settled 15000` and `--until idle:2000` are all bare
    // millisecond integers. One binary must not hold two duration grammars that
    // refuse each other's spelling.
    expect(planSupervision(args({ heldFor: "60000" }))).toEqual({
      kind: "ok",
      value: { heldForMs: 60_000 },
    });
  });

  it("refuses something that is neither — a unit it does not know, or a word", () => {
    for (const raw of ["banana", "5min", "1.5m", "-3s"]) {
      const plan = planSupervision(args({ heldFor: raw }));
      expect(plan.kind, raw).toBe("error");
      expect(plan.kind === "error" && plan.message).toMatch(
        /is not a duration/,
      );
    }
  });

  it("refuses a duration past the timer ceiling instead of overflowing into an instant repeat", () => {
    const plan = planSupervision(args({ nag: "99999h" }));
    expect(plan.kind).toBe("error");
    expect(plan.kind === "error" && plan.message).toMatch(/~24\.8 days/);
  });

  it("refuses `--nag 0` — an interval of zero is a spin, not a fast nag", () => {
    const plan = planSupervision(args({ nag: "0s" }));
    expect(plan.kind).toBe("error");
    expect(plan.kind === "error" && plan.message).toMatch(/spin/);
  });

  it("accepts `--held-for 0s` — report it the instant it enters", () => {
    expect(planSupervision(args({ heldFor: "0s" }))).toEqual({
      kind: "ok",
      value: { heldForMs: 0 },
    });
  });

  it("parses a comma list of buckets, any-of", () => {
    expect(planSupervision(args({ states: "waiting,awaiting" }))).toEqual({
      kind: "ok",
      value: { states: ["waiting", "awaiting"] },
    });
    // Spacing and case are typing, not meaning.
    expect(planSupervision(args({ states: " Waiting , awaiting " }))).toEqual({
      kind: "ok",
      value: { states: ["waiting", "awaiting"] },
    });
  });

  it("refuses a token that is not a bucket, and says which ones are", () => {
    const plan = planSupervision(args({ states: "idle" }));
    expect(plan.kind).toBe("error");
    expect(plan.kind === "error" && plan.message).toMatch(
      /working, awaiting, waiting/,
    );
  });

  it("refuses an empty --states rather than silently watching everything", () => {
    expect(planSupervision(args({ states: " , " })).kind).toBe("error");
  });

  it("does NOT switch feed for --ignore / --ignore-self / --heartbeat alone — they are not supervision knobs", () => {
    expect(
      planSupervision(
        args({ ignore: [SELF], ignoreSelf: true, heartbeat: "10s" }),
      ),
    ).toEqual({
      kind: "ok",
      value: undefined,
    });
  });
});

describe("planHeartbeat", () => {
  it("is off when the flag is absent", () => {
    expect(planHeartbeat(args())).toEqual({ kind: "ok", value: undefined });
  });

  it("reads the same duration grammar as --nag", () => {
    expect(planHeartbeat(args({ heartbeat: "10s" }))).toEqual({
      kind: "ok",
      value: 10_000,
    });
  });

  it("refuses an interval of zero — a spin, not a fast heartbeat", () => {
    const plan = planHeartbeat(args({ heartbeat: "0s" }));
    expect(plan.kind).toBe("error");
    expect(plan.kind === "error" && plan.message).toMatch(/spin/);
  });
});

describe("planIgnoreSelf", () => {
  it("plans nothing when the flag is off", () => {
    expect(planIgnoreSelf(args())).toEqual({
      kind: "ok",
      value: undefined,
    });
  });

  it("refuses --ignore-self when this process is not inside a kolu terminal", () => {
    const plan = planIgnoreSelf(args({ ignoreSelf: true }), {});
    expect(plan.kind).toBe("error");
    // The sentence is THIS face's: it names the env padi read and the way out
    // in argv's own grammar, which padi has no business spelling.
    expect(plan.kind === "error" && plan.message).toMatch(/KAVAL_TERMINAL_ID/);
    expect(plan.kind === "error" && plan.message).toMatch(/--ignore <id>/);
  });

  it("refuses a garbled stamp rather than guessing, in this face's words", () => {
    const plan = planIgnoreSelf(args({ ignoreSelf: true }), {
      KAVAL_TERMINAL_ID: "not-a-uuid",
    });
    expect(plan.kind).toBe("error");
    expect(plan.kind === "error" && plan.message).toMatch(/^--ignore-self:/);
    expect(plan.kind === "error" && plan.message).toMatch(/not-a-uuid/);
  });

  it("resolves --ignore-self to the containing terminal", () => {
    expect(
      planIgnoreSelf(args({ ignoreSelf: true }), {
        KAVAL_TERMINAL_ID: SELF,
      }),
    ).toEqual({ kind: "ok", value: SELF });
  });

  it("does NOT ask which fleet — that is a roster question, and the roster is not argv", () => {
    // The endpoint used to be part of this parse (`--host` was refused here).
    // It was a transport-shaped proxy: it missed a --socket aimed at a
    // different padi, and missed a stamp gone stale across a restart.
    expect(
      planIgnoreSelf(args({ ignoreSelf: true }), { KAVAL_TERMINAL_ID: SELF }),
    ).toEqual({ kind: "ok", value: SELF });
  });
});

describe("refuseSelfNotInFleet — the membership question, asked of the roster", () => {
  it("says nothing when the containing terminal IS in this padi's roster", () => {
    expect(refuseSelfNotInFleet(SELF, [SELF, LANE])).toBeUndefined();
  });

  it("says nothing when --ignore-self was never asked", () => {
    expect(refuseSelfNotInFleet(undefined, [])).toBeUndefined();
  });

  it("refuses when this padi has never heard of the containing terminal", () => {
    // The one shape --ignore-self exists to refuse: a mute that mutes nobody
    // and reports success. Subsumes --host, a --socket aimed at a different
    // padi, and a stamp re-keyed by a daemon restart.
    const message = refuseSelfNotInFleet(SELF, [LANE]);
    expect(message).toBeDefined();
    expect(message).toContain(shortId(SELF));
    expect(message).toMatch(/--ignore <id>/);
    // A restart re-keys terminals, which is the other way a stamp goes stale.
    expect(message).toMatch(/restart/);
  });
});

describe("resolveIgnoreQueries — fail-open mute", () => {
  it("widens a unique prefix to the live id", () => {
    expect(resolveIgnoreQueries(["aaaa"], [SELF, LANE])).toEqual({
      kind: "ok",
      // The drop list rides the SUCCESS arm — there is no shape of this result
      // that is both a refusal and a diagnostic.
      value: { ids: [SELF], dropped: [] },
    });
  });

  it("keeps a stale full id — a mute that names nobody costs nothing", () => {
    const gone = "cccccccc-cccc-4ccc-8ccc-cccccccccccc" as TerminalId;
    expect(resolveIgnoreQueries([gone], [SELF])).toEqual({
      kind: "ok",
      value: { ids: [gone], dropped: [] },
    });
  });

  it("drops a prefix that named nobody — it could never match a UUID on the wire", () => {
    expect(resolveIgnoreQueries(["zzzz"], [SELF])).toEqual({
      kind: "ok",
      value: { ids: [], dropped: ["zzzz"] },
    });
  });

  it("refuses an ambiguous prefix rather than guessing which mute", () => {
    const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as TerminalId;
    const b = "aaaaaaaa-bbbb-4bbb-8bbb-bbbbbbbbbbbb" as TerminalId;
    const plan = resolveIgnoreQueries(["aaaa"], [a, b]);
    expect(plan.kind).toBe("error");
    const message = plan.kind === "error" ? plan.message : "";
    expect(message).toMatch(/matches 2/);
    // …and LISTS them, in the same words `--parent` and the subject id use.
    // "type more characters" with nothing to compare against is the sentence
    // minus the affordance it exists for.
    expect(message).toContain("--ignore: ");
    expect(message).toContain(shortId(a));
    expect(message).toContain(shortId(b));
  });
});

describe("planWatchScope — id ∩ ignore is a silent never-match", () => {
  it("refuses tailing the one terminal that is also muted, in argv's own grammar", () => {
    const plan = planWatchScope(SELF, [SELF]);
    expect(plan.kind).toBe("error");
    expect(plan.kind === "error" && plan.message).toMatch(/can never match/);
    // padi states the invariant; the way OUT is this face's to spell.
    expect(plan.kind === "error" && plan.message).toMatch(/--ignore/);
  });

  it("allows a fleet watch that merely mutes someone", () => {
    const plan = planWatchScope(undefined, [SELF]);
    expect(plan.kind).toBe("ok");
    expect(plan.kind === "ok" && [...(plan.value.mute ?? [])]).toEqual([SELF]);
    expect(plan.kind === "ok" && plan.value.include).toBeUndefined();
  });

  it("allows a scoped watch whose mute is someone else", () => {
    const plan = planWatchScope(LANE, [SELF]);
    expect(plan.kind).toBe("ok");
    expect(plan.kind === "ok" && [...(plan.value.include ?? [])]).toEqual([
      LANE,
    ]);
  });

  it("spells an empty mute as mute-nobody — fail-open, one spelling", () => {
    const plan = planWatchScope(undefined, []);
    expect(plan.kind === "ok" && plan.value).toEqual({});
  });
});

describe("planWatch — everything argv decides, decided once", () => {
  it("carries the daemon-needing queries across UNRESOLVED — a roster is not argv", () => {
    const plan = planWatch(
      args({ id: "aaaa", ignore: ["bbbb"], json: true }),
      {},
    );
    expect(plan).toEqual({
      kind: "ok",
      value: { ignore: ["bbbb"], id: "aaaa", json: true },
    });
  });

  it("resolves --ignore-self and --heartbeat, which need no daemon", () => {
    const plan = planWatch(
      args({ ignoreSelf: true, heartbeat: "10s", nag: "5m" }),
      {
        KAVAL_TERMINAL_ID: SELF,
      },
    );
    expect(plan).toEqual({
      kind: "ok",
      value: {
        supervise: { nagMs: 300_000 },
        self: SELF,
        heartbeatMs: 10_000,
        ignore: [],
        json: false,
      },
    });
  });

  it("has ONE error arm — a fourth flag cannot land on the wrong side of the dial", () => {
    // Each of the three pre-dial refusals reaches the caller through this one
    // return, rather than through a block the author had to remember to add.
    expect(planWatch(args({ heldFor: "banana" }), {}).kind).toBe("error");
    expect(planWatch(args({ heartbeat: "0s" }), {}).kind).toBe("error");
    expect(planWatch(args({ ignoreSelf: true }), {}).kind).toBe("error");
  });
});
