/**
 * The agent's own account of who it is signed in as, over values.
 *
 * The payloads are the two pinned adapters' shapes — Claude Code's
 * `auth-status.js` and Codex's `AuthStatusMeta.ts` — plus the near misses that
 * decide whether the panel says something, says nothing, or says "not signed
 * in": three different things a person acts on differently.
 */

import { describe, expect, test } from "vitest";

import { identityIn } from "./identity.ts";

describe("who an agent says it is signed in as", () => {
  test("a subscription account, with the fields a person reads", () => {
    expect(
      identityIn({
        authStatus: {
          kind: "account",
          label: "Claude Max",
          account: {
            email: "you@example.com",
            organization: "Kolu",
            plan: "max",
          },
        },
      }),
    ).toEqual({
      kind: "account",
      label: "Claude Max",
      detail: null,
      account: { email: "you@example.com", organization: "Kolu", plan: "max" },
    });
  });

  test("a key or a gateway carries its second line and no account", () => {
    expect(
      identityIn({
        authStatus: {
          kind: "api_key",
          label: "Anthropic API key",
          detail: "apiKeyHelper",
        },
      }),
    ).toEqual({
      kind: "api_key",
      label: "Anthropic API key",
      detail: "apiKeyHelper",
      account: null,
    });
  });

  test("a known logged-out state is a payload, not silence", () => {
    // The distinction the whole feature rests on: `kind: "none"` means the
    // agent LOOKED and found nobody signed in; `null` means it did not say.
    expect(
      identityIn({ authStatus: { kind: "none", label: "Not logged in" } }),
    ).toEqual({
      kind: "none",
      label: "Not logged in",
      detail: null,
      account: null,
    });
  });

  test("a kind this build has no word for keeps its label", () => {
    // A sixth kind is a payload this client has not met, not a reason to say
    // "not reported". `kind: null` is the honest reading, and the label — the
    // one field the protocol promises — still reaches a person.
    expect(
      identityIn({
        authStatus: {
          kind: "sso",
          label: "Company single sign-on",
          account: { email: "a@b.c" },
        },
      }),
    ).toEqual({
      kind: null,
      label: "Company single sign-on",
      detail: null,
      account: { email: "a@b.c", organization: null, plan: null },
    });
  });

  test("an account with no readable field is no account", () => {
    expect(
      identityIn({
        authStatus: { kind: "account", label: "Claude", account: {} },
      }),
    ).toEqual({
      kind: "account",
      label: "Claude",
      detail: null,
      account: null,
    });
    expect(
      identityIn({
        authStatus: {
          kind: "account",
          label: "Claude",
          account: { email: 42, plan: "max" },
        },
      }),
    ).toEqual({
      kind: "account",
      label: "Claude",
      detail: null,
      account: { email: null, organization: null, plan: "max" },
    });
  });

  test("a payload that does not say who is not guessed at", () => {
    expect(identityIn({ authStatus: { kind: "account" } })).toBeNull();
    expect(
      identityIn({ authStatus: { kind: "account", label: "" } }),
    ).toBeNull();
    expect(
      identityIn({ authStatus: { kind: "account", label: "   " } }),
    ).toBeNull();
    expect(
      identityIn({ authStatus: { kind: "account", label: 7 } }),
    ).toBeNull();
    expect(identityIn({ authStatus: "Claude Max" })).toBeNull();
    expect(identityIn({})).toBeNull();
    expect(identityIn(null)).toBeNull();
    expect(identityIn(undefined)).toBeNull();
    expect(identityIn("nonsense")).toBeNull();
  });
});
