/**
 * `kolu-conductor` — the Conductor's SERVER HALF, as a package kolu mounts.
 *
 * The Conductor is one Claude conversation over ACP for a whole fleet. Three
 * things make it work and they are all here: the HOST that owns the ACP child
 * and the transcript ({@link startConductorHost}), the RECORD that survives a
 * restart (`./persisted`), and the STANDING PROMPT the agent is taught. The
 * surface members a browser subscribes to are here too (`./surface`), because
 * an implementation of "what `conductor.prompt` does" belongs with the thing
 * that does it.
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
 * `@kolu/acp-harness`, `@kolu/acp`, `kolu-common`'s schema and `kolu-agents`'
 * registry, and knows nothing about kolu-server. Everything server-owned is
 * PUSHED IN at the mount — the conf store and the state directory, where the
 * fleet MCP endpoint is listening and how to prove it, the cell writer, the
 * machine's name, and the spawn itself. `packages/server/src/conductor/live.ts`
 * is that composition root, and `seal.test.ts` holds the wall in both
 * directions.
 *
 * What deliberately did NOT move: the WIRE SCHEMA (`kolu-common`, because the
 * browser reads it too and a browser must not import a package that spawns
 * subprocesses), the migration rung and the `PersistedStateSchema` key (kolu's
 * one ladder has one home), and the UI.
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
  EMPTY_PERSISTED_CONDUCTOR,
  type PersistedConductor,
  PersistedConductorSchema,
  readPersistedConductor,
  repointConductorAttachments,
} from "./persisted.ts";
export { conductorSurfaceMembers } from "./surface.ts";
export { parseTeaching, teachingLines } from "./teaching.ts";
export { conductorTranscriptSource } from "./transcriptStream.ts";
export { wakeText } from "./wakeText.ts";
export {
  type LastReading,
  observed,
  restoredEntry,
  spokenTo,
  type WatchEntry,
  type Watched,
  type WatchJoin,
  type WatchLevel,
  type WatchObservation,
  watchEntry,
} from "./watching.ts";
