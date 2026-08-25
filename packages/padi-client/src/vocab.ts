/**
 * `@kolu/padi-client/surface` terminal VOCABULARY — the kolu-specific terminal-domain
 * schemas, records, and pure helpers the padi daemon (the terminal-domain
 * AUTHORITY) owns. These EXTEND the generic awareness base owned by
 * `@kolu/terminal-vocab/schema` (the `TerminalSnapshot` / agent / PR / memory
 * primitives) with kolu's `location`, client/UI fields, the active|sleeping|
 * parked discriminant, session persistence, and the daemon-status axis.
 *
 * They lived in `kolu-common/surface` while padi was still being carved out of
 * `packages/server`; the arrow now points the right way — `@kolu/padi` owns its
 * vocabulary and the app (kolu-common, client, server) imports it FROM here. Kept
 * BROWSER-SAFE (no `node:` imports) so the client can import the schemas via
 * `@kolu/padi-client/surface`.
 */

import type { WireSchema } from "@kolu/surface/define";
import type { DaemonLifetimeInfo } from "@kolu/surface-daemon";
import {
  ENDPOINT_STATES,
  type EndpointState,
} from "@kolu/surface-daemon-supervisor/states";
import {
  AgentKindSchema,
  AgentMemorySchema,
  type ProcessRss,
  ProcessRssSchema,
  RestoreTargetSchema,
  seedMemory,
  type TerminalId,
  TerminalIdSchema,
  type TerminalSnapshot,
  TerminalSnapshotSchema,
} from "@kolu/terminal-vocab/schema";
import { exactRestoreTarget } from "anyagent/cli";
import { type PrInfo, prValue } from "anyforge/schemas";
import { Effect, Result, Schema, Struct } from "effect";
import {
  CanvasLayoutSchema,
  RightPanelPerTerminalStateSchema,
  SubPanelStateSchema,
} from "./chromeVocab.ts";

// The UI-CHROME vocabulary (canvas layout · sub-panel · Code-tab views ·
// right-panel state, plus their presentation helpers) lives in the sibling
// `./chromeVocab.ts` now (W4 ledger L17) — a chrome-axis volatility distinct from
// this module's PTY-lifecycle / session-persistence axis. The terminal-metadata
// schemas below consume the three chrome schemas above; the arrow points one way.

/**
 * Where a terminal's endpoint lives — a closed sum, not a host-id string.
 *
 * `{ kind: "local" }` is the in-process PTY (this kolu-server). `{ kind:
 * "remote", hostId }` is a dialed host (kaval-sessions). Modelling the local
 * case as a distinct *variant* — rather than a reserved `"local"` string in
 * the same namespace as remote host ids — makes a whole bug class
 * unrepresentable: a remote host that happens to be named `local` in
 * `~/.ssh/config` is `{ kind: "remote", hostId: "local" }`, which can never
 * be confused with the in-process endpoint `{ kind: "local" }`. `hostId`
 * matches the rest of the system's host-identity spelling (`getHostSession`,
 * the daemon-status keys). `hostId` is `.min(1)` — an empty remote hostId is
 * not a value {@link encodeHostLocation}/{@link decodeHostLocation} can
 * round-trip (the codec's wire form for it, `"remote:"`, collides with no
 * hostId at all and `decodeHostLocation` already throws on it) — mirrors
 * kolu-common/hostKey's `HostKeySchema.target` min-length-1 fix for the
 * same shape of bug.
 */
export const HostLocationSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("local") }),
  Schema.Struct({
    kind: Schema.Literal("remote"),
    hostId: Schema.String.check(Schema.isMinLength(1)),
  }),
]);

export type HostLocation = typeof HostLocationSchema.Type;

/** The in-process endpoint's location — the singleton `{ kind: "local" }`.
 *  `location` is never mutated after spawn (a terminal does not migrate
 *  hosts), so sharing this one value across every local terminal is safe and
 *  saves re-spelling the literal at each spawn/restore site. Frozen so the
 *  "never mutated" invariant is enforced at runtime, not just by convention:
 *  an accidental in-place write throws instead of silently aliasing every
 *  local terminal's metadata. */
export const LOCAL_LOCATION: HostLocation = Object.freeze({
  kind: "local",
} as const);

/** The `"remote:"` wire prefix for a `HostLocation`'s encoded form — guarantees a
 *  remote host whose `hostId` happens to be literally `"local"` encodes to
 *  `"remote:local"`, never colliding with the bare `"local"` key the in-process
 *  endpoint reports under (exactly the bug class {@link HostLocationSchema}'s doc
 *  above calls out, made unconstructible-as-local by the prefix rather than left to
 *  convention). Mirrors kolu-common/hostKey's `encodeHostKey`/`decodeHostKey`
 *  discipline — a SEPARATE codec for a SEPARATE axis (padi's daemon-status host,
 *  never the map key a browser tab selects). */
const REMOTE_LOCATION_WIRE_PREFIX = "remote:";

/** ENCODE — the canonical wire form of a `HostLocation`: `"local"` for the
 *  in-process endpoint, `"remote:" + hostId` for a dialed host. This is the key
 *  format padi's `daemonStatus` collection is keyed by — the sum lives in the
 *  TYPES ({@link HostLocation}), this codec is the encode half at the wire
 *  boundary (the collection key stays a plain string). Sole producer of the
 *  string {@link decodeHostLocation} accepts. */
export function encodeHostLocation(l: HostLocation): string {
  return l.kind === "local"
    ? "local"
    : `${REMOTE_LOCATION_WIRE_PREFIX}${l.hostId}`;
}

/** DECODE — the canonical wire form's inverse: `"local"` → `{ kind: "local" }`,
 *  `"remote:<hostId>"` → `{ kind: "remote", hostId }` (an empty hostId after the
 *  prefix is rejected). Anything else is not a value this codec ever produced —
 *  THROW loudly rather than guess a meaning for it (a corrupt/hand-edited key).
 *  Use this ONLY for a value that already passed through `encodeHostLocation`
 *  (a `daemonStatus` collection key) — never for a raw scanned/dialed hostId
 *  string, which constructs `{ kind: "remote", hostId }` directly (the separate
 *  human/discovery-input boundary, mirroring `parseHostInput`'s split from
 *  `decodeHostKey`). */
export function decodeHostLocation(s: string): HostLocation {
  if (s === "local") return LOCAL_LOCATION;
  if (s.startsWith(REMOTE_LOCATION_WIRE_PREFIX)) {
    const hostId = s.slice(REMOTE_LOCATION_WIRE_PREFIX.length);
    if (hostId.length > 0) return { kind: "remote", hostId };
  }
  throw new Error(
    `decodeHostLocation: "${s}" is not a canonical host location (expected "local" or "remote:<hostId>")`,
  );
}

// ── Terminal metadata fields, organized by who OBSERVES vs who REMEMBERS ──
//
// After the awareness-derive-store cutover (PR #1621) a terminal's metadata has
// three sources, joined at the client by `composeTerminalMetadata`:
//   - the OBSERVATION (`@kolu/terminal-vocab`'s `TerminalSnapshot`: cwd · git · pr
//     · agent · foreground) — what a memoryless host re-observes, served on the
//     `terminalWorkspace.snapshots` collection and held in `entry.snapshot`;
//   - kolu's AUTHORED record (`entry.meta`): the kolu-owned `location`, the
//     client/UI fields, the two REMEMBERED `AgentMemory` facts (`lastActivityAt`
//     /`lastAgentCommand`, written ONLY by the fold's `updateMemory`), and the
//     active|sleeping discriminant;
//   - the discriminant `state`/`sleptAt`.
//
// The producer cannot CONSTRUCT memory (its emit type is `TerminalSnapshot`), so "two
// writers of a remembered fact" is unrepresentable — the fence is the type, not a
// runtime mutator split. Adding a field: an OBSERVABLE one belongs in
// `TerminalSnapshot` (terminal-workspace); a kolu-REMEMBERED one in `AgentMemory`; a
// client-owned one in `ClientPersistedTerminalFieldsSchema` below.

