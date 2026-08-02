/** Byte-level wire pins for the gh arm of the closed `PrUnavailableSource`
 *  union. These shapes travel over the surface socket between processes of
 *  different builds and are matched on the client (`surface.ts`), so the
 *  ENCODED JSON — key names, key ORDER, and the exact code spellings — is the
 *  contract, not merely the decoded value. Assert the string, not the object. */

import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  GH_PROVIDER,
  GhUnavailableCodeSchema,
  type GhUnavailableCode,
  GhUnavailableSchema,
  reasonForGhCode,
} from "./schemas.ts";

const encode = Schema.encodeSync(GhUnavailableSchema);
const decode = Schema.decodeUnknownSync(GhUnavailableSchema);

/** Every code the union admits, with the byte-exact JSON it must produce. */
const WIRE_FIXTURES: ReadonlyArray<{
  code: GhUnavailableCode;
  json: string;
}> = [
  { code: "not-installed", json: '{"provider":"gh","code":"not-installed"}' },
  {
    code: "not-authenticated",
    json: '{"provider":"gh","code":"not-authenticated"}',
  },
  { code: "timed-out", json: '{"provider":"gh","code":"timed-out"}' },
  { code: "unknown", json: '{"provider":"gh","code":"unknown"}' },
];

describe("GhUnavailableSchema wire bytes", () => {
  it.each(WIRE_FIXTURES)("encodes $code to $json", ({ code, json }) => {
    expect(JSON.stringify(encode({ provider: GH_PROVIDER, code }))).toBe(json);
  });

  it.each(WIRE_FIXTURES)("decodes the $code payload", ({ code, json }) => {
    expect(decode(JSON.parse(json))).toEqual({ provider: "gh", code });
  });

  it("keeps the provider tag spelled 'gh'", () => {
    // The persisted discriminant, deliberately distinct from the adapter's
    // in-process `kind: "github"` — changing it is a wire break.
    expect(GH_PROVIDER).toBe("gh");
  });

  it("tolerates unknown extra keys from a newer peer", () => {
    // Rolling-deploy policy: a newer server may add fields to this arm; an
    // older client must still decode it, dropping what it doesn't know.
    expect(
      decode({ provider: "gh", code: "unknown", detail: "from the future" }),
    ).toEqual({ provider: "gh", code: "unknown" });
  });

  it("rejects an unrecognized code rather than passing it through", () => {
    expect(() => decode({ provider: "gh", code: "not-a-real-code" })).toThrow();
  });

  it("rejects another forge's provider tag", () => {
    expect(() => decode({ provider: "gl", code: "unknown" })).toThrow();
  });
});

describe("GhUnavailableCodeSchema", () => {
  const decodeCode = Schema.decodeUnknownSync(GhUnavailableCodeSchema);

  it.each(WIRE_FIXTURES)("decodes $code", ({ code }) => {
    expect(decodeCode(code)).toBe(code);
  });

  it("has display text for every code", () => {
    expect(WIRE_FIXTURES.map(({ code }) => reasonForGhCode(code))).toEqual([
      "gh: not installed",
      "gh: not authenticated",
      "gh: timed out",
      "gh: unknown error",
    ]);
  });
});
