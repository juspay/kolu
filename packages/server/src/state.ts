import {
  chmodSync,
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Conf from "conf";
import { Result } from "effect";
import { openStateBackupRing } from "kolu-shared/state-backup";
import { log } from "./log.ts";
import { CONF_MIGRATIONS } from "./stateLadder.ts";
import {
  CONF_DEFAULTS,
  decodePersistedState,
  type PersistedState,
  type PersistedStateSchema,
  readPersistedRecord,
  SCHEMA_VERSION,
} from "./stateShape.ts";

const rawStateDir = process.env.KOLU_STATE_DIR;
if (!rawStateDir) {
  throw new Error(
    "KOLU_STATE_DIR must be set to an absolute directory. The nix-built " +
      "kolu wrapper, `pnpm dev`, and the test harness each set their own — " +
      "bare launches are rejected to avoid clobbering production state.",
  );
}

const stateDir: string = rawStateDir;

log.info({ path: stateDir }, "state directory");

export const stateBackupRing = openStateBackupRing(
  join(stateDir, "config.json"),
  log,
);

stateBackupRing.snapshot();

type OwnerOnlyStoreOptions = Omit<
  NonNullable<ConstructorParameters<typeof Conf<PersistedState>>[0]>,
  "configFileMode"
>;

function openOwnerOnlyStore(
  options: OwnerOnlyStoreOptions,
): Conf<PersistedState> {
  const opened = new Conf<PersistedState>({
    ...options,
    configFileMode: 0o600,
  });
  if (existsSync(opened.path)) chmodSync(opened.path, 0o600);
  return opened;
}

export const store = openOwnerOnlyStore({
  cwd: stateDir,
  projectVersion: SCHEMA_VERSION,
  defaults: CONF_DEFAULTS,
  migrations: CONF_MIGRATIONS,
});

const result = decodePersistedState(readPersistedRecord(store));
if (Result.isFailure(result)) {
  const summary = String(result.failure);
  log.error(
    { issue: summary, path: store.path },
    `Persisted state does not match schema (${summary}) at ${store.path}.`,
  );
}

export type DecodedStateBackup = typeof PersistedStateSchema.Type;

export function decodeStateBackup(
  raw: unknown,
  label: string,
): DecodedStateBackup {
  const scratch = mkdtempSync(join(tmpdir(), "kolu-state-backup-decode-"));
  try {
    writeFileSync(join(scratch, "config.json"), JSON.stringify(raw));
    const scratchStore = new Conf<PersistedState>({
      cwd: scratch,
      projectVersion: SCHEMA_VERSION,
      defaults: CONF_DEFAULTS,
      migrations: CONF_MIGRATIONS,
    });
    const decoded = decodePersistedState(readPersistedRecord(scratchStore));
    if (Result.isFailure(decoded)) {
      throw new Error(
        `state backup ${label} does not match the persisted schema after ` +
          `migration (${String(decoded.failure)})`,
      );
    }
    return decoded.success;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
