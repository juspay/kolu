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
import { AgentVersionSchema } from "./versions.ts";

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

/** What a host keeps of agent-distro's updates for the selected profile — the
 *  read-only `agentDistroReceipt` cell, published from the updater's own files:
 *
 *   - `profile`: which profile it is about;
 *   - `bundle`: the bundle those versions are of;
 *   - `versions`: the agents in the bundle the host serves now, from the
 *     bundle's versions file (empty when it serves none);
 *   - `lastRun`: the last update run, when there was one — how it ended and the
 *     updater's words;
 *   - `events`: the last few history events, newest first;
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
};

/** Structural equality — the receipt cell's dedup point. */
export function agentDistroReceiptEqual(
  a: AgentDistroReceipt,
  b: AgentDistroReceipt,
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The agents a terminal was spawned with — ONE optional field on its record,
 *  `agents`: present (both halves) when padi put agent-distro's agents on the
 *  terminal's PATH at spawn, absent when it put none. A running terminal never
 *  changes it (it pins the bundle it started with); a respawn re-stamps it
 *  whole. */
export const TerminalAgentsSchema = Schema.Struct({
  /** The profile whose agents went on the PATH. */
  profile: Schema.String.check(Schema.isMinLength(1)),
  /** The exact bundle store path whose `bin/` went on the PATH — the tile
   *  pill's short hash. */
  bundle: Schema.String.check(Schema.isMinLength(1)),
});

export type TerminalAgents = typeof TerminalAgentsSchema.Type;
