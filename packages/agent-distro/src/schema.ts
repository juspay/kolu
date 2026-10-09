/**
 * agent-distro on a host — the two value shapes that cross the padi wire for
 * it, defined ONCE, here, beside the rest of kolu's contract with upstream:
 *
 *   - `AgentDistroSetting` — what the binding kolu-server PUSHES into padi's
 *     memory-only `agentDistro` cell: whether new terminals get agent-distro's
 *     coding agents on their PATH, and which profile's. It is the user's global
 *     Agents preference, verbatim (kolu-common builds its preference field from
 *     this schema); padi applies it at each NEW terminal's spawn.
 *   - `AgentDistroStatus` — what padi REPORTS about its own host in the
 *     read-only `agentDistroStatus` cell: whether the selected profile's agents
 *     are there yet, being downloaded, or failed to arrive.
 *
 * The cell DECLARATIONS stay in `@kolu/padi-client` (padi's surface is its own);
 * only the value schemas live here, so padi-client, padi, kolu-common, the
 * server and the client all read one definition. This package depends on
 * nothing but `effect` for it (and `solid-js` only for the logo component).
 */

import { Schema } from "effect";
import { AgentUpdateEventSchema, AgentUpdateRunSchema } from "./history.ts";
import { ProfileInEffectSchema } from "./inEffect.ts";
import { DEFAULT_AGENT_PROFILE } from "./manifest.ts";
import { AgentVersionSchema } from "./versions.ts";

/** The Agents setting: on/off and the profile — the name of a bundle kolu
 *  ships, or anything else agent-distro reads as a profile (a flake reference
 *  such as `github:owner/repo`, a path to a directory holding an
 *  `agent-distro.nix`). kolu never resolves it: a terminal gets the bundle
 *  {@link bundleProfileOf} names, with the profile as its `AI_PROFILE`, and
 *  agent-distro's launcher resolves it. It is the FALLBACK profile — upstream
 *  prefers a repository's own `agent-distro.nix` over it — so what a terminal
 *  actually runs is asked of agent-distro after the spawn
 *  ({@link TerminalAgentsSchema}'s `effective`), and whether it resolves at all
 *  is asked once per setting ({@link AgentDistroResolvedSchema}). */
export const AgentDistroSettingSchema = Schema.Struct({
  enabled: Schema.Boolean,
  profile: Schema.String,
});

export type AgentDistroSetting = typeof AgentDistroSettingSchema.Type;

/** The bundle a terminal gets for `profile`: its own when `bundles` (the
 *  bundles this build ships, by name) has one, else the default bundle
 *  (`DEFAULT_AGENT_PROFILE`), whose launchers resolve `AI_PROFILE`
 *  themselves. Everything padi keeps per bundle (its
 *  download, its updates, its receipt files) is keyed by this; everything it
 *  PUBLISHES names `profile` as the user chose it. */
export function bundleProfileOf(
  profile: string,
  bundles: { has(name: string): boolean },
): string {
  return bundles.has(profile) ? profile : DEFAULT_AGENT_PROFILE;
}

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

/** Bytes fetched so far of the bundle being downloaded, from the updater's
 *  `--progress` lines (`./progress.ts`). Absent until the first. */
export const AgentDistroProgressSchema = Schema.Struct({
  done: Schema.Number,
  total: Schema.Number,
});

/** Why a host's download failed, typed so the remedy is worded in ONE place
 *  (`./status.ts`), never baked into padi's message:
 *
 *   - `nixMissing` — `nix` is not on padi's PATH on that host, so nothing can be
 *     fetched;
 *   - `updater` — agent-distro's updater ran and failed or skipped (its own
 *     words are the message). */
export const AgentDistroFailureReasonSchema = Schema.Union([
  Schema.Literal("nixMissing"),
  Schema.Literal("updater"),
]);

export type AgentDistroFailureReason =
  typeof AgentDistroFailureReasonSchema.Type;

/** A host's agent-distro state for the CURRENTLY selected profile — and what a
 *  terminal spawned there now gets: padi's spawn path reads the same answer.
 *
 *   - `off` — the setting is off (or not pushed yet): new terminals get nothing.
 *   - `unavailable` — this padi was built without agent-distro (a from-source
 *     `just dev` / test daemon, which no wrapper baked): nothing to put on PATH.
 *   - `downloading` — the host is fetching the profile's bundle from the binary
 *     cache into its own store. New terminals get no agents until it lands.
 *   - `ready` — new terminals get `bundle` (the exact store path they pin).
 *     With `update`, the updater is running for this profile while `bundle`
 *     keeps serving: checking for a newer set, then downloading it (`progress`).
 *     New terminals keep getting `bundle` until the newer one has fully landed.
 *   - `error` — the download failed or was skipped: `reason` says which kind of
 *     failure, `message` states its cause (the updater's own words, e.g. "cache
 *     … not usable; add it to nix.settings …"). Neither carries the retry or the
 *     remedy — those are worded once, in `./status.ts`. New terminals get no
 *     agents; a bundle the updater landed but did not report stays unused, and
 *     the retry downloads again.
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
    update: Schema.optionalKey(
      Schema.Struct({
        progress: Schema.optionalKey(AgentDistroProgressSchema),
      }),
    ),
  }),
  Schema.Struct({
    kind: Schema.Literal("error"),
    profile: Schema.String,
    reason: AgentDistroFailureReasonSchema,
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
        b.kind === "ready" &&
        a.profile === b.profile &&
        a.bundle === b.bundle &&
        (a.update === undefined) === (b.update === undefined) &&
        a.update?.progress?.done === b.update?.progress?.done &&
        a.update?.progress?.total === b.update?.progress?.total
      );
    case "error":
      return (
        b.kind === "error" &&
        a.profile === b.profile &&
        a.reason === b.reason &&
        a.message === b.message
      );
    default:
      return a satisfies never;
  }
}

/** Whether the setting's profile resolves on this host — the read-only
 *  `agentDistroResolved` cell. Once per setting, padi asks the bundle's
 *  `agent-distro --list --json` with the profile as `AI_PROFILE`, from `$HOME`
 *  rather than any terminal's folder (`@kolu/agent-distro/inEffect`):
 *
 *   - `none` — nothing to ask: agents off, an unbaked padi, or no bundle on
 *     the host yet;
 *   - `pending` — asked, no answer yet (resolving a reference may fetch it);
 *   - `resolved` — the profile agent-distro answered, by its own name and
 *     description;
 *   - `failed` — agent-distro could not resolve it: `message` is its own
 *     words, on one line. The setting stands either way — the launcher meets
 *     the same failure in each new terminal, and a repository's own
 *     `agent-distro.nix` still wins there. */