/** The PERSISTED (restore-relevant) projection of an `TerminalSnapshot` — what rides to
 *  disk and what a DORMANT tile shows: `cwd · git · pr`. No churny `foreground`,
 *  and NO agent detail (lie-when-dead). `pr` is restore-relevant now (true-when-
 *  dead, persisted like `git`), so it survives on a dormant tile from HERE — the
 *  old frozen-`pr`-on-the-sleeping-arm special case is gone. The agent the terminal
 *  will RESUME rides the authored record's `restoreTarget` (the discriminated resume
 *  value, carrying the agent IDENTITY on its `exact` arm), not this projection — a
 *  full `TerminalSnapshot`'s live agent can't survive a server restart as anything but its
 *  identity, and that identity is the kolu-owned resume target, not a snapshot field.
 *  Decoding through `SavedTerminalSchema` reduces a full
 *  `TerminalSnapshot` to this at the disk-persist seam (it drops agent + foreground
 *  structurally). */
export const PersistedSnapshotSchema = TerminalSnapshotSchema.mapFields(
  Struct.pick(["cwd", "git", "pr"]),
);
export type PersistedSnapshot = typeof PersistedSnapshotSchema.Type;

/**
 * Client-persisted fields — written by client RPCs (via
 * `updateClientMetadata`, or direct mutation for paths that intentionally
 * skip the publish like sub-panel state) and round-tripped through disk.
 * The "client-writes + persisted" intersection, declared structurally.
 */
export const ClientPersistedTerminalFieldsSchema = Schema.Struct({
  themeName: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1))),
  /** If set, this terminal is a sub-terminal of the given parent. */
  parentId: Schema.optionalKey(Schema.String),
  /** Canvas tile position/size — client-reported, used for session restore. */
  canvasLayout: Schema.optionalKey(CanvasLayoutSchema),
  /** Sub-panel collapsed/size state — client-reported, used for session restore. */
  subPanel: Schema.optionalKey(SubPanelStateSchema),
  /** Right-panel per-terminal state — client-reported. Holds the fields
   *  that are *about* the terminal's task: whether the panel is showing
   *  (`collapsed`), the active tab, the code sub-mode, and the per-mode file
   *  selection — so the panel follows the terminal (#959). Only the panel
   *  width + Code-tab tree split stay on `preferences.rightPanel` (viewer
   *  density taste, not per-terminal task state). */
  rightPanel: Schema.optionalKey(RightPanelPerTerminalStateSchema),
  /** User-set freeform annotation — multiline markdown. The first line
   *  doubles as a glanceable tag (rendered as a chip next to the repo
   *  name and painted onto the dock rail swatch); the full body shows
   *  in the canvas-tile top-border pill, the dock-awaiting card, the
   *  workspace switcher card, and the intent editor. Empty / undefined
   *  collapses every render site to its no-intent shape. */
  intent: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1))),
});

/**
 * Client write fence — the mutator passed to `updateClientMetadata` is
 * narrowed to this shape, so RPC handlers cannot accidentally overwrite
 * provider-owned state. Exactly the client-persisted base.
 */
export const TerminalClientMetadataSchema = ClientPersistedTerminalFieldsSchema;

// ── The active | sleeping sum ─────────────────────────────────────────
//
// A terminal is a discriminated union on `state`. An ACTIVE terminal carries the
// FULL live `TerminalSnapshot` (agent detail + foreground); a SLEEPING terminal carries
// only the restore-relevant `PersistedSnapshot` (its PTY/xterm/agent released,
// so the live detail is stale) plus `sleptAt`. Both arms carry the AUTHORED record
// (location + memory + client fields).
//
// `state` and `sleptAt` are persisted DISCRIMINANT fields, composed ABOVE the
// observation/authored split: a flat `sleptAt` would leak onto the active arm, and
// `state` must gate the live overlay. Presence consumers (canvas, dock, minimap,
// arrange, cycle, switcher) read the union; any consumer that touches a live field
// (full agent / foreground) must first narrow `state === "active"`. `state` never
// crosses the awareness wire (kaval never sees a sleeping arm).

const ActiveDiscriminantSchema = Schema.Struct({
  state: Schema.Literal("active"),
});
const SleepingDiscriminantSchema = Schema.Struct({
  state: Schema.Literal("sleeping"),
  /** Epoch-millis the terminal was put to sleep. The sleeping arm's analogue
   *  of the live overlay — the one scalar an active terminal doesn't carry. The
   *  frozen-`pr` field that used to live here is GONE: `pr` is restore-relevant
   *  now, so it rides the persisted observation and survives on the dormant tile
   *  from there (no special case). */
  sleptAt: Schema.Number,
});

// ── The AUTHORED family — what rides `entry.meta` after the cutover ───────
//
// The terminal record is bisected: the OBSERVATION (cwd · git · pr · agent ·
// foreground) rides the registry entry's own `awareness` field, folded by kolu
// from the producer's stream. What rides `entry.meta` is the AUTHORED record: the
// kolu-owned `location`, the client/UI fields, the two REMEMBERED `AgentMemory`
// facts (`lastActivityAt`/`lastAgentCommand`, written only by the fold's
// `updateMemory`), and the active|sleeping discriminant.
//
// The authored TYPE names no OBSERVED field, so `entry.meta.cwd = x` is a COMPILE
// ERROR — "two writers of the observation" is unrepresentable. The unified
// `TerminalMetadata` is recomposed from the two halves at the CLIENT read (and at
// disk persist) via `composeTerminalMetadata` (below).

/** kolu's server-written authored fields — `location` (set once at spawn), the two
 *  remembered `AgentMemory` facts, and the `restoreTarget` (all written by the
 *  fold's `updateMemory`). Memory is FLAT here, so the on-disk JSON path is
 *  unchanged and `composeTerminalMetadata` spreads it straight onto the joined
 *  record. */
//
// Every `.merge(X)` in this file is now a FIELD SPREAD — `Schema.Struct({
// ...A.fields, ...B.fields })` (the `recon/effect4.md` §5 cheat-sheet's
// translation). Spread order is declaration order, which is what the encoded
// JSON's key order follows, so the on-disk bytes are unchanged.
const KoluAuthoredServerFieldsSchema = Schema.Struct({
  /** Where this terminal's endpoint lives — `{ kind: "local" }` for an in-process
   *  PTY, `{ kind: "remote", hostId }` for a dialed host. Non-optional and explicit
   *  by construction: a terminal's host is the value of this field, never the
   *  *absence* of a host id, so any code that constructs a terminal's metadata must
   *  name its host (a dropped location is a compile error, not a silent local
   *  respawn against the wrong machine). Set once at spawn, never mutated. */
  location: HostLocationSchema,
  /** The fold-derived RESTORE TARGET — kolu's discriminated answer to "what does
   *  waking this terminal do?" (`{@link RestoreTargetSchema}`): `exact` resumes the
   *  EXACT conversation that was live by id (#1495), `none` wakes to a bare shell
   *  (#1492), `legacyMostRecent` resumes most-recent for migrated pre-1.29 records.
   *  Produced by `restoreTargetOf` and written by the fold's `updateMemory`; it
   *  rides the AUTHORED record (not the observation) because a server restart keeps
   *  only the agent's IDENTITY, never its lie-when-dead detail. ABSENT reads as
   *  `none` (a fresh terminal with no agent), never as "resume something" — the
   *  discriminant is what `resumeFormFor` switches on, so an absent field can't be
   *  misread as the most-recent fallback the old bare `resumeAgent` left ambiguous. */
  restoreTarget: Schema.optionalKey(RestoreTargetSchema),
  ...AgentMemorySchema.fields,
});

/** The authored record MINUS the active|sleeping discriminant — `location` +
 *  memory + `restoreTarget` + client/UI chrome. Exported so `padiSurface`'s
 *  `parked` arm (the padi plan of record, PR #1649) can be built from the same
 *  authored base the `active`/`sleeping` arms share, rather than a parallel copy. */
