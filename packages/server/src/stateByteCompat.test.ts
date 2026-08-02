/**
 * BYTE-LEVEL fixtures for the conf store — `~/.config/kolu/state.json`, the
 * DISK-highest-compat-risk format in the repo (`recon/zod.md` hit list).
 *
 * The zod→Effect Schema swap must not move one byte of it. `kolu-common` already
 * pins each DOMAIN schema's encoded form (`surfaceByteCompat.test.ts` for
 * `preferences` / `viewerMode`, `hostKey.test.ts` for `hosts`). What lives HERE is
 * what only `state.ts` owns:
 *
 *  1. the AGGREGATE bytes — the exact `state.json` `conf` writes for a full
 *     persisted state, asserted as a literal STRING (not decode-equality), against
 *     a real `Conf` under a temp dir rather than a schema round trip, because the
 *     file is the artifact a user's install actually carries;
 *  2. the MIGRATION LADDER — a legacy 1.30 / 1.32 / 1.34-era blob walked through
 *     the exported ladder bodies, with the resulting bytes pinned AND the result
 *     proved decodable by the live `PreferencesSchema`. A ladder step that stopped
 *     producing a schema-valid record used to surface as a wire validation failure
 *     at the first client connect (#1237); here it is a unit failure.
 *
 * `PersistedStateSchema` is deliberately unexported (`.claude/rules/state.md`), so
 * nothing below reaches for it: the aggregate is pinned at the FILE, and the
 * per-domain decode is pinned through the same exported schemas `state.ts`
 * composes.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Conf from "conf";
import { Result, Schema, type SchemaAST } from "effect";
import { PersistedHostsSchema } from "kolu-common/hostKey";
import {
  DEFAULT_PREFERENCES,
  PreferencesPatchSchema,
  PreferencesSchema,
  ViewerModeSchema,
} from "kolu-common/surface";
import { afterEach, describe, expect, it } from "vitest";
import {
  migratePreferences_1_30_0,
  migratePreferences_1_32_0,
  migratePreferences_1_34_0,
} from "./state.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/** A real `Conf` with `state.ts`'s own construction options, under a fresh temp
 *  dir — so the bytes asserted are the ones conf really writes, key order and
 *  indentation included. */
function makeStore(): Conf<Record<string, unknown>> {
  const dir = mkdtempSync(join(tmpdir(), "kolu-state-bytes-"));
  dirs.push(dir);
  return new Conf<Record<string, unknown>>({
    cwd: dir,
    projectVersion: "1.36.0",
    configFileMode: 0o600,
    defaults: {
      preferences: DEFAULT_PREFERENCES,
      hosts: [],
      viewerMode: "dark",
    },
  });
}

const accepts = <T, E>(schema: Schema.Codec<T, E>, value: unknown): boolean =>
  Result.isSuccess(Schema.decodeUnknownResult(schema)(value));

