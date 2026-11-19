import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  CheckStatusSchema,
  foldCheckOutcomes,
  MergeStateStatusSchema,
  PrInfoSchema,
  PrStateSchema,
  prResultEqual,
  ReviewDecisionSchema,
} from "./schemas.ts";
import type { PrInfo, PrResult } from "./schemas.ts";

/** Byte-level wire contract for `PrInfo` — the format kolu's server emits and
 *  every client decodes. These assert the exact JSON STRING (not just
 *  decode-equality) because a key-order or key-presence change here is a
 *  silent wire break across a rolling deploy. */
describe("PrInfo wire format", () => {
  const decode = Schema.decodeUnknownSync(PrInfoSchema);
  const encode = Schema.encodeSync(PrInfoSchema);

  it("encodes number/title/url/state/checks/checkRuns/reviewDecision/mergeStateStatus/headSha/isDraft in that key order", () => {
    const pr: PrInfo = {
      number: 148,
      title: "Decomplect PR resolution state",
      url: "https://github.com/juspay/kolu/pull/148",
      state: "open",
      checks: "fail",
      checkRuns: [
        { name: "ci::biome@x86_64-linux", outcome: "fail" },
        { name: "ci::unit@x86_64-linux", outcome: "pass" },
      ],
      reviewDecision: "CHANGES_REQUESTED",
      mergeStateStatus: "BLOCKED",
      headSha: "4f21a9c0d3e5b7a9c1d3e5f7a9b1c3d5e7f9a1b3",
      isDraft: true,
    };
    expect(JSON.stringify(encode(pr))).toBe(
      '{"number":148,"title":"Decomplect PR resolution state",' +
        '"url":"https://github.com/juspay/kolu/pull/148","state":"open",' +
        '"checks":"fail","checkRuns":[' +
        '{"name":"ci::biome@x86_64-linux","outcome":"fail"},' +
        '{"name":"ci::unit@x86_64-linux","outcome":"pass"}],' +
        '"reviewDecision":"CHANGES_REQUESTED","mergeStateStatus":"BLOCKED",' +
        '"headSha":"4f21a9c0d3e5b7a9c1d3e5f7a9b1c3d5e7f9a1b3","isDraft":true}',
    );
  });

  it("encodes an empty checkRuns as a present [] (never omits the key)", () => {
    // The decoding default must NOT bleed into encoding: a newer server still
    // puts `checkRuns` on the wire, so an even-newer peer that grows a
    // required reading of it sees the field.
    const pr: PrInfo = {
      number: 1,
      title: "t",
      url: "https://example.invalid/pull/1",
      state: "merged",
      checks: null,
      checkRuns: [],
      reviewDecision: null,
      mergeStateStatus: "UNKNOWN",
      headSha: null,
      isDraft: false,
    };
    expect(JSON.stringify(encode(pr))).toBe(
      '{"number":1,"title":"t","url":"https://example.invalid/pull/1",' +
        '"state":"merged","checks":null,"checkRuns":[],' +
        '"reviewDecision":null,"mergeStateStatus":"UNKNOWN","headSha":null,' +
        '"isDraft":false}',
    );
  });

  it("decodes an OLD server payload with no checkRuns / review / merge / head keys (rolling deploy)", () => {
    // Rolling-deploy tolerance, not a fallback: an older server emitting
    // payloads without these fields must still parse on a newer client.
    expect(
      decode({
        number: 7,
        title: "old server",
        url: "https://example.invalid/pull/7",
        state: "open",
        checks: "pending",
        isDraft: false,
      }),
    ).toEqual({
      number: 7,
      title: "old server",
      url: "https://example.invalid/pull/7",
      state: "open",
      checks: "pending",
      checkRuns: [],
      reviewDecision: null,
      // No merge state said — not GitHub's own UNKNOWN.
      mergeStateStatus: null,
      headSha: null,
      isDraft: false,
    });
  });

  it("re-encodes a defaulted old payload with the key materialised", () => {
    const wire = {
      number: 7,
      title: "old server",
      url: "https://example.invalid/pull/7",
      state: "open" as const,
      checks: "pending" as const,
      isDraft: false,
    };
    expect(JSON.stringify(encode(decode(wire)))).toBe(
      '{"number":7,"title":"old server",' +
        '"url":"https://example.invalid/pull/7","state":"open",' +
        '"checks":"pending","checkRuns":[],' +
        '"reviewDecision":null,"mergeStateStatus":null,"headSha":null,' +
        '"isDraft":false}',
    );
  });

  it("refuses a payload that does not say whether the PR is a draft", () => {
    // No decoding default, unlike the fields above: a reading that does not
    // say is refused, never read as "ready" — a draft cannot merge whatever
    // its merge state says, so guessing would ring for a PR nobody can merge.
    const attempt = Schema.decodeUnknownResult(PrInfoSchema);
    const wire = {
      number: 7,
      title: "t",
      url: "https://example.invalid/pull/7",
      state: "open",
      checks: null,
    };
    expect(Result.isFailure(attempt(wire))).toBe(true);
    expect(Result.isFailure(attempt({ ...wire, isDraft: "true" }))).toBe(true);
    expect(Result.isFailure(attempt({ ...wire, isDraft: null }))).toBe(true);
  });

  it("decodes a NEW server payload with checkRuns / review / merge / head / draft verbatim", () => {
    const decoded = decode({
      number: 8,
      title: "new server",
      url: "https://example.invalid/pull/8",
      state: "closed",
      checks: null,
      checkRuns: [{ name: "gate", outcome: "pass" }],
      reviewDecision: "APPROVED",
      mergeStateStatus: "CLEAN",
      headSha: "4f21a9c",
      isDraft: true,
    });
    expect(decoded.checkRuns).toEqual([{ name: "gate", outcome: "pass" }]);
    expect(decoded.reviewDecision).toBe("APPROVED");
    expect(decoded.mergeStateStatus).toBe("CLEAN");
    expect(decoded.headSha).toBe("4f21a9c");
    expect(decoded.isDraft).toBe(true);
  });

  it("rejects an unknown state / outcome rather than defaulting it", () => {
    const attempt = Schema.decodeUnknownResult(PrInfoSchema);
    expect(
      Result.isFailure(
        attempt({
          number: 9,
          title: "t",
          url: "u",
          state: "draft",
          checks: null,
          isDraft: false,
        }),
      ),
    ).toBe(true);
    expect(
      Result.isFailure(
        attempt({
          number: 9,
          title: "t",
          url: "u",
          state: "open",
          checks: null,
          checkRuns: [{ name: "gate", outcome: "skipped" }],
          isDraft: false,
        }),
      ),
    ).toBe(true);
    expect(
      Result.isFailure(
        attempt({
          number: 9,
          title: "t",
          url: "u",
          state: "open",
          checks: null,
          reviewDecision: "approved",
          isDraft: false,
        }),
      ),
    ).toBe(true);
    expect(
      Result.isFailure(
        attempt({
          number: 9,
          title: "t",
          url: "u",
          state: "open",
          checks: null,
          mergeStateStatus: "clean",
          isDraft: false,
        }),
      ),
    ).toBe(true);
  });
});