export const KoluAuthoredFieldsSchema = Schema.Struct({
  ...KoluAuthoredServerFieldsSchema.fields,
  ...ClientPersistedTerminalFieldsSchema.fields,
});

/** The authored ACTIVE arm — `location` + memory + client fields + `state:
 *  "active"`. No snapshot field. */
export const AuthoredActiveSchema = Schema.Struct({
  ...KoluAuthoredFieldsSchema.fields,
  ...ActiveDiscriminantSchema.fields,
});

/** The authored SLEEPING arm — `location` + memory + client fields + `sleptAt`.
 *  No snapshot field, and no frozen `pr`: `pr` is restore-relevant now and rides
 *  the persisted observation, so the dormant tile reads it from there. */
export const AuthoredSleepingSchema = Schema.Struct({
  ...KoluAuthoredFieldsSchema.fields,
  ...SleepingDiscriminantSchema.fields,
});

/** The `parked` discriminant — a reboot-killed ACTIVE record padi's boot
 *  reconcile parks (its PTY died with the host; the record survives so the
 *  restore card can bring it back). Distinct from `sleeping`: parked is PRODUCED
 *  at boot and NEVER persisted, and restores by re-spawning a FRESH active PTY,
 *  whereas sleeping is a deliberate dormant state that resumes its agent on wake.
 *  `parkedAt` is the ms-epoch padi parked the record. */
export const ParkedDiscriminantSchema = Schema.Struct({
  state: Schema.Literal("parked"),
  /** Epoch-millis padi parked this record at boot reconcile. */
  parkedAt: Schema.Number,
});

/** The authored PARKED arm — `location` + memory + client fields + the `parked`
 *  discriminant. No snapshot field. Built from the SAME `KoluAuthoredFields` base
 *  the active/sleeping arms share, so the three authored arms can't drift. It is
 *  NOT part of {@link AuthoredTerminalSchema} (which `composeTerminalMetadata` +
 *  disk persist consume — parked is never persisted): parked rides the registry
 *  as its own arm and is composed into the served `parked` value by an explicit
 *  branch, never by the two-arm compose. */
export const AuthoredParkedSchema = Schema.Struct({
  ...KoluAuthoredFieldsSchema.fields,
  ...ParkedDiscriminantSchema.fields,
});
export type AuthoredParkedTerminal = Authored<typeof AuthoredParkedSchema.Type>;

/** The authored terminal as a sum — `entry.meta`'s static type. Discriminated on
 *  `state`, naming no snapshot field. */
export const AuthoredTerminalSchema = Schema.Union([
  AuthoredActiveSchema,
  AuthoredSleepingSchema,
]);

/** The in-memory, top-level-MUTABLE view of a decoded record.
 *
 *  Effect's decoded `Struct.Type` is `readonly` on every field (zod's was not),
 *  and that is right for a WIRE/DISK value — a frame a consumer renders must not
 *  be edited under it. padi's REGISTRY is a different thing wearing the same
 *  shape: `entry.meta` is the authored record padi itself AUTHORS, and its
 *  chrome setters assign fields in place (one writer, by construction — the
 *  registry is the authority).
 *
 *  So the two roles get two names over one schema, rather than a schema-wide
 *  weakening that would hand every client a mutable frame. Homomorphic, so it
 *  distributes over the authored UNION and each arm keeps its discriminant;
 *  SHALLOW, because every write site assigns a whole field (`meta.rightPanel =
 *  state`), never reaches into one. */
type Authored<T> = { -readonly [K in keyof T]: T[K] };

export type AuthoredActiveTerminal = Authored<typeof AuthoredActiveSchema.Type>;
export type AuthoredSleepingTerminal = Authored<
  typeof AuthoredSleepingSchema.Type
>;
export type AuthoredTerminal = Authored<typeof AuthoredTerminalSchema.Type>;

/** An active terminal — the FULL live `TerminalSnapshot` joined with the authored
 *  active arm. The only live arm; narrowing `state === "active"` yields the full
 *  agent detail + foreground. */
export const ActiveTerminalSchema = Schema.Struct({
  ...TerminalSnapshotSchema.fields,
  ...AuthoredActiveSchema.fields,
});

/** A sleeping terminal — the restore-relevant `PersistedSnapshot` (agent
 *  identity, no foreground) joined with the authored sleeping arm. Its PTY/agent
 *  are released, so it carries only what survives the release. */
export const SleepingTerminalSchema = Schema.Struct({
  ...PersistedSnapshotSchema.fields,
  ...AuthoredSleepingSchema.fields,
});

/** The on-disk persisted core, both arms share — the `PersistedSnapshot` +
 *  the authored fields. The saved active arm adds `state: "active"`; the saved
 *  sleeping arm adds `sleptAt`. Both add `id`. */
const SavedPersistedCoreSchema = Schema.Struct({
  ...PersistedSnapshotSchema.fields,
  ...KoluAuthoredFieldsSchema.fields,
});

/**
 * The terminal as a sum — `Terminal = active | sleeping`, discriminated on
 * `state`. The shape the CLIENT reconstructs by joining the AUTHORED record
 * (`kolu.authored`) with the AWARENESS value (`terminalWorkspace.snapshots`) via
 * `composeTerminalMetadata` — it is never a server-served collection of its own.
 * Presence reads the union; liveness narrows to the `active` arm. Code that only
 * needs one half should import the sub-schema so the dependency is explicit.
 */
export const TerminalMetadataSchema = Schema.Union([
  ActiveTerminalSchema,
  SleepingTerminalSchema,
]);

/** The ONE sentence a create that failed to state its placement gets back.
 *
 *  It names BOTH spellings, because the whole failure mode is a caller who did
 *  not know there was a choice to make — "invalid input" would send them
 *  looking for a typo. Authored once and reused by every face that speaks this
 *  JSON: the wire schema annotates the field with it (so a decode refusal at
 *  padi says it), and `lifecycle_create`'s MCP tool inherits that same field, so
 *  an agent gets the identical sentence. The two CLI faces state the same rule in
 *  THEIR vocabulary (`--toplevel` / `--parent <id>`) — different spelling, same
 *  rule — and they agree by construction rather than by convention: both run
 *  `@kolu/padi/render`'s one `parsePlacementFlags`, whose branches and sentences
 *  are pinned in `cliClient/placementFlags.test.ts`. */
export const PLACEMENT_REQUIRED =
  'a create must state its `placement` — there is no default. Spell it `{"kind":"toplevel"}` for a tile of its own, or `{"kind":"child-of","parentId":"<terminal id>"}` to open it as a split inside that terminal. The canvas and the Dock read this edge as who-works-for-whom, so a guessed default would silently flatten the hierarchy.';

/**
 * WHERE a new terminal lands — a closed sum, not an optional parent id.
 *
 * `{ kind: "toplevel" }` is a tile of its own on the canvas. `{ kind:
 * "child-of", parentId }` is a split INSIDE that terminal's tile. Every create
 * names one; there is no third state and no default, for the same reason
 * {@link HostLocationSchema} has none: the absence of a fact is not a fact.
 *
 * Placement is semantically LOAD-BEARING, which is what earns it the sum. The
 * canvas paints a `child-of` terminal inside its parent's tile and a `toplevel`
 * one beside it; the Dock reads the same edge as *who works for whom*
 * (`SubTerminalRow`, `descendantsByRoot`). So a create that omits it is not
 * asking for a sensible fallback — it is declining to say something only the
 * caller knows, and the old `parentId?: optionalKey` answered that silence with
 * `toplevel`. That default is how an orchestrator spawned two days of reviewer
 * agents as top-level tiles when every one of them was a split: nothing failed,
 * nothing logged, the hierarchy just went flat. A required sum makes that
 * silence unspellable — at the wire (decode), in TypeScript (a missing property
 * is a compile error), and at `kolu create` (a refusal naming the rule).
 */
