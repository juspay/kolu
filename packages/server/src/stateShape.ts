import type Conf from "conf";
import { Schema } from "effect";
import { PersistedHostsSchema } from "kolu-common/hostKey";
import {
  DEFAULT_PREFERENCES,
  PreferencesSchema,
  ViewerModeSchema,
} from "kolu-common/surface";
import {
  EMPTY_PERSISTED_CONDUCTOR,
  EMPTY_PERSISTED_MEMBERS,
  PersistedConductorSchema,
  PersistedMembersSchema,
  PersistedWorksSchema,
} from "kolu-conductor";

export const PersistedStateSchema = Schema.Struct({
  preferences: PreferencesSchema,
  hosts: PersistedHostsSchema,
  viewerMode: ViewerModeSchema,
  conductor: PersistedConductorSchema,
  works: PersistedWorksSchema,
  members: PersistedMembersSchema,
});

export type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export type PersistedState = Mutable<typeof PersistedStateSchema.Type>;

export const decodePersistedState =
  Schema.decodeUnknownResult(PersistedStateSchema);

export function readPersistedRecord(
  from: Conf<PersistedState>,
): Record<string, unknown> {
  return Object.fromEntries(
    (Object.keys(PersistedStateSchema.fields) as (keyof PersistedState)[]).map(
      (key) => [key, from.get(key)],
    ),
  );
}

/**
 * Schema version — bump this when adding migrations.
 * Must be valid semver. `conf` runs all migration handlers
 * whose keys are > the last-seen version and ≤ this value.
 */
export const SCHEMA_VERSION = "1.61.0";

export const TRANSCRIPT_FILE_VERSION = "1.59.0";

export const CONF_DEFAULTS: PersistedState = {
  preferences: DEFAULT_PREFERENCES,
  hosts: [],
  viewerMode: "dark",
  conductor: EMPTY_PERSISTED_CONDUCTOR,
  works: {},
  members: EMPTY_PERSISTED_MEMBERS,
};
