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
  migratePreferences_1_37_0,
  migratePreferences_1_38_0,
  migratePreferences_1_39_0,
  migratePreferences_1_40_0,
  migratePreferences_1_41_0,
  migratePreferences_1_43_0,
} from "./stateLadder.ts";
import {
  EMPTY_PERSISTED_CONDUCTOR,
  PersistedConductorSchema,
  PersistedMembersSchema,
  PersistedWorksSchema,
} from "kolu-conductor";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function makeStore(): Conf<Record<string, unknown>> {
  const dir = mkdtempSync(join(tmpdir(), "kolu-state-bytes-"));
  dirs.push(dir);
  return new Conf<Record<string, unknown>>({
    cwd: dir,
    projectVersion: "1.49.0",
    configFileMode: 0o600,
    defaults: {
      preferences: DEFAULT_PREFERENCES,
      hosts: [],
      viewerMode: "dark",
      conductor: EMPTY_PERSISTED_CONDUCTOR,
      works: {},
      members: {},
    },
  });
}

const accepts = <T, E>(schema: Schema.Codec<T, E>, value: unknown): boolean =>
  Result.isSuccess(Schema.decodeUnknownResult(schema)(value));

describe("the persisted state file — aggregate bytes", () => {
  it("a fresh install writes exactly the default state", () => {
    const store = makeStore();
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
\t\t},
\t\t"agentDistro": null,
\t\t"agentProfilesRecent": [],
\t\t"tipBarCollapsed": false,
\t\t"hostOrder": []
\t},
\t"hosts": [],
\t"viewerMode": "dark",
\t"conductor": {
\t\t"sessionId": null,
\t\t"cwd": "",
\t\t"model": null,
\t\t"fleet": [],
\t\t"taught": false
\t},
\t"works": {},
\t"members": {}
}`,
    );
  });

  it("a POPULATED state round-trips byte-for-byte through every domain schema", () => {
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
    store.set("conductor", {
      sessionId: "sess-live",
      cwd: "/home/tester",
      model: "claude-sonnet-4",
      fleet: ["local/11111111-1111-4111-8111-111111111111"],
      taught: true,
    });
    store.set("works", {
      "branch:local/%2Fsrv%2Frepo/fix-the-parser": {
        key: {
          kind: "branch",
          host: "local",
          repo: "/srv/repo",
          branch: "fix-the-parser",
        },
        title: "fix the parser",
        startedAt: "2026-01-01T00:00:00.000Z",
        decisions: [],
        events: [],
        state: { kind: "open" },
      },
    });
    store.set("members", {
      "local/11111111-1111-4111-8111-111111111111": {
        work: "branch:local/%2Fsrv%2Frepo/fix-the-parser",
        role: "implementor",
        joinedAt: "2026-01-01T00:00:00.000Z",
        worktree: { kind: "unread" },
        watch: {
          name: "fix the parser",
          agent: "claude-code",
          told: "stopped",
          joined: "created-run",
          spoken: true,
          ran: true,
        },
      },
    });

    const onDisk = JSON.parse(readFileSync(store.path, "utf8")) as Record<
      string,
      unknown
    >;
    for (const [key, schema] of [
      ["preferences", PreferencesSchema],
      ["hosts", PersistedHostsSchema],
      ["viewerMode", ViewerModeSchema],
      ["conductor", PersistedConductorSchema],
      ["works", PersistedWorksSchema],
      ["members", PersistedMembersSchema],
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
    expect(JSON.stringify(onDisk.conductor)).toBe(
      '{"sessionId":"sess-live","cwd":"/home/tester","model":"claude-sonnet-4",' +
        '"fleet":["local/11111111-1111-4111-8111-111111111111"],"taught":true}',
    );
    expect(JSON.stringify(onDisk.members)).toBe(
      '{"local/11111111-1111-4111-8111-111111111111":' +
        '{"work":"branch:local/%2Fsrv%2Frepo/fix-the-parser",' +
        '"role":"implementor","joinedAt":"2026-01-01T00:00:00.000Z",' +
        '"worktree":{"kind":"unread"},"watch":{"name":"fix the parser",' +
        '"agent":"claude-code","told":"stopped","joined":"created-run",' +
        '"spoken":true,"ran":true}}}',
    );
  });

  it("REJECTS a store whose preferences lost a required field", () => {
    const { colorScheme: _dropped, ...missing } = DEFAULT_PREFERENCES;
    expect(accepts(PreferencesSchema, missing)).toBe(false);
    expect(accepts(PersistedHostsSchema, ["local"])).toBe(false);
  });
});

describe("the migration ladder over legacy on-disk blobs", () => {
  it("a 1.30-era blob (shuffleTheme) migrates to bytes the live schema decodes", () => {
    const legacy = JSON.parse(
      `{"seenTips":["shuffle"],"startupTips":true,"shuffleTheme":false,` +
        `"scrollLock":true,"activityAlerts":false,"colorScheme":"dark",` +
        `"terminalRenderer":"auto","rightPanel":{"collapsed":true,"size":0.25,"codeTabTreeSize":0.35}}`,
    ) as Record<string, unknown>;

    const migrated = migratePreferences_1_43_0(
      migratePreferences_1_41_0(
        migratePreferences_1_40_0(
          migratePreferences_1_39_0(
            migratePreferences_1_38_0(
              migratePreferences_1_37_0(
                migratePreferences_1_34_0(
                  migratePreferences_1_32_0(migratePreferences_1_30_0(legacy)),
                ),
              ),
            ),
          ),
        ),
      ),
    );

    expect(JSON.stringify(migrated)).toBe(
      `{"seenTips":["shuffle"],"startupTips":true,"newTerminalTheme":"inherit",` +
        `"newTerminalCollapsed":true,"shuffleBehavior":"auto","scrollLock":true,` +
        `"attentionAlerts":false,"colorScheme":"dark","terminalRenderer":"auto",` +
        `"rightPanel":{"size":0.25,"codeTabTreeSize":0.35},` +
        `"agentDistro":null,"agentProfilesRecent":[],"tipBarCollapsed":false,` +
        `"hostOrder":[]}`,
    );
    expect(accepts(PreferencesSchema, migrated)).toBe(true);
    const decoded = Schema.decodeUnknownSync(PreferencesSchema)(migrated);
    expect(decoded.newTerminalTheme).toBe("inherit");
    expect(decoded.newTerminalCollapsed).toBe(true);
    expect(decoded.attentionAlerts).toBe(false);
  });

  it("a 1.32-era blob (pre-rename alerts) migrates to decodable bytes", () => {
    const legacy = JSON.parse(
      `{"seenTips":[],"startupTips":true,"newTerminalTheme":"shuffle",` +
        `"newTerminalCollapsed":false,"shuffleBehavior":"auto","scrollLock":true,` +
        `"activityAlerts":true,"colorScheme":"dark","terminalRenderer":"dom",` +
        `"rightPanel":{"size":0.25,"codeTabTreeSize":0.35}}`,
    ) as Record<string, unknown>;
    const migrated = migratePreferences_1_43_0(
      migratePreferences_1_41_0(
        migratePreferences_1_40_0(
          migratePreferences_1_39_0(
            migratePreferences_1_38_0(
              migratePreferences_1_37_0(migratePreferences_1_34_0(legacy)),
            ),
          ),
        ),
      ),
    );
    expect(JSON.stringify(migrated)).toBe(
      `{"seenTips":[],"startupTips":true,"newTerminalTheme":"shuffle",` +
        `"newTerminalCollapsed":false,"shuffleBehavior":"auto","scrollLock":true,` +
        `"colorScheme":"dark","terminalRenderer":"dom","rightPanel":{"size":0.25,` +
        `"codeTabTreeSize":0.35},"attentionAlerts":true,` +
        `"agentDistro":null,"tipBarCollapsed":false,"agentProfilesRecent":[],` +
        `"hostOrder":[]}`,
    );
    expect(accepts(PreferencesSchema, migrated)).toBe(true);
  });

  it("the 1.37 rung seeds the Agents default (off) and never resets a stored choice", () => {
    const pre = JSON.parse(JSON.stringify(DEFAULT_PREFERENCES)) as Record<
      string,
      unknown
    >;
    delete pre.agentDistro;
    delete pre.tipBarCollapsed;
    expect(JSON.stringify(migratePreferences_1_37_0(pre))).toBe(
      JSON.stringify({
        ...pre,
        agentDistro: { enabled: false, profile: "vanilla" },
      }),
    );
    expect(
      (migratePreferences_1_37_0(pre).agentDistro as { enabled: boolean })
        .enabled,
    ).toBe(false);
    const chosen = {
      ...DEFAULT_PREFERENCES,
      agentDistro: { enabled: true, profile: "juspay" },
    };
    expect(migratePreferences_1_37_0(chosen)).toEqual(chosen);
  });

  it("the 1.38 rung turns an Off record into never chosen, keeps On, and decodes", () => {
    const off = {
      ...DEFAULT_PREFERENCES,
      agentDistro: { enabled: false, profile: "vanilla" },
    };
    expect(JSON.stringify(migratePreferences_1_38_0(off))).toBe(
      JSON.stringify(DEFAULT_PREFERENCES),
    );
    expect(accepts(PreferencesSchema, migratePreferences_1_38_0(off))).toBe(
      true,
    );
    const on = {
      ...DEFAULT_PREFERENCES,
      agentDistro: { enabled: true, profile: "juspay" },
    };
    expect(migratePreferences_1_38_0(on)).toEqual(on);
    expect(
      accepts(
        PreferencesSchema,
        migratePreferences_1_41_0(
          migratePreferences_1_40_0(migratePreferences_1_39_0(on)),
        ),
      ),
    ).toBe(true);
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
    const optionalKeysOf = (fields: Record<string, { ast: SchemaAST.AST }>) =>
      Object.entries(fields)
        .filter(([, field]) => field.ast.context?.isOptional === true)
        .map(([name]) => name);
    expect(optionalKeysOf(PreferencesSchema.fields)).toEqual([]);
    expect(
      optionalKeysOf(PreferencesPatchSchema.fields).length,
    ).toBeGreaterThan(0);
    expect(
      accepts(PreferencesSchema, {
        ...DEFAULT_PREFERENCES,
        colorScheme: undefined,
      }),
    ).toBe(false);
  });
});