describe("the persisted state file — aggregate bytes", () => {
  it("a fresh install writes exactly the default state", () => {
    const store = makeStore();
    // Touch the store so conf materializes the file with its merged defaults.
    store.set("viewerMode", "dark");
    expect(readFileSync(store.path, "utf8")).toBe(
      `{
\t"preferences": {
\t\t"seenTips": [],
\t\t"startupTips": true,
\t\t"newTerminalTheme": "shuffle",
\t\t"newTerminalCollapsed": false,
\t\t"shuffleBehavior": "auto",
\t\t"scrollLock": true,
\t\t"attentionAlerts": true,
\t\t"colorScheme": "dark",
\t\t"terminalRenderer": "auto",
\t\t"rightPanel": {
\t\t\t"size": 0.25,
\t\t\t"codeTabTreeSize": 0.35
\t\t}
\t},
\t"hosts": [],
\t"viewerMode": "dark"
}`,
    );
  });

  it("a POPULATED state round-trips byte-for-byte through the three domain schemas", () => {
    const store = makeStore();
    store.set("preferences", {
      ...DEFAULT_PREFERENCES,
      seenTips: ["shuffle", "ports"],
      colorScheme: "light",
      terminalRenderer: "webgl",
      rightPanel: { size: 0.4, codeTabTreeSize: 0.5 },
    });
    store.set("hosts", ["remote:zest", "remote:srid@box"]);
    store.set("viewerMode", "light");

    const onDisk = JSON.parse(readFileSync(store.path, "utf8")) as Record<
      string,
      unknown
    >;
    // Every domain value the file carries DECODES, and re-encodes to the SAME
    // bytes it was read as — the round trip the migration is allowed to change
    // nothing about.
    for (const [key, schema] of [
      ["preferences", PreferencesSchema],
      ["hosts", PersistedHostsSchema],
      ["viewerMode", ViewerModeSchema],
    ] as const) {
      const decoded = Schema.decodeUnknownSync(schema)(onDisk[key]);
      expect(JSON.stringify(Schema.encodeUnknownSync(schema)(decoded))).toBe(
        JSON.stringify(onDisk[key]),
      );
    }
    expect(JSON.stringify(onDisk.hosts)).toBe(
      '["remote:zest","remote:srid@box"]',
    );
    expect(JSON.stringify(onDisk.viewerMode)).toBe('"light"');
  });

  it("REJECTS a store whose preferences lost a required field", () => {
    // conf is fail-fast on an unparseable file but NOT on a parseable-invalid one;
    // that is precisely what the boot-time decode in `state.ts` logs, and what
    // `getPersistedHosts` throws on. A missing field must not be tolerated into a
    // silent default — `Schema.Struct` has no optional key anywhere in this shape.
    const { colorScheme: _dropped, ...missing } = DEFAULT_PREFERENCES;
    expect(accepts(PreferencesSchema, missing)).toBe(false);
    // …and a hand-edited `hosts` that names the never-persisted local default
    // still fails LOUD rather than normalizing.
    expect(accepts(PersistedHostsSchema, ["local"])).toBe(false);
  });
});

