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
  TerminalClientMetadata,
  TerminalId,
  TerminalMetadata,
  TerminalServerMetadata,
} from "kolu-common/surface";
import { prUnavailableReason, prValue } from "kolu-github/schemas";
import { log } from "../log.ts";
import { terminalsDirtyChannel } from "../publisher.ts";
import { surfaceCtx } from "../surface.ts";
import type { TerminalProcess } from "../terminal-registry.ts";

/** Create initial metadata state for a new terminal. `lastActivityAt: 0`
 *  means "no activity yet" — the issue (#830) defines activity as user
 *  input or an agent semantic-key transition, neither of which has
 *  happened yet at create time. Tied at 0 sorts a fresh terminal below
 *  any peer with real activity, falling back to canvas position among
 *  peers that are also idle. */
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

/** Log + publish the current metadata snapshot and trigger debounced
 *  session auto-save. Shared tail for both `updateServerMetadata` and
 *  `updateClientMetadata` so the publish/audit path is identical regardless
 *  of who wrote the fields. */
function publishMetadata(entry: TerminalProcess, terminalId: string): void {
  const m = entry.info.meta;
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
  terminalsDirtyChannel.publish({});
}

/** Atomically mutate server-derived metadata (cwd, git, pr, agent,
 *  foreground) and publish. The mutator is narrowed to
 *  `TerminalServerMetadata` so providers cannot accidentally write
 *  client-owned fields. */
export function updateServerMetadata(
  entry: TerminalProcess,
  terminalId: string,
  mutate: (meta: TerminalServerMetadata) => void,
): void {
  mutate(entry.info.meta);
  publishMetadata(entry, terminalId);
}

/** Atomically mutate client-owned metadata (themeName, parentId,
 *  canvasLayout, subPanel) and publish. The mutator is narrowed to
 *  `TerminalClientMetadata` so RPC handlers cannot accidentally overwrite
 *  provider-owned state. */
export function updateClientMetadata(
  entry: TerminalProcess,
  terminalId: string,
  mutate: (meta: TerminalClientMetadata) => void,
): void {
  mutate(entry.info.meta);
  publishMetadata(entry, terminalId);
}

/** Per-terminal leading-edge throttle for `bumpRecency`. Without it every
 *  keystroke would broadcast a metadata upsert and dirty the debounced
 *  session auto-save. */
const BUMP_RECENCY_INTERVAL_MS = 500;
const lastBumpAt = new Map<TerminalId, number>();

/** Note user-meaningful activity on this terminal. Throttled per id. */
export function bumpRecency(
  entry: TerminalProcess,
  terminalId: TerminalId,
): void {
  const now = Date.now();
  const last = lastBumpAt.get(terminalId) ?? 0;
  if (now - last < BUMP_RECENCY_INTERVAL_MS) return;
  lastBumpAt.set(terminalId, now);
  updateServerMetadata(entry, terminalId, (m) => {
    m.lastActivityAt = now;
  });
}

/** Release the throttle entry for a disposed terminal. */
export function clearRecencyState(terminalId: TerminalId): void {
  lastBumpAt.delete(terminalId);
}
