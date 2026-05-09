/**
 * Metadata state mutators — the `createMetadata` / `updateServerMetadata`
 * / `updateClientMetadata` helpers providers + lifecycle code call to
 * atomically mutate + publish a terminal's metadata.
 *
 * Split out of `./index.ts` so `./index.ts` can be an orchestrator that
 * imports providers without the providers needing to reach back through
 * it for the update helpers. That reach-back closed the Biome
 * `noImportCycles` loop called out in #710 (`./index.ts` ↔ `./agent.ts` /
 * `./git.ts` / `./github.ts` / `./process.ts` / `./agent-command.ts`).
 *
 * This file imports only `TerminalProcess` (type) from
 * `../terminal-registry.ts`, which is a leaf — so nothing here re-enters
 * the meta/providers graph.
 */

import type {
  LiveTerminalFields,
  ServerPersistedTerminalFields,
  TerminalClientMetadata,
  TerminalMetadata,
} from "kolu-common/surface";
import { prUnavailableReason, prValue } from "kolu-github/schemas";
import { log } from "../log.ts";
import { terminalsDirtyChannel } from "../publisher.ts";
import { surfaceCtx } from "../surface.ts";
import type { TerminalProcess } from "../terminal-registry.ts";

/** Create initial metadata state for a new terminal. `lastActivityAt: 0`
 *  means "no agent transition observed yet" — the only event that lifts
 *  the recency clock. Idle terminals tie at 0 and fall back to canvas
 *  position. */
export function createMetadata(cwd: string): TerminalMetadata {
  return {
    cwd,
    git: null,
    pr: { kind: "pending" },
    agent: null,
    foreground: null,
    lastActivityAt: 0,
  };
}

/** Log + emit the current metadata snapshot to the surface collection.
 *  Shared tail for every update variant — the publish/audit path is
 *  identical regardless of who wrote the fields. Distinct from
 *  `publishSnapshotAndDirty` (below): this one does NOT fire
 *  `terminals:dirty`, so live-only writes (agent stream sub-info, pr poll
 *  results, foreground process churn) don't schedule autosaves whose
 *  persisted bytes would be byte-identical to the previous snapshot.
 *
 *  The name is "snapshot", not "persist": no I/O happens here. The
 *  `terminals:dirty` channel is the *signal* that downstream
 *  `session.ts` listens for and translates into a write to disk. */
function publishSnapshot(entry: TerminalProcess, terminalId: string): void {
  const m = entry.meta;
  const pr = prValue(m.pr);
  const prUnavailable = prUnavailableReason(m.pr);
  log.debug(
    {
      terminal: terminalId,
      cwd: m.cwd,
      repo: m.git?.repoName,
      branch: m.git?.branch,
      pr: pr?.number ?? null,
      checks: pr?.checks ?? null,
      prStatus: m.pr.kind,
      ...(prUnavailable && { prUnavailable }),
      // Only include agent/foreground fields when present to avoid noisy null logs
      ...(m.agent && { agent: `${m.agent.kind}:${m.agent.state}` }),
      ...(m.foreground && { foreground: m.foreground.name }),
    },
    "metadata publish",
  );
  surfaceCtx.collections.terminalMetadata.upsert(terminalId, { ...m });
}

/** `publishSnapshot` + fire `terminals:dirty`. Use this from any path
 *  that wrote a persisted field — the dirty signal tells `session.ts`'s
 *  autosave loop to debounce-save the snapshot. The actual disk write
 *  is downstream; this function is named for what it *does* (signal
 *  dirty), not what eventually happens (a write). */
function publishSnapshotAndDirty(
  entry: TerminalProcess,
  terminalId: string,
): void {
  publishSnapshot(entry, terminalId);
  terminalsDirtyChannel.publish({});
}

/** Atomically mutate server-persisted metadata (`cwd`, `git`,
 *  `lastAgentCommand`, `lastActivityAt`) and publish. The mutator is
 *  narrowed to `ServerPersistedTerminalFields` — bidirectional fence: a
 *  provider cannot write client-owned fields (themeName, parentId, …)
 *  AND cannot write live-only fields (pr, agent, foreground) through
 *  this function. The latter half is the structural guarantee that the
 *  terminals:dirty firehose can't grow back: every live-field write
 *  must go through `updateServerLiveMetadata`. Fires `terminals:dirty`. */
export function updateServerMetadata(
  entry: TerminalProcess,
  terminalId: string,
  mutate: (meta: ServerPersistedTerminalFields) => void,
): void {
  mutate(entry.meta);
  publishSnapshotAndDirty(entry, terminalId);
}

/** Atomically mutate live-only server metadata (`pr`, `agent`,
 *  `foreground`) and publish — without firing `terminals:dirty`. The
 *  mutator type is `LiveTerminalFields`, a compile-time fence: writing
 *  any persisted field through this function is a type error.
 *  Together with the matching narrowing on `updateServerMetadata`,
 *  this is the structural guarantee that the firehose can't grow
 *  back. */
export function updateServerLiveMetadata(
  entry: TerminalProcess,
  terminalId: string,
  mutate: (meta: LiveTerminalFields) => void,
): void {
  mutate(entry.meta);
  publishSnapshot(entry, terminalId);
}

/** Atomically mutate client-owned metadata (themeName, parentId,
 *  canvasLayout, subPanel) and publish. The mutator is narrowed to
 *  `TerminalClientMetadata` so RPC handlers cannot accidentally overwrite
 *  provider-owned state. Every client field is persisted, so this always
 *  fires `terminals:dirty`. */
export function updateClientMetadata(
  entry: TerminalProcess,
  terminalId: string,
  mutate: (meta: TerminalClientMetadata) => void,
): void {
  mutate(entry.meta);
  publishSnapshotAndDirty(entry, terminalId);
}
