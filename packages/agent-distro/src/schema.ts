/**
 * agent-distro on a host — the value shapes that cross the padi wire (and
 * kolu's own) for it, defined ONCE, here, beside the rest of kolu's contract
 * with upstream:
 *
 *   - `AgentDistroSetting` — what the binding kolu-server PUSHES into padi's
 *     memory-only `agentDistro` cell: whether new terminals get agent-distro's
 *     harnesses on their PATH, and the profiles stacked over them. It is the
 *     user's global Agents preference, verbatim (kolu-common builds its
 *     preference field from this schema); padi applies it at each NEW
 *     terminal's spawn.
 *   - `AgentDistroDeliveryReport` — what kolu-server tells a padi about the set
 *     (the package and the built profiles) it is delivering to that host
 *     (padi's `agentDistro.report`).
 *   - `AgentDistroStatus` — what padi REPORTS about its own host in the
 *     read-only `agentDistroStatus` cell: whether the setting's set is there
 *     yet, being delivered, or failed to arrive.
 *   - `AgentProfileResolution` — whether each profile of the setting builds,
 *     as kolu-server found when it locked and built it (kolu's own
 *     `agentProfiles` cell).
 *
 * Harnesses and profiles are disjoint: the switch is the harnesses, the list
 * is the profiles, and there is no bundle of the two. The cell DECLARATIONS
 * stay in `@kolu/padi-client` and kolu-common; only the value schemas live
 * here, so every reader shares one definition. This package depends on nothing
 * but `effect` and upstream's vocabulary for it (and `solid-js` only for the
 * logo component).
 */

import { Schema } from "effect";
import { ProfileInEffectSchema } from "./inEffect.ts";
import { DeliveredSetSchema, referencesOf, sameStack } from "./landing.ts";
import { AgentVersionSchema } from "./listing.ts";
import { AgentUpdateEventSchema, AgentUpdateRunSchema } from "./receipt.ts";

/** One profile reference, as the user wrote it: a flake reference
 *  (`github:juspay/skills`) or a path (absolute, or `~/`) to an
 *  `agent-distro.nix` or the directory holding one. kolu-server locks and
 *  builds it; nothing on a host reads it as a reference. */
const ProfileReference = Schema.String.check(Schema.isMinLength(1));

/** The Agents setting: the harnesses on or off, and the profiles stacked over
 *  them, bottom to top (`AI_PROFILE`'s order: later entries win where they
 *  overlap). An empty list is agent-distro's harnesses as they ship. A
 *  repository's own `agent-distro.nix` composes over the stack at launch, so
 *  what a terminal actually runs is asked of agent-distro after the spawn
 *  ({@link TerminalAgentsSchema}'s `effective`). */
export const AgentDistroSettingSchema = Schema.Struct({
  enabled: Schema.Boolean,
  profiles: Schema.Array(ProfileReference),
});

export type AgentDistroSetting = typeof AgentDistroSettingSchema.Type;

/** What padi holds between its boot and the binder's first push: OFF. A
 *  terminal opened in that window gets no agents (and no chip), which is the
 *  honest reading of "nobody has told this daemon the user's choice yet". */
export const DEFAULT_AGENT_DISTRO_SETTING: AgentDistroSetting = {
  enabled: false,
  profiles: [],
};

export function agentDistroSettingEqual(
  a: AgentDistroSetting,
  b: AgentDistroSetting,
): boolean {
  return a.enabled === b.enabled && sameStack(a.profiles, b.profiles);
}

/** A host's agent-distro state for the setting's stack — and what a terminal
 *  spawned there now gets: padi's spawn path reads the same answer. Every kind
 *  that is about a stack names it (`profiles`, the setting's references), so a
 *  reader can tell a status padi has not caught up from.
 *
 *   - `off` — the setting is off (or not pushed yet): new terminals get nothing.
 *   - `unavailable` — this padi was built without agent-distro (a from-source
 *     `just dev` / test daemon, which no wrapper baked): nothing to put on PATH.
 *   - `undelivered` — the host has no set for this stack, and kolu-server has
 *     not said it is delivering one. New terminals get no agents.
 *   - `downloading` — the host has no set for this stack yet and kolu-server
 *     has said it is delivering one. New terminals get no agents until it
 *     lands: a terminal never starts without a profile the setting names.
 *   - `ready` — new terminals get `set` (the package's exact store path and
 *     the built profiles, in stack order; its stack is theirs) — `delivering`
 *     while kolu-server delivers a newer set and this one keeps serving.
 *   - `error` — the delivery failed and nothing serves: `message` states its
 *     cause (kolu-server's words, with Nix's own line). New terminals get no
 *     agents.
 *
 *  A `Schema.Union` of structs discriminated on `kind`, like
 *  `NewTerminalPolicySchema`. */
export const AgentDistroStatusSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("off") }),
  Schema.Struct({ kind: Schema.Literal("unavailable") }),
  Schema.Struct({
    kind: Schema.Literal("undelivered"),
    profiles: Schema.Array(ProfileReference),
  }),
  Schema.Struct({
    kind: Schema.Literal("downloading"),
    profiles: Schema.Array(ProfileReference),
  }),
  Schema.Struct({
    kind: Schema.Literal("ready"),
    set: DeliveredSetSchema,
    delivering: Schema.Boolean,
  }),
  Schema.Struct({
    kind: Schema.Literal("error"),
    profiles: Schema.Array(ProfileReference),
    message: Schema.String,
  }),
]);

export type AgentDistroStatus = typeof AgentDistroStatusSchema.Type;

