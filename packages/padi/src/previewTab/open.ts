/**
 * Preview-tab open/close — the server-authored writers of
 * `RightPanelPerTerminalState.preview`.
 *
 * Validation is pure ({@link assertPreviewTarget}); this module owns the
 * registry write and the host-wide scanned-port allowlist that feed it.
 * Lives next to `target.ts` under `previewTab/` so the PRT3 chrome feature
 * is one directory (not leaf files flat under `src/`, and not the unrelated
 * file-byte `preview.ts`).
 */

import { knownPorts, type TerminalId } from "@kolu/terminal-vocab/schema";
import { ORPCError } from "@orpc/server";
import {
  DEFAULT_RIGHT_PANEL_PER_TERMINAL,
  type PreviewLocation,
  type RightPanelPerTerminalState,
  rightPanelStateEqual,
} from "../chromeVocab.ts";
import { getTerminal, listTerminals } from "../terminal-registry.ts";
import { updateClientMetadata } from "../terminalEndpoint/metadata.ts";
import { assertPreviewTarget } from "./target.ts";

/** Host-wide scanned listening ports — union across every active terminal's
 *  known sample. One fact ("what listens on this host"), derived next to the
 *  registry that owns the samples — not recomputed in the UI. */
export function collectHostScannedPorts(): Set<number> {
  const ports = new Set<number>();
  for (const t of listTerminals()) {
    const entry = getTerminal(t.id);
    if (!entry || entry.meta.state !== "active") continue;
    for (const p of knownPorts(entry.snapshot.ports)) {
      ports.add(p.port);
    }
  }
  return ports;
}

/** Open or navigate the Preview tab. `doorPorts` is the live-forward remote
 *  set for this host when the caller can see it (kolu-server composition);
 *  padi's own serve path passes an empty set — doors live on the app
 *  surface, and chip-driven previews are already in the scan set.
 *
 *  Validates via {@link assertPreviewTarget}, writes `preview`, switches
 *  `activeTab` to `"preview"`, uncollapses. A repeat call NAVIGATES. */
export function previewOpen(
  id: TerminalId,
  input: { port: number; path: string },
  allow: {
    scannedPorts: ReadonlySet<number>;
    doorPorts: ReadonlySet<number>;
  } = { scannedPorts: collectHostScannedPorts(), doorPorts: new Set() },
): PreviewLocation {
  const entry = getTerminal(id);
  if (!entry) {
    throw new ORPCError("NOT_FOUND", {
      message: `terminal ${id} not found`,
    });
  }
  const cur = entry.meta.rightPanel;
  const location = assertPreviewTarget({
    port: input.port,
    path: input.path,
    scannedPorts: allow.scannedPorts,
    doorPorts: allow.doorPorts,
    currentPort: cur?.preview?.port ?? null,
  });
  const next: RightPanelPerTerminalState = {
    ...(cur ?? DEFAULT_RIGHT_PANEL_PER_TERMINAL),
    collapsed: false,
    activeTab: "preview",
    preview: location,
  };
  if (cur && rightPanelStateEqual(cur, next)) return location;
  updateClientMetadata(entry, id, (m) => {
    m.rightPanel = next;
  });
  return location;
}

/** Clear the Preview location. Leaves `activeTab` on `"preview"` so the empty
 *  frame / door-closed chrome still shows; the client may switch tabs after. */
export function previewClose(id: TerminalId): void {
  const entry = getTerminal(id);
  if (!entry) {
    throw new ORPCError("NOT_FOUND", {
      message: `terminal ${id} not found`,
    });
  }
  const cur = entry.meta.rightPanel;
  if (!cur || cur.preview === null) return;
  const next: RightPanelPerTerminalState = { ...cur, preview: null };
  updateClientMetadata(entry, id, (m) => {
    m.rightPanel = next;
  });
}
