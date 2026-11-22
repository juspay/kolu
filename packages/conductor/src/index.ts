/**
 * `kolu-conductor` — the Conductor's SERVER HALF, as a package kolu mounts.
 *
 * The Conductor is one Claude conversation over ACP for a whole fleet. What
 * makes it work is here, one module per thing that moves on its own clock:
 * the CONVERSATION and its transcript ({@link startConductorHost}, which also
 * wires the rest), the WORKS it holds (`./workStore`), what kolu knows about
 * each member terminal (`./memberStore`, `./members`), what an observation
 * MEANS to a work (`./observing`), when news reaches a turn (`./wakes`,
 * `./held`), kolu's own questions (`./asking`), a prompt's files
 * (`./attachments`), how often any of it hits disk (`./recordWrites`), the
 * RECORDS that survive a restart (`./persisted`), and the STANDING PROMPT the
 * agent is taught. The surface members a browser subscribes to are here too
 * (`./surface`), because an implementation of "what `conductor.prompt` does"
 * belongs with the thing that does it.
 *
 * ## Why a package, and what that costs the caller
 *
 * The same argument `kolu-mcp` makes one shelf over: a FACE kolu mounts is not
 * kolu-server's inside. kolu-server is a web server, a host map and a state
 * ladder; that it also happens to supervise a Claude subprocess is a separate
 * concern with a separate clock — ACP's — and the wall is what keeps a protocol
 * bump out of the file that serves the websocket.
 *
 * So the dependency arrow points OUT and never back: this package reads
 * `@kolu/acp-harness`, `@kolu/acp`, `kolu-common`'s schema, `kolu-work`'s
 * record and `kolu-agents`' registry, and knows nothing about kolu-server.
 * Everything server-owned is PUSHED IN at the mount — the conf stores and the
 * state directory, where the fleet MCP endpoint is listening and how to prove
 * it, the cell writers, the files port, the machine's name, and the spawn
 * itself. `packages/server/src/conductor/live.ts` is that composition root,
 * and `seal.test.ts` holds the wall in both directions.
 *
 * What deliberately did NOT move: the WIRE SCHEMA (`kolu-common`, because the
 * browser reads it too and a browser must not import a package that spawns
 * subprocesses), the RECORD ITSELF and its refusals (`kolu-work`, which knows
 * nothing of ACP, MCP or a terminal and is read by the browser as well), the
 * migration rung and the `PersistedStateSchema` keys (kolu's one ladder has
 * one home), and the UI.
 */

export { type Asking, askFields, asking } from "./asking.ts";
export {
  type AttachmentChunk,
  type Attachments,
  attachments,
  UNSENT_ATTACHMENT_MS,
} from "./attachments.ts";
export {
  type ConductorDeps,
  type ConductorFrameSink,
  type ConductorHost,
  type FleetMcpEndpoint,
  type KoluOffer,
  startConductorHost,
  type WaterfallStart,
} from "./conductor.ts";
export { type MemberStore, memberStore } from "./memberStore.ts";
export {
  joinedMember,
  joinedWatch,
  type LastReading,
  type MemberState,
  type MemberWatch,
  MemberWatchSchema,
  observed,
  restoredMember,
  saved,
  spokenTo,
  type Watched,
  type WatchJoin,
} from "./members.ts";
export type {
  PrWatch,
  WatchGit,
  WatchLevel,
  WatchObservation,
  WatchPr,
} from "./observation.ts";
export {
  fileEvents,
  type Observing,
  observing,
  prEvents,
  ringEvent,
} from "./observing.ts";
export {
  EMPTY_PERSISTED_CONDUCTOR,
  EMPTY_PERSISTED_MEMBERS,
  EMPTY_PERSISTED_MEMORY,
  EMPTY_PERSISTED_WORK_CODE_VIEWS,
  EMPTY_PERSISTED_WORKS,
  EMPTY_PERSISTED_TRANSCRIPT,
  type PersistedConductor,
  PersistedConductorSchema,
  type PersistedMembers,
  PersistedMembersSchema,
  type PersistedMemory,
  PersistedMemorySchema,
  type PersistedTranscript,
  PersistedTranscriptSchema,
  type PersistedWorks,
  PersistedWorksSchema,
  type PersistedWorkCodeViews,
  PersistedWorkCodeViewsSchema,
  readPersistedConductor,
  readPersistedMembers,
  readPersistedMemory,
  readPersistedWorkCodeViews,
  readPersistedTranscript,
  readPersistedWorks,
  repointConductorAttachments,
  ROW_CAP,
  UnreadablePersisted,
} from "./persisted.ts";
export {
  type HostReady,
  type HostSettling,
  type HostUnreachable,
  type HostView,
  prReading,
  readingsOf,
  recordName,
} from "./readings.ts";
export { type RecordWrites, recordWrites } from "./recordWrites.ts";
export { conductorSurfaceMembers } from "./surface.ts";
export { parseTeaching, teaching } from "./teaching.ts";
export { conductorTranscriptSource } from "./transcriptStream.ts";
export { type WakeMembership, wakeText } from "./wakeText.ts";
export { type Wakes, type WakeTurn, wakes } from "./wakes.ts";
export { type WorkFiles, workDirOf } from "./workFiles.ts";
export {
  FINISHED_KEPT,
  type MemberAt,
  type MemberDetail,
  type WorkStore,
  workStore,
} from "./workStore.ts";