describe("the migration ladder over legacy on-disk blobs", () => {
  it("a 1.30-era blob (shuffleTheme) migrates to bytes the live schema decodes", () => {
    // The literal shape a pre-1.30 install carries on disk: the retired
    // `shuffleTheme` boolean, no `newTerminalTheme` / `shuffleBehavior`, and the
    // pre-1.32 `rightPanel.collapsed` still sitting beside the geometry.
    const legacy = JSON.parse(
      `{"seenTips":["shuffle"],"startupTips":true,"shuffleTheme":false,` +
        `"scrollLock":true,"activityAlerts":false,"colorScheme":"dark",` +
        `"terminalRenderer":"auto","rightPanel":{"collapsed":true,"size":0.25,"codeTabTreeSize":0.35}}`,
    ) as Record<string, unknown>;

    // The ladder, in order — the same three bodies `state.ts`'s `migrations` map
    // calls at 1.30.0 / 1.32.0 / 1.34.0.
    const migrated = migratePreferences_1_34_0(
      migratePreferences_1_32_0(migratePreferences_1_30_0(legacy)),
    );

    // The BYTES the ladder produces, key order included (the 1.32 step's
    // `...DEFAULT_PREFERENCES, ...current` spread fixes it). Pinned as OBSERVED,
    // which is the whole job of a byte fixture: the Effect Schema swap must move
    // none of it.
    expect(JSON.stringify(migrated)).toBe(
      `{"seenTips":["shuffle"],"startupTips":true,"newTerminalTheme":"inherit",` +
        `"newTerminalCollapsed":true,"shuffleBehavior":"auto","scrollLock":true,` +
        `"attentionAlerts":true,"colorScheme":"dark","terminalRenderer":"auto",` +
        `"rightPanel":{"size":0.25,"codeTabTreeSize":0.35}}`,
    );
    // …and it DECODES. This is the assertion a drifted zod→Schema mapping breaks:
    // under zod a stray/missing key surfaced only at the first client connect
    // (#1237's EVENT_ITERATOR_VALIDATION_FAILED).
    expect(accepts(PreferencesSchema, migrated)).toBe(true);
    const decoded = Schema.decodeUnknownSync(PreferencesSchema)(migrated);
    // The 1.30 split and the 1.32 carry-forward both survive the walk.
    expect(decoded.newTerminalTheme).toBe("inherit");
    expect(decoded.newTerminalCollapsed).toBe(true);
    // PRE-EXISTING ladder behaviour, recorded rather than blessed: the 1.32 step
    // spreads today's `DEFAULT_PREFERENCES`, which already carries
    // `attentionAlerts: true`, so by the time the 1.34 rename runs the record
    // LOOKS already-migrated and drops the legacy `activityAlerts: false` instead
    // of carrying it forward. A pre-1.30 install therefore re-enables alerts on
    // upgrade. That is the shipped zod-era behaviour, byte-for-byte — this
    // migration must not change it, and a deliberate fix is its own change with
    // its own ladder step. (The rename itself, walked WITHOUT the 1.32 step, does
    // carry the OFF value — pinned in `state.test.ts`.)
    expect(decoded.attentionAlerts).toBe(true);
  });

  it("a 1.32-era blob (pre-rename alerts) migrates to decodable bytes", () => {
    const legacy = JSON.parse(
      `{"seenTips":[],"startupTips":true,"newTerminalTheme":"shuffle",` +
        `"newTerminalCollapsed":false,"shuffleBehavior":"auto","scrollLock":true,` +
        `"activityAlerts":true,"colorScheme":"dark","terminalRenderer":"dom",` +
        `"rightPanel":{"size":0.25,"codeTabTreeSize":0.35}}`,
    ) as Record<string, unknown>;
    const migrated = migratePreferences_1_34_0(legacy);
    expect(JSON.stringify(migrated)).toBe(
      `{"seenTips":[],"startupTips":true,"newTerminalTheme":"shuffle",` +
        `"newTerminalCollapsed":false,"shuffleBehavior":"auto","scrollLock":true,` +
        `"colorScheme":"dark","terminalRenderer":"dom","rightPanel":{"size":0.25,` +
        `"codeTabTreeSize":0.35},"attentionAlerts":true}`,
    );
    expect(accepts(PreferencesSchema, migrated)).toBe(true);
  });

  it("a 1.34-era blob is already current — the ladder is a no-op on its bytes", () => {
    const current = JSON.parse(JSON.stringify(DEFAULT_PREFERENCES)) as Record<
      string,
      unknown
    >;
    expect(JSON.stringify(migratePreferences_1_34_0(current))).toBe(
      JSON.stringify(DEFAULT_PREFERENCES),
    );
    expect(accepts(PreferencesSchema, migratePreferences_1_34_0(current))).toBe(
      true,
    );
  });

  it("the ladder is fed RAW stored JSON, which cannot carry an explicit `undefined`", () => {
    // PLAN #17's obligation for in-process decode callers is to strip explicit
    // `undefined` keys first, because `Schema.optionalKey` REJECTS a present
    // `undefined` where zod's `.optional()` accepted it. It has no site on this
    // format, and that is a property of the schema rather than an omission: the
    // disk shape has NO optional key at any level. This test is what makes that
    // claim falsifiable — add an `optionalKey` field to the persisted shape and it
    // fails, pointing at the strip that then becomes necessary.
    const optionalKeysOf = (fields: Record<string, { ast: SchemaAST.AST }>) =>
      Object.entries(fields)
        .filter(([, field]) => field.ast.context?.isOptional === true)
        .map(([name]) => name);
    expect(optionalKeysOf(PreferencesSchema.fields)).toEqual([]);
    // NON-VACUOUS: the same probe over the WIRE patch schema — the one place the
    // repo does use `optionalKey` — reports its keys, so an `[]` above is a fact
    // about the disk shape rather than a broken reflection.
    expect(
      optionalKeysOf(PreferencesPatchSchema.fields).length,
    ).toBeGreaterThan(0);
    // …and a value that DOES spell `undefined` is rejected rather than tolerated,
    // so a future in-process writer cannot slip one past the decode unnoticed.
    expect(
      accepts(PreferencesSchema, {
        ...DEFAULT_PREFERENCES,
        colorScheme: undefined,
      }),
    ).toBe(false);
  });
});
