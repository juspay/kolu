/**
 * Metadata state mutators — `createMetadata` / `updateServerMetadata` /
 * `updateServerLiveMetadata` / `updateClientMetadata`. Three write
 * verbs, narrowed by the field group their mutator is allowed to
 * touch.
 *
 * The mutator-type narrowing is a bidirectional compile-time fence:
 * each helper can only write the fields it owns, so a provider cannot
 * accidentally write `canvasLayout`, an RPC handler cannot accidentally
 * write `git`, and a live-field write cannot accidentally re-trigger
 * the `terminals:dirty` autosave firehose.
 *
 *   - `updateServerMetadata` — server-persisted fields (cwd, git,
 *     lastAgentCommand, lastActivityAt). Mutator typed to
 *     `ServerPersistedTerminalFields`. Fires `terminals:dirty`.
 *   - `updateServerLiveMetadata` — live-only fields (pr, agent,
 *     foreground). Mutator typed to `LiveTerminalFields`. Does NOT fire
 *     `terminals:dirty` — that's the point: the agent stream watcher
 *     publishes at ~150ms during streaming, and most of those publishes
 *     touch only live state.
 *   - `updateClientMetadata` — client-persisted fields (themeName,
 *     parentId, canvasLayout, subPanel, rightPanel, intent). Every
 *     client field is persisted, so this fires `terminals:dirty`.
 *
 * Used by both `LocalTerminalBackend`'s internal providers and by
 * `terminals.ts`'s client-facing metadata setters. Lives next to the
 * backend implementation because the publish path is intrinsic to "how
 * a terminal's metadata becomes visible".
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
 *  Distinct from `publishSnapshotAndDirty`: this one does NOT fire
 *  `terminals:dirty`, so live-only writes (agent stream sub-info, pr
 *  poll results, foreground process churn) don't schedule autosaves
 *  whose persisted bytes would be byte-identical to the previous
 *  snapshot. */
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
      ...(m.agent && { agent: `${m.agent.kind}:${m.agent.state}` }),
      ...(m.foreground && { foreground: m.foreground.name }),
    },
    "metadata publish",
  );
  surfaceCtx.collections.terminalMetadata.upsert(terminalId, { ...m });
}

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
 *  `terminals:dirty` firehose can't grow back: every live-field write
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
 *  this is the structural guarantee that the firehose can't grow back. */
export function updateServerLiveMetadata(
  entry: TerminalProcess,
  terminalId: string,
  mutate: (meta: LiveTerminalFields) => void,
): void {
  mutate(entry.meta);
  publishSnapshot(entry, terminalId);
}

/** Atomically mutate client-owned metadata (`themeName`, `parentId`,
 *  `canvasLayout`, `subPanel`, `rightPanel`, `intent`) and publish. The
 *  mutator is narrowed to `TerminalClientMetadata` so RPC handlers
 *  cannot accidentally overwrite provider-owned state. Every client
 *  field is persisted, so this always fires `terminals:dirty`. */
export function updateClientMetadata(
  entry: TerminalProcess,
  terminalId: string,
  mutate: (meta: TerminalClientMetadata) => void,
): void {
  mutate(entry.meta);
  publishSnapshotAndDirty(entry, terminalId);
}