export const TerminalPlacementSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("toplevel") }),
  Schema.Struct({
    kind: Schema.Literal("child-of"),
    parentId: TerminalIdSchema,
  }),
]).annotate({ message: PLACEMENT_REQUIRED });

export type TerminalPlacement = typeof TerminalPlacementSchema.Type;

/** The top-level arm as a shared frozen singleton — the mirror of
 *  {@link LOCAL_LOCATION}. A placement is never mutated after the create reads
 *  it, so one value serves every top-level create instead of re-spelling the
 *  literal at each call site; frozen so an accidental in-place write throws
 *  rather than silently re-pointing every other caller's placement. */
export const TOPLEVEL_PLACEMENT: TerminalPlacement = Object.freeze({
  kind: "toplevel",
} as const);

/** Narrow a placement to the parent edge the registry stores.
 *
 *  The EDGE of the system states an intent (the sum above); the terminal RECORD
 *  stores `parentId: TerminalId | undefined`, because that is what the canvas
 *  tree walks. This is the ONE place the two meet, so "no parent" can only be
 *  produced by someone who wrote `toplevel` — never by a dropped field. */
export const parentIdOf = (
  placement: TerminalPlacement,
): TerminalId | undefined =>
  placement.kind === "child-of" ? placement.parentId : undefined;

/** The BASE create input — the client-owned chrome every ORDINARY create carries,
 *  and the exact shape the wire `lifecycle.create` accepts (`PadiCreateInputSchema`
 *  derives from this directly). Seeded onto the new terminal's `meta` before the first
 *  `terminal.list` yield, so a create can't race the canvas default-cascade effect
 *  (#642). It carries NO server-derived authored facts — a fresh terminal earns those
 *  from padi's own observation. Those three restore-only facts live in a SEPARATE
 *  shape below that only the restore path can spell (the type is the fence, not a
 *  convention). */
export const CreateTerminalInputSchema = Schema.Struct({
  themeName: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1))),
  canvasLayout: Schema.optionalKey(CanvasLayoutSchema),
  subPanel: Schema.optionalKey(SubPanelStateSchema),
  rightPanel: Schema.optionalKey(RightPanelPerTerminalStateSchema),
  intent: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1))),
});

/** The three server-derived authored facts a fresh create has NO business setting —
 *  `lastActivityAt`, `lastAgentCommand`, and the fold-derived `restoreTarget`. Session
 *  RESTORE is the one path with truth about their prior value (read from the saved
 *  blob), so ONLY `restoreSpawn` (terminals.ts) threads them, through its distinct
 *  `restoreOnly` parameter — an ordinary `createTerminal` can't name this shape at all.
 *
 *  `lastActivityAt` keeps recency ordering stable across a restart (without it a
 *  restored terminal resets to `0`). `lastAgentCommand` + `restoreTarget` bridge the
 *  agent-resume window: threading them onto the respawned terminal keeps restore's
 *  closing re-persist (`restoreSession`'s `saveSession(snapshotSession())`) from
 *  writing `none` over a resuming agent's id before the fold re-derives it — so a
 *  SECOND unclean death right after restore, or a resume that never lands, still finds
 *  the target on disk. */
export const RestoreOnlyMetadataSchema = Schema.Struct({
  lastActivityAt: Schema.optionalKey(Schema.Number),
  lastAgentCommand: Schema.optionalKey(Schema.String),
  restoreTarget: Schema.optionalKey(RestoreTargetSchema),
});

/** The FULL seed shape spawnPty accepts — the base chrome plus the restore-only facts.
 *  It is only ever CONSTRUCTED by the two constructors in terminals.ts (`createTerminal`
 *  passes just the base; `restoreSpawn` merges in `restoreOnly`), never spelled by an
 *  ordinary caller and never accepted at the wire. */
export const InitialTerminalMetadataSchema = Schema.Struct({
  ...CreateTerminalInputSchema.fields,
  ...RestoreOnlyMetadataSchema.fields,
});

// ── Terminal cell value + raw-procedure shared schemas ────────────────

/** Wire shape for a terminal's identity — the `id`+`pid` padiSurface's
 *  `lifecycle.create` / `kill` / `wake` return. Identity only; a terminal's
 *  metadata rides padi's `terminals` collection. */
export const TerminalInfoSchema = Schema.Struct({
  id: TerminalIdSchema,
  pid: Schema.Number,
});

/** The `terminalExit` event payload — the exit code. The event itself now rides
 *  `padiSurface` (its input key is padi's own `PadiTerminalIdInputSchema`); this
 *  output schema is shared so padi and any consumer agree on the wire shape. */
export const TerminalOnExitOutputSchema = Schema.Number;

// ── Activity feed sub-schemas ─────────────────────────────────────────

export const RecentRepoSchema = Schema.Struct({
  repoRoot: Schema.String,
  repoName: Schema.String,
  lastSeen: Schema.Number,
});

/** A normalized agent CLI invocation (e.g. "claude --model sonnet").
 *  Populated from OSC 633;E command marks emitted by kolu's preexec hook
 *  whenever the user runs a known agent binary in any terminal. */
export const RecentAgentSchema = Schema.Struct({
  /** Normalized command line — first token is the agent binary,
   *  followed by its stable flags. Prompt/message flags and trailing
   *  positional arguments are stripped so ephemeral prompt text does
   *  not pollute the MRU. */
  command: Schema.String,
  lastSeen: Schema.Number,
});

/** Server-derived activity feed: recent repos cd'd into and recent agent
 *  CLIs spotted via OSC 633;E. Server is sole writer; client is read-only. */
export const ActivityFeedSchema = Schema.Struct({
  recentRepos: Schema.Array(RecentRepoSchema),
  recentAgents: Schema.Array(RecentAgentSchema),
});

// ── Session persistence ───────────────────────────────────────────────

/**
 * On-disk snapshot of a terminal — the persisted projection of the `Terminal`
 * sum plus a stable `id`. Same discriminant as `TerminalMetadataSchema`, minus
 * the live overlay (live fields never ride to disk): an active saved record is
 * the persisted base + id; a sleeping one adds `sleptAt`. So a restored terminal
 * and a slept terminal are the same on-disk record, distinguished only by
 * `state` — session save emits one list and sleeping terminals join it. The
 * discriminant means a legacy record with no `state` key is rejected on read,
 * which `backfillTerminalState` repairs (`state: "active"`) — run by both the
 * `state.ts` 1.27.0 migration (persisted state) and the client import hatch
 * (`backfillSavedSession`, for an exported `kolu-session.json`).
 *
 * Within-group ordering is the array index; the server writes terminals
 * in `Map` insertion order (stable per ES2015) and restore replays that
 * order verbatim.
 */
const SavedTerminalIdSchema = Schema.Struct({
  /** Stable ID within this session (original terminal UUID at save time). */
  id: Schema.String,
});

/** The active arm of the on-disk record (persisted-observation base + authored +
 *  `state: "active"` + id) — the shape restore/adoption produce. The agent is its
 *  IDENTITY only (no lie-when-dead detail) and foreground is absent: the
 *  restore-relevant projection, not the full live `TerminalSnapshot`. Exported so the
 *  adoption round-trip test can assert it carries every persisted key. */
export const SavedActiveTerminalSchema = Schema.Struct({
  ...SavedPersistedCoreSchema.fields,
  ...ActiveDiscriminantSchema.fields,
  ...SavedTerminalIdSchema.fields,
});

/** The sleeping arm of the on-disk record (persisted-observation base + authored +
 *  `sleptAt` + id) — the shape a slept terminal persists. Named symmetrically with
 *  `SavedActiveTerminalSchema` so the saved sum reads as two equally-named arms. */
export const SavedSleepingTerminalSchema = Schema.Struct({
  ...SavedPersistedCoreSchema.fields,
  ...SleepingDiscriminantSchema.fields,
  ...SavedTerminalIdSchema.fields,
});