describe("enum wire vocabularies", () => {
  it("decodes every CheckStatus member", () => {
    const decode = Schema.decodeUnknownSync(CheckStatusSchema);
    expect(["pending", "pass", "fail"].map((m) => decode(m))).toEqual([
      "pending",
      "pass",
      "fail",
    ]);
  });

  it("decodes every PrState member", () => {
    const decode = Schema.decodeUnknownSync(PrStateSchema);
    expect(["open", "closed", "merged"].map((m) => decode(m))).toEqual([
      "open",
      "closed",
      "merged",
    ]);
  });

  it("rejects an unknown member", () => {
    expect(
      Result.isFailure(Schema.decodeUnknownResult(PrStateSchema)("draft")),
    ).toBe(true);
  });

  it("decodes every ReviewDecision member and rejects a friendlier spelling", () => {
    const decode = Schema.decodeUnknownSync(ReviewDecisionSchema);
    expect(
      ["APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED"].map((m) =>
        decode(m),
      ),
    ).toEqual(["APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED"]);
    expect(
      Result.isFailure(
        Schema.decodeUnknownResult(ReviewDecisionSchema)("approved"),
      ),
    ).toBe(true);
  });

  it("decodes every MergeStateStatus member and rejects a friendlier spelling", () => {
    const decode = Schema.decodeUnknownSync(MergeStateStatusSchema);
    const members = [
      "BEHIND",
      "BLOCKED",
      "CLEAN",
      "DIRTY",
      "DRAFT",
      "HAS_HOOKS",
      "UNKNOWN",
      "UNSTABLE",
    ] as const;
    expect(members.map((m) => decode(m))).toEqual([...members]);
    expect(
      Result.isFailure(
        Schema.decodeUnknownResult(MergeStateStatusSchema)("clean"),
      ),
    ).toBe(true);
  });
});

