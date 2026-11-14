/**
 * `kolu-conductor` — the Conductor's SERVER HALF, as a package kolu mounts.
 *
 * The Conductor is one Claude conversation over ACP for a whole fleet. Four
 * things make it work and they are all here: the HOST that owns the ACP child,
 * the transcript and the WORKS ({@link startConductorHost}), the RECORDS that
 * survive a restart (`./persisted`), the per-member wake rules (`./members`),
 * and the STANDING PROMPT the agent is taught. The surface members a browser
 * subscribes to are here too (`./surface`), because an implementation of "what
 * `conductor.prompt` does" belongs with the thing that does it.
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
 * subprocesses), the RECORD ITSELF (`kolu-work`, which knows nothing of ACP,
 * MCP or a terminal and is read by the browser as well), the migration rung
 * and the `PersistedStateSchema` keys (kolu's one ladder has one home), and
 * the UI.
 */

export {
  type ConductorDeps,
  type ConductorFrameSink,
  type ConductorHost,
  type FleetMcpEndpoint,
  startConductorHost,
  UNSENT_ATTACHMENT_MS,
} from "./conductor.ts";
export { type Held, type HeldSlot, holding } from "./held.ts";
export {
  joinedMember,
  type LastReading,
  type MemberState,
  observed,
  restoredMember,
  spokenTo,
  type Watched,
  type WatchGit,
  type WatchJoin,
  type WatchLevel,
  type WatchObservation,
  type WatchPr,
} from "./members.ts";
export {
  EMPTY_PERSISTED_CONDUCTOR,
  EMPTY_PERSISTED_TRANSCRIPT,
  type MemberWatch,
  MemberWatchSchema,
  type PersistedConductor,
  PersistedConductorSchema,
  type PersistedTranscript,
  PersistedTranscriptSchema,
  type PersistedWorks,
  PersistedWorksSchema,
  readPersistedConductor,
  readPersistedTranscript,
  readPersistedWorks,
  repointConductorAttachments,
  ROW_CAP,
  type StoredMember,
  StoredMemberSchema,
  type StoredWork,
  StoredWorkSchema,
} from "./persisted.ts";
export { type HostReading, readingsOf, recordName } from "./readings.ts";
export { conductorSurfaceMembers } from "./surface.ts";
export { parseTeaching, teachingLines } from "./teaching.ts";
export { conductorTranscriptSource } from "./transcriptStream.ts";
export { type WakeMembership, wakeText } from "./wakeText.ts";
export {
  askForm,
  missingSetup,
  otherKey,
  pickedValues,
  type SetupAsk,
  type WorkFiles,
  WorkRefusal,
  type WorkRefusalKind,
} from "./works.ts";