export const SavedTerminalSchema = Schema.Union([
  SavedActiveTerminalSchema,
  SavedSleepingTerminalSchema,
]);

export const SavedSessionSchema = Schema.Struct({
  terminals: Schema.Array(SavedTerminalSchema),
  /** Which terminal was active at save time. ONE absence spelling —
   *  `.nullable()` with a `null` default, not the redundant
   *  `.nullable().optional()` double-absence a prior type audit flagged: every
   *  writer here already states `null` explicitly (never omits the key) and
   *  every reader already normalizes with `?? null`, so a MISSING key and an
   *  explicit `null` were always the same domain fact wearing two spellings.
   *  The decoding default keeps decoding TOTAL over a legacy blob that omits
   *  the key (pre-dates this field) — the decoded type is a required `string |
   *  null`, never `undefined`. KEY-level (`withDecodingDefaultKey`, PLAN #17):
   *  a MISSING key backfills to `null`, an explicit `undefined` is REJECTED (a
   *  disk field is absent or present, never `undefined`), and encoding always
   *  emits the key — byte-identical to what zod's `.default(null)` produced.
   *  In-process callers that build a session object must therefore STRIP
   *  `undefined` keys rather than spell them. */
  activeTerminalId: Schema.NullOr(Schema.String).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(null)),
  ),
  savedAt: Schema.Number,
  /**
   * Host-stamped: ids of terminals that will resume an agent on restore.
   * Wire-only enrichment — never trusted from disk; the session cell recomputes
   * and stamps this on every serve. Optional so conf blobs and e2e fixtures
   * parse without it; the live host always stamps before the client reads.
   */
  resumableIds: Schema.optionalKey(Schema.Array(Schema.String)),
});

/** The client WRITE FENCE — the shape `updateClientMetadata`'s mutator sees.
 *  MUTABLE for the same reason the authored arms are (see {@link Authored}):
 *  this type exists to be assigned INTO, on padi's own registry record, by the
 *  one writer. Every other reading of these fields goes through the authored /
 *  saved / served types, which stay `readonly`. */
export type TerminalClientMetadata = Authored<
  typeof TerminalClientMetadataSchema.Type
>;
/** The base create input — what every ordinary caller and the wire spell. */
export type CreateTerminalInput = typeof CreateTerminalInputSchema.Type;
/** The three restore-only facts — only `restoreSpawn` (from the saved blob) spells them. */
export type RestoreOnlyMetadata = typeof RestoreOnlyMetadataSchema.Type;
export type InitialTerminalMetadata = typeof InitialTerminalMetadataSchema.Type;
/** The active arm of the `Terminal` sum — what `createMetadata` builds and the
 *  only arm Phase 1 constructs. Narrowing `state === "active"` yields this. */
export type ActiveTerminal = typeof ActiveTerminalSchema.Type;
/** The sleeping arm of the `Terminal` sum — persisted-observation base + memory +
 *  `sleptAt`. */
export type SleepingTerminal = typeof SleepingTerminalSchema.Type;
export type RecentRepo = typeof RecentRepoSchema.Type;
export type RecentAgent = typeof RecentAgentSchema.Type;
export type SavedTerminal = typeof SavedTerminalSchema.Type;
/** The active arm of `SavedTerminal` — what restore/adoption produce and the
 *  only on-disk arm Phase 1 writes. The whole-record adoption path is typed to
 *  this (a sleeping record has no live PTY to adopt). */
export type SavedActiveTerminal = typeof SavedActiveTerminalSchema.Type;
/** The sleeping arm of `SavedTerminal` — persisted base + `sleptAt` + id. What a
 *  slept terminal persists and what the boot seed / restore card read back. */
export type SavedSleepingTerminal = typeof SavedSleepingTerminalSchema.Type;

// ── kaval identity (the pty-host build identity) ───────────────────────
//
// The identity of a kaval pty-host daemon — closure `staleKey` (the nix-baked
// source-closure hash) + git-navigable commit. Two consumers read it:
//   - the connected daemon's REPORTED identity rides `DaemonStatus.identity` on
//     the `daemonStatus` collection (served by padi);
//   - the *expected* identity — the kaval THIS host WOULD spawn (its own baked
//     `KAVAL_BUILD_ID`/`KAVAL_COMMIT_HASH`) — rides padi's `status.expectedKaval`
//     cell. W1.R7 moved it off the surface-app `buildInfo` cell so a kaval read
//     no longer crosses `packages/server` (the package-boundary seal); `buildInfo`
//     now carries only `commit` + `version`.
//
// B3.4 — currency: the client's read-site nudge compares
// `expectedKaval.staleKey !== daemonStatus.identity.staleKey` to flag "update
// pending" on the `kaval` column — a SEPARATE signal from `buildInfo`'s clean-ref
// COMMIT comparison (the client's `≠ srv`). Keyed on the closure-hash staleKey,
// never the per-deploy commit, so a server-/client-only deploy never nudges
// (#1034); off-nix the id is "" on both sides, so the read-site guard stays silent.
export const PtyHostIdentitySchema = Schema.Struct({
  staleKey: Schema.String,
  navigableCommit: Schema.String,
});

/** padi's browser-safe copy of `@kolu/surface-daemon`'s `DaemonLifetimeInfo` (the
 *  wire projection of a daemon's `DaemonLifetime`) — declared here rather than
 *  imported from kaval, for the same reason `PtyHostIdentitySchema` is duplicated:
 *  padi's browser-safe vocab does not depend on kaval's package. `satisfies`-pinned
 *  to the spine type so the two can't drift. Reused by `DaemonStatusSchema` (kaval's
 *  lifetime) and, via surface.ts, by `PadiIdentitySchema` (padi's own). */
export const DaemonLifetimeInfoSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("forever") }),
  Schema.Struct({ kind: Schema.Literal("idleTimeout"), ms: Schema.Number }),
  Schema.Struct({ kind: Schema.Literal("boundToPid"), pid: Schema.Number }),
]) satisfies WireSchema<DaemonLifetimeInfo>;

// `connected` and `incompatible` are the two PAYLOAD-BEARING arms — each gets
// its own object schema below, so the shared payload-less enum arm excludes
// both (leaving either in this enum would make its payload structurally
// unspellable: the shared arm pins every payload field an ANTI-FIELD).
//
// The anti-field spelling is `Schema.optionalKey(Schema.Never)` — the Effect
// twin of zod's `z.never().optional()`. VERIFIED against
// effect@4.0.0-rc.110, not assumed (review #11 asked for exactly this): a
// MISSING key decodes fine, and a PRESENT value — including an explicit
// `undefined` — is REJECTED, which is what makes the field unspellable on the
// arms that must not carry it. `vocabByteCompat.test.ts` pins both
// directions per arm so the guard cannot rot into a no-op.
//
// BETA-ASSUMPTION(rc.110): `Schema.optionalKey(Schema.Never)` accepts a MISSING key and rejects any PRESENT value.
//   Both halves are decoder behavior, not type-level — a bump that accepts an
//   explicit `undefined` makes the field spellable again and the arms stop
//   being disjoint on the wire, with nothing in the types to say so.
const NON_CONNECTED_ENDPOINT_STATES = ENDPOINT_STATES.filter(
  (state): state is Exclude<EndpointState, "connected" | "incompatible"> =>
    state !== "connected" && state !== "incompatible",
) as [
  Exclude<EndpointState, "connected" | "incompatible">,
  ...Exclude<EndpointState, "connected" | "incompatible">[],
];

/** What a PROVEN kaval contract skew carries — the ONE spelling of the skew
 *  version pair on this side of the wire. Spread into the `incompatible` status
 *  arm below and used verbatim as `recycleKaval`'s declared
 *  `KAVAL_CONTRACT_SKEW` error data (surface.ts); the client's projections type
 *  their incompatible arms against the inferred {@link KavalSkewVersions}.
 *  Adding a field to the skew report is an edit HERE, not N hand-kept
 *  re-spellings across the layers. */