describe("foldCheckOutcomes", () => {
  it("returns null for an empty list (no checks configured)", () => {
    expect(foldCheckOutcomes([])).toBeNull();
  });

  it("is pass only when every check passed", () => {
    expect(foldCheckOutcomes(["pass", "pass"])).toBe("pass");
  });

  it("is fail when any check failed (fail is terminal)", () => {
    expect(foldCheckOutcomes(["pass", "fail", "pending"])).toBe("fail");
  });

  it("is pending when something is pending and nothing failed (sticky)", () => {
    expect(foldCheckOutcomes(["pass", "pending", "pass"])).toBe("pending");
  });
});

describe("prResultEqual", () => {
  const pr: PrInfo = {
    number: 1,
    title: "test",
    url: "https://github.com/test/test/pull/1",
    state: "open",
    checks: "pass",
    checkRuns: [],
    reviewDecision: null,
    mergeStateStatus: "UNKNOWN",
    headSha: "4f21a9c",
    isDraft: true,
  };
  const ok: PrResult = { kind: "ok", value: pr };

  it("returns true for identical references", () => {
    expect(prResultEqual(ok, ok)).toBe(true);
  });

  it("returns true for both pending", () => {
    expect(prResultEqual({ kind: "pending" }, { kind: "pending" })).toBe(true);
  });

  it("returns true for both absent", () => {
    expect(prResultEqual({ kind: "absent" }, { kind: "absent" })).toBe(true);
  });

  it("returns false when kinds differ", () => {
    expect(prResultEqual(ok, { kind: "absent" })).toBe(false);
    expect(prResultEqual({ kind: "pending" }, { kind: "absent" })).toBe(false);
  });

  it("returns true for equal ok values", () => {
    expect(prResultEqual(ok, { kind: "ok", value: { ...pr } })).toBe(true);
  });

  it.each([
    { field: "number", value: 2 },
    { field: "title", value: "other" },
    { field: "state", value: "merged" },
    { field: "checks", value: "fail" },
    { field: "reviewDecision", value: "APPROVED" },
    { field: "mergeStateStatus", value: "CLEAN" },
    // A PUSH: every other field can read the same and it is still new news.
    { field: "headSha", value: "9b7e3d1" },
    // MARKED READY: often the only thing that moves, and the news a
    // consumer waiting for review must not lose to the dedup.
    { field: "isDraft", value: false },
  ] as const)("detects different $field", ({ field, value }) => {
    expect(
      prResultEqual(ok, { kind: "ok", value: { ...pr, [field]: value } }),
    ).toBe(false);
  });

  it("compares unavailable by tagged source (provider + code)", () => {
    const a: PrResult = {
      kind: "unavailable",
      source: { provider: "gh", code: "not-installed" },
    };
    const b: PrResult = {
      kind: "unavailable",
      source: { provider: "gh", code: "not-installed" },
    };
    const c: PrResult = {
      kind: "unavailable",
      source: { provider: "gh", code: "not-authenticated" },
    };
    expect(prResultEqual(a, b)).toBe(true);
    expect(prResultEqual(a, c)).toBe(false);
  });
});
