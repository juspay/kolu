/**
 * agent-distro on a host — the two facts that cross the padi wire for it.
 *
 *   - `AgentDistroSetting` — what the binding kolu-server PUSHES into padi's
 *     memory-only `agentDistro` cell: whether new terminals get agent-distro's
 *     coding agents on their PATH, and which profile's. It is the user's global
 *     Agents preference, verbatim; padi applies it at each NEW terminal's spawn.
 *   - `AgentDistroStatus` — what padi REPORTS about its own host in the
 *     read-only `agentDistroStatus` cell: whether the selected profile's agents
 *     are there yet, being downloaded, or failed to arrive.
 *
 * Declared here, not in `kolu-common`, for the seal reason `./newTerminalPolicy.ts`
 * gives: `padiSurface` references both, and `@kolu/padi` may not import
 * `kolu-common`. `kolu-common` builds its preference field from the same schema,
 * so the value kolu-server pushes is the value the user chose — one shape, no
 * translation step to drift.
 */

import { Schema } from "effect";

/** The Agents setting: on/off and the profile name. `profile` is checked against
 *  the profiles this padi's build knows (its baked updater listing) when the
 *  setting is written ON — an unknown name fails the write, it is never mapped
 *  to a different profile. */
export const AgentDistroSettingSchema = Schema.Struct({
  enabled: Schema.Boolean,
  profile: Schema.String,
});

export type AgentDistroSetting = typeof AgentDistroSettingSchema.Type;

/** What padi holds between its boot and the binder's first push: OFF. A
 *  terminal opened in that window gets no agents (and no chip), which is the
 *  honest reading of "nobody has told this daemon the user's choice yet". */
export const DEFAULT_AGENT_DISTRO_SETTING: AgentDistroSetting = {
  enabled: false,
  profile: "",
};

export function agentDistroSettingEqual(
  a: AgentDistroSetting,
  b: AgentDistroSetting,
): boolean {
  return a.enabled === b.enabled && a.profile === b.profile;
}

/** Bytes fetched so far of the bundle being downloaded. Present only when the
 *  updater reports them (see padi's `updaterProgress.ts`). */
export const AgentDistroProgressSchema = Schema.Struct({
  done: Schema.Number,
  total: Schema.Number,
});

/** A host's agent-distro state for the CURRENTLY selected profile.
 *
 *   - `off` — the setting is off (or not pushed yet): new terminals get nothing.
 *   - `unavailable` — this padi was built without agent-distro (a from-source
 *     `just dev` / test daemon, which no wrapper baked): nothing to put on PATH.
 *   - `downloading` — the host is fetching the profile's bundle from the binary
 *     cache into its own store. New terminals get no agents until it lands.
 *   - `ready` — new terminals get `bundle` (the exact store path they pin).
 *   - `error` — the download failed or was skipped; `message` is the updater's
 *     own words (e.g. "cache … not usable; add it to nix.settings …"). Nothing
 *     retries on its own; turning the setting off and on again tries again.
 *
 *  A `Schema.Union` of structs discriminated on `kind`, like
 *  `NewTerminalPolicySchema`. */
export const AgentDistroStatusSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("off") }),
  Schema.Struct({ kind: Schema.Literal("unavailable") }),
  Schema.Struct({
    kind: Schema.Literal("downloading"),
    profile: Schema.String,
    progress: Schema.optionalKey(AgentDistroProgressSchema),
  }),
  Schema.Struct({
    kind: Schema.Literal("ready"),
    profile: Schema.String,
    bundle: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("error"),
    profile: Schema.String,
    message: Schema.String,
  }),
]);

export type AgentDistroStatus = typeof AgentDistroStatusSchema.Type;

export const DEFAULT_AGENT_DISTRO_STATUS: AgentDistroStatus = { kind: "off" };

/** Structural equality — the cell's one wire dedup point. A progress tick that
 *  moved no byte count publishes nothing. */
export function agentDistroStatusEqual(
  a: AgentDistroStatus,
  b: AgentDistroStatus,
): boolean {
  switch (a.kind) {
    case "off":
    case "unavailable":
      return b.kind === a.kind;
    case "downloading":
      return (
        b.kind === "downloading" &&
        a.profile === b.profile &&
        a.progress?.done === b.progress?.done &&
        a.progress?.total === b.progress?.total
      );
    case "ready":
      return (
        b.kind === "ready" && a.profile === b.profile && a.bundle === b.bundle
      );
    case "error":
      return (
        b.kind === "error" && a.profile === b.profile && a.message === b.message
      );
    default:
      return a satisfies never;
  }
}

/** The short hash a tile's chip shows for a bundle: the first 8 characters of
 *  its store hash (`/nix/store/<hash>-name` → `<hash>[0..8]`). Not a store path
 *  (a from-source fixture, say) → the path's last segment, cut to 8. */
export function agentBundleShortHash(bundle: string): string {
  const base = bundle.split("/").filter(Boolean).at(-1) ?? bundle;
  return base.slice(0, 8);
}