export const KavalSkewVersionsSchema = Schema.Struct({
  /** The contract version the daemon actually speaks. */
  daemonVersion: Schema.String,
  /** The contract version this kolu's build requires. */
  requiredVersion: Schema.String,
});
export type KavalSkewVersions = typeof KavalSkewVersionsSchema.Type;

/** Every field only a `connected` daemon status can carry, declared ABSENT —
 *  ONE list, spread into each non-connected arm below.
 *
 *  The arms must stay disjoint on the wire (see the `Schema.Never` note above),
 *  and that obligation grows by one line per arm every time the `connected` arm
 *  learns a new fact — with nothing to check that each arm remembered. Written
 *  once, a new connected-only fact is one edit here. */
const CONNECTED_ONLY_ABSENT = {
  identity: Schema.optionalKey(Schema.Never),
  contractVersion: Schema.optionalKey(Schema.Never),
  startedAt: Schema.optionalKey(Schema.Never),
  adopted: Schema.optionalKey(Schema.Never),
  adoptedAt: Schema.optionalKey(Schema.Never),
  autoRecoveredAt: Schema.optionalKey(Schema.Never),
  linkRestoredAt: Schema.optionalKey(Schema.Never),
  lifetime: Schema.optionalKey(Schema.Never),
};

/** The live state of one host's pty-host daemon (kaval), as the supervisor's
 *  endpoint reports it — the honest-state surface that makes "the daemon is
 *  down" distinguishable from "you have no terminals" (B2, the empty-canvas-lie
 *  fix). The `connected` arm carries boot time and wire contract version;
 *  non-connected states cannot spell those fields. `identity` remains optional
 *  until kaval's `system.version` wire contract makes it mandatory. */
export const DaemonStatusSchema = Schema.Union([
  Schema.Struct({
    state: Schema.Literal("connected"),
    identity: Schema.optionalKey(PtyHostIdentitySchema),
    /** The pty-host wire contract this daemon reported at handshake. Kaval's
     *  build identity is `identity.navigableCommit`; this is the protocol version
     *  kolu-server must agree on before talking to it. */
    contractVersion: Schema.String,
    /** Daemon boot time (ms epoch) — the rail's KAVAL uptime is derived from it. */
    startedAt: Schema.Number,
    /** B3.3: how many terminals this boot ADOPTED from a surviving daemon — set
     *  only on the `connected` status of an adopt-boot (a fresh / recycled boot
     *  omits it). Drives the client's one-shot "N reattached" confirmation.
     *  kolu's soul, not the spine: the supervisor's `EndpointStatus` never
     *  carries adoption results; the server folds them onto this kolu-owned
     *  status after reconciling. */
    adopted: Schema.optionalKey(Schema.Number),
    /** B3.3: the ms-epoch the server stamped when it surfaced THIS adoption — a
     *  per-adoption identity the client dedupes the one-shot toast against. Set
     *  with `adopted` (omitted on cold boots). The `adopted`/`adoptedAt` pair is
     *  sticky server-side and replayed to every fresh subscription, so without an
     *  identity a reconnect after a page reload re-fired the toast though nothing
     *  was re-adopted (juspay/kolu#1365); the client keeps the greatest announced
     *  `adoptedAt` in localStorage and only toasts a strictly newer one. */
    adoptedAt: Schema.optionalKey(Schema.Number),
    /** #2101 N1: the ms-epoch padi stamped when an automatic repair REPLACED an
     *  unresponsive kaval — never on a boot, and never on the button's recycle
     *  (the user who pressed it does not need to be told). Drives the client's
     *  one-shot "kaval was unresponsive — restarted" toast, deduped against a
     *  persisted high-water mark exactly as `adoptedAt` is.
     *
     *  TWO stampers now, and the shared word is "replaced", not "probed"
     *  (juspay/kolu#2184): the supervision arm stamps it once a probe has PROVED
     *  the replacement serves, and the link-loss healer stamps it when its own
     *  re-converge came back with no survivors — a fresh daemon and a parked
     *  session, which is the same news for the reader even though no probe
     *  proved it. What both exclude is the healer's ordinary outcome, an ADOPTED
     *  daemon that never stopped running; that is {@link linkRestoredAt}, whose
     *  sentence is the opposite one. Absent everywhere else, which is the honest
     *  reading: nothing was replaced. */
    autoRecoveredAt: Schema.optionalKey(Schema.Number),
    /** #2184: the ms-epoch padi stamped when the self-healing re-converge
     *  re-ADOPTED the resident kaval after the held link died mid-session — the
     *  daemon was healthy throughout, nothing was restarted, and every terminal
     *  and agent kept running. A SEPARATE fact from {@link autoRecoveredAt},
     *  which means the opposite (the daemon was recycled and the session parked
     *  for restore); the heal stamps whichever its `ConvergeVerdict` proved.
     *  Deduped against its own persisted high-water mark exactly as `adoptedAt`
     *  is. Absent everywhere else: no link was lost and re-made. */
    linkRestoredAt: Schema.optionalKey(Schema.Number),
    /** The local kaval's unix socket path (`$XDG_RUNTIME_DIR/kaval-<port>/pty-host.sock`)
     *  — surfaced for the kaval dialog to show where this daemon listens (the
     *  path `kaval-tui` auto-discovers). kolu's soul (a server fact the client
     *  can't construct — it doesn't know the server's `XDG_RUNTIME_DIR`); set
     *  once at boot, constant for the daemon's life. Optional + additive. */
    socketPath: Schema.optionalKey(Schema.String),
    /** kaval's lifetime policy (`forever` in production; `boundToPid` under a
     *  test/smoke run), mirrored from `system.version` via the connection
     *  metadata — surfaced for the Kaval dialog's lifetime row. Optional: a
     *  survivor predating the field reports none, and the reader falls back
     *  to "—". Set once at boot, constant for the daemon's life. */
    lifetime: Schema.optionalKey(DaemonLifetimeInfoSchema),
    daemonVersion: Schema.optionalKey(Schema.Never),
    requiredVersion: Schema.optionalKey(Schema.Never),
  }),
  // The PROVEN-skew arm (SK4, padiSurface 4.1's one emitted delta): a daemon
  // the supervisor has proven incompatible — a respawn from the realised
  // closure already skewed (or a refuse-policy survivor skews by handshake).
  // Carries BOTH contract versions as REQUIRED typed fields, read off the
  // `DaemonContractSkewError`'s own fields at the emit site — the client's
  // skew card renders them structurally; nothing ever re-parses the prose.
  Schema.Struct({
    state: Schema.Literal("incompatible"),
    // BOTH contract versions, spread from the ONE skew-payload spelling
    // ({@link KavalSkewVersionsSchema}) shared with `recycleKaval`'s declared
    // error data. `.shape` → `.fields` — the same read-off-the-schema promise.
    ...KavalSkewVersionsSchema.fields,
    ...CONNECTED_ONLY_ABSENT,
    socketPath: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    // The state set is the spine's volatility — derive the literal set from the
    // supervisor's `ENDPOINT_STATES` so a new endpoint state is a compile-time
    // obligation here, not a silently-dropped wire member. The `identity` arm
    // below stays kolu's (it is the soul).
    state: Schema.Literals(NON_CONNECTED_ENDPOINT_STATES),
    ...CONNECTED_ONLY_ABSENT,
    daemonVersion: Schema.optionalKey(Schema.Never),
    requiredVersion: Schema.optionalKey(Schema.Never),
    /** The local kaval's unix socket path (`$XDG_RUNTIME_DIR/kaval-<port>/pty-host.sock`)
     *  — surfaced for the kaval dialog to show where this daemon listens (the
     *  path `kaval-tui` auto-discovers). */
    socketPath: Schema.optionalKey(Schema.String),
  }),
]);
export type DaemonStatus = typeof DaemonStatusSchema.Type;
export type DaemonState = DaemonStatus["state"];

