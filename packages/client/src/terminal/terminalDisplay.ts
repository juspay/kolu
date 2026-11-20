/** Terminal display info — client-derived decorations (colors, sub-count, the
 *  title an export carries) and the canonical identity key from
 *  `@kolu/terminal-vocab`. Carries no live `TerminalMetadata`. */

import type { TerminalMetadata } from "@kolu/padi-client/surface";
import { identityColor } from "@kolu/solid-dockrow/rowValues";
import {
  computeTerminalKeys,
  type TerminalKey,
  terminalCaption,
  terminalKey,
} from "@kolu/terminal-vocab/terminalKey";
import type { TerminalId } from "kolu-common/surface";

export type TerminalDisplayInfo = {
  /** Deterministic OKLCH hue per repo `group`. */
  repoColor: string;
  /** Paint for the annotation slot (branch / intent line). */
  annotationColor: string;
  subCount: number;
  /** Collision-aware identity key. `suffix` is set only when another terminal
   *  in the same display set shares `(group, label)`. */
  key: TerminalKey;
};

/** The both-present gate for a terminal's display row: `info` paired with the
 *  live `meta` record, or `null` until both arrive. */
export function pairDisplayRow(
  info: TerminalDisplayInfo | undefined,
  meta: TerminalMetadata | undefined,
): { info: TerminalDisplayInfo; meta: TerminalMetadata } | null {
  return info && meta ? { info, meta } : null;
}

/** The title a client-side EXPORT of one terminal carries — the PNG copied to
 *  the clipboard and the PDF printed from the scrollback. The caption itself is
 *  `terminalCaption`; this adds only the not-yet-arrived-metadata fallback. */
export function terminalExportTitle(
  meta: TerminalMetadata | undefined,
): string {
  return meta ? terminalCaption(meta) : "terminal";
}

/** Assign OKLCH colours from a stable per-key hue. The iterable only names
 *  which keys appear; it does not affect the hue of any key. Non-string entries
 *  are dropped. */
export function assignColors(keys: Iterable<string>): Map<string, string> {
  const unique = [
    ...new Set([...keys].filter((k): k is string => typeof k === "string")),
  ];
  return new Map(unique.map((key) => [key, identityColor(key)]));
}

/** Build display info for all terminals: per-key colours, collision-aware
 *  identity keys and sub-count. Pure. */
export function buildTerminalDisplayInfos(
  ids: TerminalId[],
  getMeta: (id: TerminalId) => TerminalMetadata | undefined,
  /** Every PANE of the tile — the whole subtree, not the one-hop children. */
  getPaneIds: (id: TerminalId) => TerminalId[],
): Map<TerminalId, TerminalDisplayInfo> {
  const entries = ids.flatMap((id) => {
    const meta = getMeta(id);
    return meta ? [{ id, meta, ...terminalKey(meta) }] : [];
  });
  const colors = assignColors(
    entries.flatMap(({ group, label }) => [group, label]),
  );
  const keys = computeTerminalKeys(
    entries.map(({ id, meta }) => ({ id, git: meta.git, cwd: meta.cwd })),
  );
  const result = new Map<TerminalId, TerminalDisplayInfo>();
  for (const { id, group, label } of entries) {
    const key = keys.get(id);
    const repoColor = colors.get(group);
    const annotationColor = colors.get(label);
    if (!key || !repoColor || !annotationColor) {
      throw new Error(
        `buildTerminalDisplayInfos invariant: missing key/colour for terminal ${id} (group=${group}, label=${label})`,
      );
    }
    result.set(id, {
      repoColor,
      annotationColor,
      subCount: getPaneIds(id).length,
      key,
    });
  }
  return result;
}
