/**
 * BYTE-level fixtures for the app surface's DISK and WIRE formats.
 *
 * `preferences` and `viewerMode` are fields of the on-disk conf store
 * (`PersistedStateSchema` in `packages/server/src/state.ts`, `SCHEMA_VERSION`
 * + its migration ladder), so a change to their encoded shape is a change to
 * every existing install's state file. `KoluForward` / `DaemonInventory` /
 * `PadiEntryFailure` ride the wire between the server and every browser tab.
 *
 * The assertions are on the encoded JSON **string**, not on decode-equality: a
 * schema change that reorders keys, renames a discriminant, or starts omitting
 * (or emitting) a key would pass a `toEqual` and still eat a user's preferences
 * or dark-screen a host card.
 */

import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  DaemonInventorySchema,
  DEFAULT_DAEMON_INVENTORY,
  DEFAULT_PREFERENCES,
  KoluForwardSchema,
  PreferencesPatchSchema,
  PreferencesSchema,
  ViewerModeSchema,
} from "./surface.ts";
import { PadiEntryFailureSchema } from "./surfacesWithPadi.ts";

/** Encode through the schema and serialize — the only assertion that catches a
 *  key reorder, a dropped key, or a renamed discriminant. */
const encodeJson =
  <T, E>(schema: Schema.Codec<T, E>) =>
  (value: T): string =>
    JSON.stringify(Schema.encodeSync(schema)(value));

describe("Preferences — the conf store's `preferences` field", () => {
  it("encodes the shipped defaults to the exact stored bytes", () => {
    expect(encodeJson(PreferencesSchema)(DEFAULT_PREFERENCES)).toBe(
      '{"seenTips":[],"startupTips":true,"newTerminalTheme":"shuffle",' +
        '"newTerminalCollapsed":false,"shuffleBehavior":"auto","scrollLock":true,' +
        '"attentionAlerts":true,"colorScheme":"dark","terminalRenderer":"auto",' +
        '"rightPanel":{"size":0.25,"codeTabTreeSize":0.35}}',
    );
  });

  it("round-trips a stored record byte-for-byte", () => {
    const stored =
      '{"seenTips":["ports","dock"],"startupTips":false,"newTerminalTheme":"inherit",' +
      '"newTerminalCollapsed":true,"shuffleBehavior":"colourful","scrollLock":false,' +
      '"attentionAlerts":false,"colorScheme":"system","terminalRenderer":"webgl",' +
      '"rightPanel":{"size":0.4,"codeTabTreeSize":0.5}}';
    const decoded = Schema.decodeUnknownSync(PreferencesSchema)(
      JSON.parse(stored),
    );
    expect(encodeJson(PreferencesSchema)(decoded)).toBe(stored);
  });

  it("DROPS an unknown key rather than rejecting — the migration ladder's tolerance", () => {
    // `state.ts`'s ladder spreads `DEFAULT_PREFERENCES` over an old record and
    // strips retired keys; a record that still carries one (a downgrade, a
    // hand-edit) must load, exactly as zod's default `strip` object behaved.
    const decoded = Schema.decodeUnknownSync(PreferencesSchema)({
      ...DEFAULT_PREFERENCES,
      shuffleTheme: true,
    });
    expect("shuffleTheme" in decoded).toBe(false);
    expect(encodeJson(PreferencesSchema)(decoded)).toBe(
      encodeJson(PreferencesSchema)(DEFAULT_PREFERENCES),
    );
  });

  it("REJECTS a missing field — every preference is required on disk", () => {
    const { scrollLock: _dropped, ...missing } = DEFAULT_PREFERENCES;
    expect(
      Result.isSuccess(Schema.decodeUnknownResult(PreferencesSchema)(missing)),
    ).toBe(false);
  });
});

describe("ViewerMode — the conf store's `viewerMode` field", () => {
  it("encodes as a bare JSON string, both readings", () => {
    expect(encodeJson(ViewerModeSchema)("dark")).toBe('"dark"');
    expect(encodeJson(ViewerModeSchema)("light")).toBe('"light"');
  });

  it("rejects anything outside the two readings (no `system` here — that is a preference)", () => {
    expect(
      Result.isSuccess(Schema.decodeUnknownResult(ViewerModeSchema)("system")),
    ).toBe(false);
  });
});