// ── Process-memory readout (padi + its kaval) ─────────────────────────────

// The honest three-way process-RSS union (`ProcessRssSchema`/`ProcessRss`) is OWNED
// by the shared browser-safe `@kolu/terminal-vocab/schema` leaf that BOTH
// `@kolu/padi` and `kolu-common` already import — one declaration instead of a
// lockstep copy on each side of the seal. Re-exported so `@kolu/padi-client/surface`'s
// consumers (e.g. `memorySampler.ts`) resolve it from here unchanged.
export { type ProcessRss, ProcessRssSchema };

/** padi's process-memory readout — its OWN RSS plus its kaval daemon's, each the
 *  honest {@link ProcessRssSchema} three-way. One baked osfacts `--mem` snapshot
 *  reads both exact pids; kaval's pid and generation come from padi's one
 *  endpoint-owned connection target, verified again after the async read.
 *  `absent` means no connected kaval, one that exited during the read, or a
 *  superseded generation; an unreadable requested RSS is the explicit `error`
 *  arm. */
export const PadiProcessMemorySchema = Schema.Struct({
  padi: ProcessRssSchema,
  kaval: ProcessRssSchema,
});
export type PadiProcessMemory = typeof PadiProcessMemorySchema.Type;

/** The value a fresh `processMemory` subscriber sees before padi's first sample —
 *  both processes' RSS unknown (the honest `absent`, never a fake zero). */
export const DEFAULT_PADI_PROCESS_MEMORY: PadiProcessMemory = {
  padi: { status: "absent" },
  kaval: { status: "absent" },
};

/** Server-derived activity feed — derived off its schema directly now that the
 *  cell rides `padiSurface` (no longer a `koluSurface` cell). */
export type ActivityFeed = typeof ActivityFeedSchema.Type;
/** The unified terminal record — NOT a served collection value (the wire
 *  carries the `authored` + `awareness` halves separately). This is the shape
 *  `composeTerminalMetadata` reconstructs at the client read and at disk
 *  persist, and the type the ~20 `getMetadata` consumers see. */
export type TerminalMetadata = typeof TerminalMetadataSchema.Type;
export type TerminalInfo = typeof TerminalInfoSchema.Type;
export type SavedSession = typeof SavedSessionSchema.Type;

/** Narrow a terminal (or a possibly-absent one) to its active arm, or
 *  `undefined` when it is sleeping/absent. The single seam presence surfaces use
 *  to read a live field off the `Terminal` sum — `activeArm(meta)?.agent`,
 *  `activeArm(meta)?.foreground`, `activeArm(meta)?.pr`. A sleeping terminal has
 *  no live overlay, so the optional chain yields the same "absent" a live
 *  terminal with no agent/foreground already carries. Accepts null/undefined so
 *  a caller can thread `store.getMetadata(id)` / `activeMeta()` straight through
 *  one call (TS can't narrow a repeated `getMetadata(id).state` across two
 *  calls; this binds the value once).
 *
 *  This reader deliberately collapses "sleeping" and "absent" into one
 *  `undefined` — exactly what a live-field optional-chain wants. A *sleeping-
 *  specific* consumer (a ☾ badge, a `sleptAt` line) must NOT widen this to a
 *  three-way; it gets its own sibling projection (e.g. `sleepingArm`) so the
 *  active/sleeping/absent distinction is preserved at that seam rather than
 *  re-scattering `state` checks. */
export function activeArm(
  m: TerminalMetadata | null | undefined,
): ActiveTerminal | undefined {
  return m?.state === "active" ? m : undefined;
}

/** Narrow a terminal to its SLEEPING arm, or `undefined` when it is active /
 *  absent. The sibling projection `activeArm`'s doc anticipates: a sleeping-
 *  SPECIFIC consumer — the ☾ dock bucket, the moonlit minimap/switcher pip, the
 *  DormantTileBody's `sleptAt` — reads THIS rather than re-scattering
 *  `state === "sleeping"` checks, so the one discriminant has exactly one reader
 *  per arm and "is this tile sleeping?" is greppable across every LIVE-metadata
 *  presence surface. (Persistence-typed readers that hold a `SavedTerminal`
 *  rather than `TerminalMetadata` — e.g. session restore — narrow `state`
 *  directly, since this accessor only accepts the live union.) Truthiness alone
 *  answers presence; the returned arm exposes `sleptAt` for the "asleep 3d"
 *  label. */
export function sleepingArm(
  m: TerminalMetadata | null | undefined,
): SleepingTerminal | undefined {
  return m?.state === "sleeping" ? m : undefined;
}

/** Build a fresh AUTHORED active record for a newly-spawned terminal — the
 *  kolu-owned `location`, empty memory from the canonical `seedMemory` home
 *  (recency at 0, no command), and the active discriminant. The observation half is
 *  seeded SEPARATELY via `seedSnapshot`; this names none of it. The single seam
 *  every live terminal's authored record is born through (spawn / orphan adoption),
 *  and the memory default lives ONCE in `seedMemory`, so a future memory field is
 *  added there and rides here for free. */
export function createAuthoredActive(
  location: HostLocation,
): AuthoredActiveTerminal {
  return { location, ...seedMemory(), state: "active" };
}

/** Join the two halves of a terminal into the unified `TerminalMetadata` — the
 *  ONE join function, applied at exactly two sites: the CLIENT reader
 *  (`useTerminalMetadata`, ephemeral, recomputed per render) and DISK persist
 *  (`snapshotSession`, a save-time snapshot). It is NEVER served as a collection
 *  of its own: the wire carries the two halves separately (`kolu.authored` +
 *  `terminalWorkspace.snapshots`) and the join lives at the reader. The authored
 *  record (`entry.meta`) carries location + memory + client fields + the
 *  discriminant; the observation carries the six snapshot fields. Reusing one
 *  join at both the read and the persist site keeps disk and the client read from
 *  ever diverging.
 *
 *  Spread order is LOAD-BEARING: observation FIRST, authored LAST. The authored
 *  record names no snapshot field, so it never clobbers the observation. The
 *  active path takes the full `TerminalSnapshot` as-is: TS verifies the spread IS an
 *  `ActiveTerminal` structurally, with no parse on the per-render hot path.
 *
 *  The sleeping path takes ONLY the restore-relevant projection — `foreground` is
 *  dropped and the agent reduced to its identity by DECODING through
 *  `PersistedSnapshotSchema` (which names only `cwd · git · pr`, so the rest is
 *  dropped structurally). `pr` rides that projection (restore-relevant now), so
 *  the dormant tile surfaces its last-known PR from there — no frozen-`pr`
 *  special case.
 *
 *  Both decodes are `Schema.decodeUnknownSync` — the fail-fast `.parse`
 *  semantic they replace: a value that is not a terminal record here is a
 *  caller bug, never a branchable condition. */
const decodePersistedSnapshot = Schema.decodeUnknownSync(
  PersistedSnapshotSchema,
);
const decodeSleepingTerminal = Schema.decodeUnknownSync(SleepingTerminalSchema);

export function composeTerminalMetadata(
  authored: AuthoredTerminal,
  observation: TerminalSnapshot,
): TerminalMetadata {
  return authored.state === "active"
    ? { ...observation, ...authored }
    : decodeSleepingTerminal({
        ...decodePersistedSnapshot(observation),
        ...authored,
      });
}

/** The resolved PR of a terminal, if it is active AND its PR resolution is `ok`,
 *  else `null`. The single accessor for 'is it active and does it have a resolved
 *  PR' — the active narrow (`activeArm`) and the `ok`-arm projection (`prValue`)
 *  composed once, so value sites read one accessor instead of re-wiring the two
 *  primitives (and don't leak the `false` an `arm && prValue(arm.pr)` chain
 *  returns). JSX sites that narrow the arm to read BOTH `prValue` and
 *  `prUnavailableSource` off it keep the `activeArm` narrow — this value
 *  projection only collapses the `PrInfo | null` reads. */