export const AgentDistroResolvedSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("none") }),
  Schema.Struct({ kind: Schema.Literal("pending"), profile: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal("resolved"),
    profile: Schema.String,
    name: Schema.String,
    description: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("failed"),
    profile: Schema.String,
    message: Schema.String,
  }),
]);

export type AgentDistroResolved = typeof AgentDistroResolvedSchema.Type;

export const DEFAULT_AGENT_DISTRO_RESOLVED: AgentDistroResolved = {
  kind: "none",
};

/** Structural equality — the resolved cell's dedup point. */
export function agentDistroResolvedEqual(
  a: AgentDistroResolved,
  b: AgentDistroResolved,
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** What a host keeps of agent-distro's updates for the selected profile — the
 *  read-only `agentDistroReceipt` cell, published from the updater's own files:
 *
 *   - `profile`: which profile it is about;
 *   - `bundle`: the bundle those versions are of;
 *   - `versions`: the agents in the bundle the host serves now, from the
 *     bundle's versions file (empty when it serves none);
 *   - `lastRun`: the last update run, when there was one — how it ended, its
 *     words, and who wrote them (`by`: the updater, or padi);
 *   - `events`: the last few history events, newest first;
 *   - `running`: every profile with a run in flight on the host — any
 *     profile, not only this one (a run outlives a switch away from it);
 *   - `error`: why the files would not read, when they would not.
 *
 *  Never part of the status: a background update that fails or skips leaves
 *  the agents working, so it shows here and in padi's log, not as an error. */
export const AgentDistroReceiptSchema = Schema.Struct({
  /** The profile this receipt is about — the setting's (empty before the
   *  first push). A reader drops a receipt for another profile as one padi
   *  has not caught up from. */
  profile: Schema.String,
  /** The bundle new terminals get there now, whose versions these are —
   *  absent when none serves. A reader pairs an update it sees in the status
   *  with the receipt for that same bundle. */
  bundle: Schema.optionalKey(Schema.String),
  versions: Schema.Array(AgentVersionSchema),
  lastRun: Schema.optionalKey(AgentUpdateRunSchema),
  events: Schema.Array(AgentUpdateEventSchema),
  /** Every profile with a run of the updater in flight on the host (a first
   *  download or an update), whichever profile is selected. */
  running: Schema.Array(Schema.String),
  /** The updater's files would not read (a format upstream changed, say):
   *  why, in padi's words. The rest is then empty — never a stale receipt
   *  passed off as current. */
  error: Schema.optionalKey(Schema.String),
});

export type AgentDistroReceipt = typeof AgentDistroReceiptSchema.Type;

/** Before padi has read anything: no versions, no runs. */
export const EMPTY_AGENT_DISTRO_RECEIPT: AgentDistroReceipt = {
  profile: "",
  versions: [],
  events: [],
  running: [],
};

/** Structural equality — the receipt cell's dedup point. */
export function agentDistroReceiptEqual(
  a: AgentDistroReceipt,
  b: AgentDistroReceipt,
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The agents a terminal was spawned with — ONE optional field on its record,
 *  `agents`: present when padi put agent-distro's agents on the terminal's
 *  PATH at spawn, absent when it put none. Its profile and bundle never change
 *  while the terminal runs (it pins the bundle it started with); a respawn
 *  re-stamps it whole. `effective` is written once, after the spawn. */
export const TerminalAgentsSchema = Schema.Struct({
  /** The setting's profile at spawn, exported to the terminal as
   *  `AI_PROFILE`. */
  profile: Schema.String.check(Schema.isMinLength(1)),
  /** The exact bundle store path whose `bin/` went on the PATH — the tile
   *  pill's short hash. */
  bundle: Schema.String.check(Schema.isMinLength(1)),
  /** The profile in effect in this terminal, as agent-distro answered
   *  `--list --json` in its cwd and environment once it started (a repository's
   *  own `agent-distro.nix` wins over the setting). Absent until that answer,
   *  and for good when it failed or the bundle predates the field — the pill
   *  then names `profile`. */
  effective: Schema.optionalKey(ProfileInEffectSchema),
});

export type TerminalAgents = typeof TerminalAgentsSchema.Type;