describe("PreferencesPatch — the local-authority write shape", () => {
  it("keeps an unset field ABSENT, not null (#17: optionalKey, never optional)", () => {
    const decoded = Schema.decodeUnknownSync(PreferencesPatchSchema)({
      scrollLock: false,
    });
    expect(encodeJson(PreferencesPatchSchema)(decoded)).toBe(
      '{"scrollLock":false}',
    );
    expect("colorScheme" in decoded).toBe(false);
  });

  it("carries a DEEP-partial rightPanel — one nested field, no siblings invented", () => {
    const decoded = Schema.decodeUnknownSync(PreferencesPatchSchema)({
      rightPanel: { size: 0.3 },
    });
    expect(encodeJson(PreferencesPatchSchema)(decoded)).toBe(
      '{"rightPanel":{"size":0.3}}',
    );
  });

  it("accepts the empty patch", () => {
    expect(encodeJson(PreferencesPatchSchema)({})).toBe("{}");
  });

  it("REJECTS an explicit `undefined` value — an absent key is the only spelling", () => {
    // The #17 consequence, pinned rather than discovered: `optionalKey` admits a
    // MISSING key only, so an in-process caller that builds `{ scrollLock:
    // undefined }` must strip the key before decoding.
    expect(
      Result.isSuccess(
        Schema.decodeUnknownResult(PreferencesPatchSchema)({
          scrollLock: undefined,
        }),
      ),
    ).toBe(false);
  });
});

describe("KoluForward — the `forwards` cell's row", () => {
  it("encodes a remote row to the exact wire bytes, host sum included", () => {
    expect(
      encodeJson(KoluForwardSchema)({
        key: "remote:pu-dev:5173",
        host: { kind: "remote", target: "pu-dev" },
        remotePort: 5173,
        localPort: 61003,
        origin: "auto",
        createdAt: 1_700_000_000_000,
      }),
    ).toBe(
      '{"key":"remote:pu-dev:5173","host":{"kind":"remote","target":"pu-dev"},' +
        '"remotePort":5173,"localPort":61003,"origin":"auto",' +
        '"createdAt":1700000000000}',
    );
  });

  it("encodes a local row with the object-shaped local key", () => {
    expect(
      encodeJson(KoluForwardSchema)({
        key: "local:5173",
        host: { kind: "local" },
        remotePort: 5173,
        localPort: 5173,
        origin: "manual",
        createdAt: 1,
      }),
    ).toBe(
      '{"key":"local:5173","host":{"kind":"local"},"remotePort":5173,' +
        '"localPort":5173,"origin":"manual","createdAt":1}',
    );
  });
});

describe("DaemonInventory — the dialogs' diagnostic readout", () => {
  it("encodes the honest pre-sample default", () => {
    expect(encodeJson(DaemonInventorySchema)(DEFAULT_DAEMON_INVENTORY)).toBe(
      '{"binding":{"kind":"local"},"boundPadi":null}',
    );
  });

  it("encodes a reported identity with its nulls PRESENT (they are values, not absences)", () => {
    expect(
      encodeJson(DaemonInventorySchema)({
        binding: { kind: "local" },
        boundPadi: {
          surfaceVersion: "1.2",
          buildCommit: null,
          convergence: null,
        },
      }),
    ).toBe(
      '{"binding":{"kind":"local"},"boundPadi":{"surfaceVersion":"1.2",' +
        '"buildCommit":null,"convergence":null}}',
    );
  });
});

describe("PadiEntryFailure — the host-down card's structural cause", () => {
  it("encodes the skew arm with the spread SkewVersionPair fields, in declaration order", () => {
    expect(
      encodeJson(PadiEntryFailureSchema)({
        cause: "contract-skew-refused",
        reason: "binder is older",
        running: "2.1",
        expected: "1.9",
      }),
    ).toBe(
      '{"cause":"contract-skew-refused","reason":"binder is older",' +
        '"running":"2.1","expected":"1.9"}',
    );
  });

  it("encodes a plain arm as cause + reason only", () => {
    expect(
      encodeJson(PadiEntryFailureSchema)({
        cause: "auth-required",
        reason: "ssh refused kolu's credentials",
      }),
    ).toBe(
      '{"cause":"auth-required","reason":"ssh refused kolu\'s credentials"}',
    );
  });

  it("REJECTS an unclassified cause — there is deliberately no catch-all arm", () => {
    expect(
      Result.isSuccess(
        Schema.decodeUnknownResult(PadiEntryFailureSchema)({
          cause: "other",
          reason: "?",
        }),
      ),
    ).toBe(false);
  });
});