export const DEFAULT_AGENT_DISTRO_STATUS: AgentDistroStatus = { kind: "off" };

/** Structural equality — the cell's one wire dedup point. */
export function agentDistroStatusEqual(
  a: AgentDistroStatus,
  b: AgentDistroStatus,
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The stack a status is about — `undefined` for `off` and `unavailable`,
 *  which are about none; a ready set's is the one it was built for. */
export function statusStack(
  status: AgentDistroStatus,
): readonly string[] | undefined {
  if (status.kind === "ready") return referencesOf(status.set.profiles);
  return "profiles" in status ? status.profiles : undefined;
}

/** Whether one profile of the setting builds, as kolu-server last found when
 *  it locked and built it for its own system:
 *
 *   - `pending` — locking or building it now (a first fetch can take a while);
 *   - `resolved` — it built: the name and description it gives itself, and
 *     the revision it was locked to (absent for a path);
 *   - `failed` — it did not: Nix's or agent-distro's own words, on one line. */
export const AgentProfileResolutionSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("pending") }),
  Schema.Struct({
    kind: Schema.Literal("resolved"),
    name: Schema.String,
    description: Schema.String,
    rev: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({ kind: Schema.Literal("failed"), message: Schema.String }),
]);

export type AgentProfileResolution = typeof AgentProfileResolutionSchema.Type;

/** Every profile of the setting with its resolution, in stack order — the
 *  value of kolu-server's `agentProfiles` cell. Empty while agents are off or
 *  the stack is empty, and in a kolu that delivers nothing. */
export const AgentProfilesSchema = Schema.Array(
  Schema.Struct({
    reference: ProfileReference,
    resolution: AgentProfileResolutionSchema,
  }),
);

export type AgentProfiles = typeof AgentProfilesSchema.Type;

/** What a host keeps of its agent deliveries — the read-only
 *  `agentDistroReceipt` cell, published from the files on the host (which
 *  padi writes as each delivery lands):
 *
 *   - `serving`: the set new terminals there get now, and its package's
 *     harnesses (from its versions file) — absent when none serves;
 *   - `lastRun`: the last delivery, when there was one — how it ended, its
 *     words, and who wrote them (`by`: kolu's delivery, padi, or — read off
 *     the shared history log — agent-distro's updater or the log itself);
 *   - `events`: the last few history events, newest first;
 *   - `error`: why the files would not read, when they would not.
 *
 *  Never part of the status: a later delivery that fails leaves the set that
 *  serves working, so it shows here and in the logs, not as an error. */
export const AgentDistroReceiptSchema = Schema.Struct({
  /** The set new terminals get there now, with its harnesses. A reader pairs
   *  an update it sees in the status with the receipt for that same set
   *  (`./landing.ts`' `setKey`). */
  serving: Schema.optionalKey(
    Schema.Struct({
      set: DeliveredSetSchema,
      versions: Schema.Array(AgentVersionSchema),
    }),
  ),
  lastRun: Schema.optionalKey(AgentUpdateRunSchema),
  events: Schema.Array(AgentUpdateEventSchema),
  /** The host's files would not read (a format upstream changed, say):
   *  why, in padi's words. The rest is then empty — never a stale receipt
   *  passed off as current. */
  error: Schema.optionalKey(Schema.String),
});

export type AgentDistroReceipt = typeof AgentDistroReceiptSchema.Type;

/** Before padi has read anything: nothing serving, no runs. */
export const EMPTY_AGENT_DISTRO_RECEIPT: AgentDistroReceipt = {
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
 *  `agents`: present when padi put agent-distro's harnesses on the terminal's
 *  PATH at spawn, absent when it put none. Its package and profiles never
 *  change while the terminal runs (it pins the paths it started with); a
 *  respawn re-stamps it whole. `effective` is written once, after the spawn. */
export const TerminalAgentsSchema = Schema.Struct({
  /** The set the terminal got: the exact package store path whose `bin/`
   *  went on the PATH (the tile pill's short hash), and the built profiles
   *  exported as `AI_PROFILE`, in stack order (empty: none exported). */
  ...DeliveredSetSchema.fields,
  /** The profile in effect in this terminal, as agent-distro answered
   *  `--list --json` in its cwd and environment once it started (a repository's
   *  own `agent-distro.nix` composes over the stack). Absent until that
   *  answer, when it failed, and when no profile is in effect at all. */
  effective: Schema.optionalKey(ProfileInEffectSchema),
});

export type TerminalAgents = typeof TerminalAgentsSchema.Type;

/** What kolu-server tells a host's padi about delivering it the setting's set
 *  — the input of padi's `agentDistro.report` procedure. Each names the stack
 *  it is about (`profiles`, the setting's references in order; a landing's is
 *  its set's).
 *
 *   - `delivering` — a delivery to this host started;
 *   - `landed` — every path of `set` is valid in this host's store and
 *     rooted there: padi points `current` at the package, records the set,
 *     and new terminals get it. Its stack is the set's own;
 *   - `failed` — the delivery did not land: its cause in kolu-server's words.
 *     Whatever served keeps serving. */
export const AgentDistroDeliveryReportSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("delivering"),
    profiles: Schema.Array(ProfileReference),
  }),
  Schema.Struct({
    kind: Schema.Literal("landed"),
    set: DeliveredSetSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal("failed"),
    profiles: Schema.Array(ProfileReference),
    message: Schema.String,
  }),
]);

export type AgentDistroDeliveryReport =
  typeof AgentDistroDeliveryReportSchema.Type;
