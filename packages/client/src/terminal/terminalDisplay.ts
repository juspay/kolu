/** Terminal display info — bundles server metadata with client-derived
 *  decorations, sub-count, identity key, and presentation projection. */

import type { TerminalMetadata } from "@kolu/padi/surface";
import type { TerminalId } from "kolu-common/surface";
import {
  computeTerminalKeys,
  suffixTerminalKeys,
  type TerminalKey,
  terminalKey,
} from "kolu-common/terminalKey";
import { annotationLine } from "../intent/text";

export type TerminalPresentation = {
  /** Repo/workspace heading used by user-facing terminal presentation. */
  group: string;
  /** Intent-first label: intent line 1 when set, else the identity label. */
  label: string;
  /** Presentation-domain collision suffix for matching `(group, label)`. */
  suffix?: string;
};

export type TerminalDisplayInfo = {
  /** Deterministic OKLCH hue per repo `group`. Always defined: `group`
   *  is non-null in `terminalKey` (git repoName or cwd basename) and
   *  `assignColors` covers every key passed in. */
  repoColor: string;
  /** Same OKLCH scheme keyed on the branch `label`. Always defined for
   *  the same reason. */
  branchColor: string;
  /** Color for the supplant-rule annotation slot, keyed by the
   *  user-facing presentation label so intent text does not recolor just
   *  because the hidden branch identity changed. */
  annotationColor: string;
  meta: TerminalMetadata;
  subCount: number;
  /** Collision-aware identity key. `suffix` is set only when another
   *  terminal in the same display set shares `(group, label)`. */
  key: TerminalKey;
  /** User-facing terminal label projection. Distinct from `key` so
   *  branch/cwd identity changes cannot take over intent-first display. */
  presentation: TerminalPresentation;
  /** Title-bar annotation slot: intent first, then git branch, then
   *  placeholder for non-git terminals. */
  titleAnnotationLabel: string;
};

/** Assign OKLCH colors via golden-angle hue spacing.
 *  All keys share one sequence so no two get the same color. */
export function assignColors(keys: Iterable<string>): Map<string, string> {
  return new Map(
    [...new Set(keys)]
      .sort()
      .map((key, i) => [key, `oklch(0.75 0.14 ${(i * 137.508) % 360})`]),
  );
}

/** Build display info for all terminals. Resolves colors from the full
 *  terminal list (global hue uniqueness), computes collision-aware
 *  identity keys in one pass (`computeTerminalKeys`), and bundles
 *  sub-count so consumers get one complete object. Pure — same inputs
 *  produce the same outputs on every client, so suffixes stay in sync
 *  without server broadcast. */
export function buildTerminalDisplayInfos(
  ids: TerminalId[],
  getMeta: (id: TerminalId) => TerminalMetadata | undefined,
  getSubTerminalIds: (id: TerminalId) => TerminalId[],
): Map<TerminalId, TerminalDisplayInfo> {
  const entries = ids.flatMap((id) => {
    const meta = getMeta(id);
    return meta ? [{ id, meta, ...terminalKey(meta) }] : [];
  });
  const presentationBases = entries.map(({ id, meta, group, label }) => ({
    id,
    group,
    label: annotationLine(meta.intent, label),
  }));
  const colors = assignColors([
    ...entries.flatMap(({ group, label }) => [group, label]),
    ...presentationBases.map(({ label }) => label),
  ]);
  const keys = computeTerminalKeys(
    entries.map(({ id, meta }) => ({ id, git: meta.git, cwd: meta.cwd })),
  );
  const presentationKeys = suffixTerminalKeys(presentationBases);
  const result = new Map<TerminalId, TerminalDisplayInfo>();
  for (const { id, meta, group, label } of entries) {
    const key = keys.get(id);
    const presentation = presentationKeys.get(id);
    const repoColor = colors.get(group);
    const branchColor = colors.get(label);
    const annotationColor = presentation
      ? colors.get(presentation.label)
      : undefined;
    // `computeTerminalKeys` keys its map by the ids we just passed in,
    // and `assignColors` was just built from these identity and
    // presentation strings, so every entry has matching values. The
    // skip is defence-in-depth for an unreachable case — the consumer
    // simply gets fewer entries.
    if (!key || !presentation || !repoColor || !branchColor || !annotationColor)
      continue;
    result.set(id, {
      meta,
      repoColor,
      branchColor,
      annotationColor,
      subCount: getSubTerminalIds(id).length,
      key,
      presentation,
      titleAnnotationLabel: annotationLine(
        meta.intent,
        meta.git?.branch ?? "—",
      ),
    });
  }
  return result;
}
