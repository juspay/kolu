/**
 * How agent-distro's updater reports download progress — the ONE place padi
 * knows it, so the relay changes in one spot when the updater does.
 *
 * agent-distro's U4 gives the updater a `--progress` mode: its `nix build` runs
 * with `--log-format internal-json`, and stdout becomes one JSON object per
 * line, `{"progress":{"done":<bytes>,"total":<bytes>}}` while fetching. The pin
 * kolu builds against predates U4, whose updater rejects an unknown mode, so
 * {@link UPDATER_PROGRESS_ARGS} is empty and no line parses as progress: the
 * host shows "Downloading agents…" without byte counts until the pin moves.
 * Bumping the pin past U4 is the one-line change here (`["--progress"]`).
 */

/** Extra argv after the config path. Empty until the pinned updater has U4. */
export const UPDATER_PROGRESS_ARGS: readonly string[] = [];

export interface UpdaterProgress {
  readonly done: number;
  readonly total: number;
}

/** One stdout line → a progress reading, or `null` for any other line (the
 *  updater's own status lines, a final `result` object, blank lines). */
export function parseUpdaterProgressLine(line: string): UpdaterProgress | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const progress = (parsed as { progress?: unknown } | null)?.progress as
    | { done?: unknown; total?: unknown }
    | undefined;
  if (
    typeof progress?.done !== "number" ||
    typeof progress.total !== "number" ||
    !Number.isFinite(progress.done) ||
    !Number.isFinite(progress.total) ||
    progress.done < 0 ||
    progress.total < 0
  )
    return null;
  return { done: progress.done, total: progress.total };
}
