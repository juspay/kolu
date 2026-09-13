import { describe, expect, it } from "vitest";
import { type ParsedDeepLink, parseDeepLink } from "./deepLink";

// A real UUID (TerminalIdSchema = z.string().uuid()) and both host-key forms.
const ID = "550e8400-e29b-41d4-a716-446655440000";
const REMOTE = "remote:alice@box";

describe("parseDeepLink — the valid grammar, one row per family", () => {
  const valid: Array<[string, ParsedDeepLink]> = [
    ["#/h/local", { kind: "host", host: "local" }],
    [`#/h/${REMOTE}`, { kind: "host", host: REMOTE }],
    [`#/t/local/${ID}`, { kind: "terminal", host: "local", terminalId: ID }],
    [`#/t/${REMOTE}/${ID}`, { kind: "terminal", host: REMOTE, terminalId: ID }],
    [
      `#/t/local/${ID}/inspector`,
      { kind: "inspector", host: "local", terminalId: ID },
    ],
    [
      `#/t/local/${ID}/code?path=src/app.ts`,
      {
        kind: "code",
        host: "local",
        terminalId: ID,
        path: "src/app.ts",
        line: null,
      },
    ],
    [
      `#/t/local/${ID}/code?path=src/app.ts&line=42`,
      {
        kind: "code",
        host: "local",
        terminalId: ID,
        path: "src/app.ts",
        line: 42,
      },
    ],
    ["#/settings", { kind: "settings" }],
  ];

  it.each(valid)("parses %s", (hash, expected) => {
    expect(parseDeepLink(hash)).toEqual(expected);
  });

  it("accepts the hash without a leading '#'", () => {
    expect(parseDeepLink("/settings")).toEqual({ kind: "settings" });
  });

  it("URL-decodes a percent-encoded host segment (colon in remote:)", () => {
    expect(parseDeepLink(`#/h/remote%3Aalice%40box`)).toEqual({
      kind: "host",
      host: REMOTE,
    });
  });

  it("URL-decodes a percent-encoded code path", () => {
    const r = parseDeepLink(`#/t/local/${ID}/code?path=a%20b/c.ts&line=3`);
    expect(r).toEqual({
      kind: "code",
      host: "local",
      terminalId: ID,
      path: "a b/c.ts",
      line: 3,
    });
  });

  it("tolerates a stray query on a non-code route (route still valid)", () => {
    expect(parseDeepLink("#/h/local?utm=x")).toEqual({
      kind: "host",
      host: "local",
    });
  });
});

describe("parseDeepLink — 'none' (no route present, never a toast)", () => {
  // A root hash with an incidental query (link-decoration, a saved trailing `?`)
  // is a normal load, not a malformed route.
  it.each([
    "",
    "#",
    "#/",
    "/",
    "#/?utm=x",
    "#?x=1",
    "/?a=b",
  ])("treats %j as none", (hash) => {
    expect(parseDeepLink(hash)).toEqual({ kind: "none" });
  });
});

describe("parseDeepLink — 'invalid' (toast + home, never silent)", () => {
  const cases: Array<[string, string]> = [
    // bad host
    [`#/h/notahost`, "bad host key"],
    [`#/h/remote:`, "remote: with empty target"],
    [`#/t/nothost/${ID}`, "bad host in a terminal route"],
    // bad terminal id
    [`#/t/local/not-a-uuid`, "non-UUID terminal id"],
    [`#/t/local/1234`, "short non-UUID"],
    // bad line
    [`#/t/local/${ID}/code?path=x&line=0`, "line 0 is not positive"],
    [`#/t/local/${ID}/code?path=x&line=-3`, "negative line"],
    [`#/t/local/${ID}/code?path=x&line=1.5`, "decimal line"],
    [`#/t/local/${ID}/code?path=x&line=abc`, "non-numeric line"],
    // code without a path
    [`#/t/local/${ID}/code`, "code with no path"],
    [`#/t/local/${ID}/code?line=5`, "code path missing, line present"],
    // arity / unknown routes
    [`#/h`, "h with no host"],
    [`#/h/local/extra`, "h with extra segment"],
    [`#/t/local`, "t with no terminal id"],
    [`#/t/local/${ID}/bogus`, "unknown terminal sub-route"],
    [`#/t/local/${ID}/code/extra`, "extra segment after code"],
    [`#/settings/extra`, "settings with extra segment"],
    [`#/unknown`, "unknown family"],
    // malformed slashes — repeated / trailing empty segments are not the grammar
    [`#/h//local`, "double slash before host"],
    [`#/settings/`, "trailing slash on settings"],
    [`#/h/local/`, "trailing slash on host"],
    [`#/t//local/${ID}`, "double slash in a terminal route"],
    [`#/t/local/${ID}/`, "trailing slash on a terminal route"],
    // line must be a positive SAFE integer
    [
      `#/t/local/${ID}/code?path=x&line=99999999999999999999`,
      "line overflows to Infinity",
    ],
    [
      `#/t/local/${ID}/code?path=x&line=9007199254740992`,
      "line past MAX_SAFE_INTEGER",
    ],
  ];

  it.each(cases)("rejects %s (%s)", (hash) => {
    const r = parseDeepLink(hash);
    expect(r.kind).toBe("invalid");
  });
});