export function activePr(
  m: TerminalMetadata | null | undefined,
): PrInfo | null {
  const arm = activeArm(m);
  return arm ? prValue(arm.pr) : null;
}

// ── Saved-terminal backfills (legacy → current shape) ─────────────────
//
// Pure record transforms that bring a legacy on-disk `SavedTerminal` up to the
// current `SavedTerminalSchema`, one per schema bump that added a now-required
// field. They live HERE, beside the schema they restore, because TWO callers
// run them on the SAME blob: the server's versioned migration ladder
// (`state.ts`, keyed per `SCHEMA_VERSION` step) AND the client's diagnostic
// "Import session" hatch (`sessionTransfer.ts`), which ingests an exported
// `kolu-session.json` that may predate any of these fields. A second hand-rolled
// backfill on the import side would be a parallel source of truth — the bug
// codex flagged in the Phase-1 review — so the import path composes these same
// functions via `backfillSavedSession` instead.
//
// Each is idempotent and keyed on the field's presence, never its value, so the
// composed pass is order-independent and safe to re-run on already-current data.

/** Backfill `git.remoteUrl = null` on a saved terminal whose `git` record
 *  predates the field (#1244). Sessions saved between the 1.18 migration and
 *  1.25 carry a populated `git` with no `remoteUrl`, which the now-required
 *  `GitInfoSchema` field rejects. The live git watcher re-resolves the real
 *  value on first restore. Idempotent: a `git` that already has `remoteUrl` —
 *  or a null `git` — passes through untouched. */
export function backfillRemoteUrl(
  t: Record<string, unknown>,
): Record<string, unknown> {
  const git = t.git;
  if (!git || typeof git !== "object") return t;
  if ("remoteUrl" in git) return t;
  return {
    ...t,
    git: { ...(git as Record<string, unknown>), remoteUrl: null },
  };
}

/** Backfill `location = { kind: "local" }` on a saved terminal from before
 *  `location` became a required field (#1398). Every terminal that could have
 *  been persisted before then was an in-process (local) PTY — remote terminals
 *  do not yet exist — so the only honest backfill is the local variant.
 *  Idempotent: a record that already carries a `location` (a future remote
 *  terminal, or a re-run) is left untouched. */
export function backfillLocation(
  t: Record<string, unknown>,
): Record<string, unknown> {
  if ("location" in t) return t;
  return { ...t, location: LOCAL_LOCATION };
}

/** Backfill `state: "active"` on a saved terminal from before `SavedTerminal`
 *  became a `discriminatedUnion` on `state` (the sleeping-terminals redesign,
 *  Phase 1). Every pre-discriminant terminal was an attached, live PTY — no
 *  sleeping record was ever persisted — so the only honest backfill is the
 *  active arm. Idempotent and keyed on the discriminant KEY, not its value: a
 *  record that already carries a `state` (a future `state: "sleeping"` record
 *  with its `sleptAt`, or a re-run) passes through untouched. */
export function backfillTerminalState(
  t: Record<string, unknown>,
): Record<string, unknown> {
  if ("state" in t) return t;
  return { ...t, state: "active" };
}

/** Backfill the awareness-derive-store cutover (PR #1621): `pr` became a PERSISTED
 *  (restore-relevant) field, and the old sticky `agentSession` ref + the implicit
 *  "`lastAgentCommand` ⇒ resume most-recent" rule collapsed into one discriminated
 *  `restoreTarget` (`{@link RestoreTargetSchema}`). A pre-cutover record:
 *   - lacks `pr` (it was a never-persisted live field) → backfill `{ kind: "absent"
 *     }` so the now-persisted field parses; the live PR sensor re-resolves on
 *     restore. A frozen sleeping-arm `pr` already satisfies it and passes through;
 *   - is given a `restoreTarget` from what it remembered, so the OLD resume behavior
 *     is preserved as a NAMED value rather than re-derived from field absence:
 *       · `agentSession { kind, id }` + a `lastAgentCommand` → `{ kind: "exact",
 *         command, agent: { kind, sessionId: id } }` (the EXACT conversation, #1495);
 *       · a `lastAgentCommand` but no `agentSession` → `{ kind: "legacyMostRecent",
 *         command }` (the old most-recent fallback, kept for already-saved sessions);
 *       · no `lastAgentCommand` → no `restoreTarget` (absent ≡ `none`, a bare shell).
 *  `agentSession` is dropped either way. Idempotent and presence-keyed: a record
 *  that already has `pr` and a `restoreTarget` passes through untouched. */
/** zod's `AgentKindSchema.safeParse`, in Effect terms — a `Result`, so a corrupt
 *  on-disk `agentSession.kind` is a BRANCH here (fall to `legacyMostRecent`),
 *  never a throw that would drop the whole terminal at the read boundary. */
const decodeAgentKindResult = Schema.decodeUnknownResult(AgentKindSchema);

export function backfillSnapshotCutover(
  t: Record<string, unknown>,
): Record<string, unknown> {
  const { agentSession, ...rest } = t;
  const next: Record<string, unknown> = { ...rest };
  if (!("pr" in next)) next.pr = { kind: "absent" };
  if (!("restoreTarget" in next)) {
    const command =
      typeof next.lastAgentCommand === "string"
        ? next.lastAgentCommand
        : undefined;
    if (command !== undefined) {
      // Validate the captured ref's VALUE types, not just key presence: a corrupt
      // on-disk `agentSession` (a non-`AgentKind` `kind`, a non-string `id`) must NOT
      // build an `exact` target that fails `RestoreTargetSchema` and drops the whole
      // terminal at the read boundary. A bad ref falls to `legacyMostRecent` (resume
      // most-recent — still valid, the same degraded behavior the pre-cutover record
      // already had).
      const ref =
        agentSession && typeof agentSession === "object"
          ? (agentSession as Record<string, unknown>)
          : null;
      const kind = ref ? decodeAgentKindResult(ref.kind) : null;
      // Route through `exactRestoreTarget` so the SAME command/agent-kind consistency
      // gate the live fold enforces also applies here: a migrated record whose old
      // `agentSession.kind` disagrees with the remembered `lastAgentCommand`'s agent
      // kind (corrupt / hand-edited / cross-agent) falls to `legacyMostRecent` rather
      // than building a mismatched `exact` that would silently resume the wrong agent.
      const exact =
        ref &&
        kind !== null &&
        Result.isSuccess(kind) &&
        typeof ref.id === "string"
          ? exactRestoreTarget(command, {
              kind: kind.success,
              sessionId: ref.id,
            })
          : null;
      next.restoreTarget = exact ?? { kind: "legacyMostRecent", command };
    }
  }
  return next;
}

/** Bring one legacy saved-terminal record up to the current
 *  `SavedTerminalSchema` by composing every field backfill above. Order-free
 *  (each is idempotent + presence-keyed); spelled in ladder order for reading. */
export function backfillSavedTerminal(
  t: Record<string, unknown>,
): Record<string, unknown> {
  return backfillSnapshotCutover(
    backfillTerminalState(backfillLocation(backfillRemoteUrl(t))),
  );
}

/** Bring a parsed-but-unvalidated saved-session blob up to the current schema
 *  by backfilling each terminal, so a `kolu-session.json` exported before a
 *  schema bump survives re-import (the recovery hatch its `sessionTransfer.ts`
 *  callers exist to provide). A non-object, or one with no `terminals` array,
 *  is returned untouched for `SavedSessionSchema` to reject with its own error.
 *  Pure — no validation here; the caller validates the result. */
export function backfillSavedSession(parsed: unknown): unknown {
  if (!parsed || typeof parsed !== "object") return parsed;
  const session = parsed as Record<string, unknown>;
  if (!Array.isArray(session.terminals)) return parsed;
  return {
    ...session,
    terminals: session.terminals.map((t) =>
      t && typeof t === "object"
        ? backfillSavedTerminal(t as Record<string, unknown>)
        : t,
    ),
  };
}
