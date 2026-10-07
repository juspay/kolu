/**
 * How agent-distro's updater reports a run to a machine — the ONE place padi
 * knows it, so the relay changes in one spot when the updater does.
 *
 * Under `--progress` (agent-distro's `src/update/update.ts`; `lib/mk-updater.nix`
 * documents it as `command ++ [ "--progress" ]`) the updater's stdout is one JSON
 * object per line: `{"progress":{"done":<bytes>,"total":<bytes>}}` while nix
 * fetches, then exactly one `{"result":…}` — `updated` / `unchanged` with the
 * bundle it landed, or `skipped` / `failed` with the reason in its own words.
 * Every human line goes to stderr.
 */

/** Extra argv after the config path: the machine-readable mode. */
export const UPDATER_PROGRESS_ARGS: readonly string[] = ["--progress"];

export interface UpdaterProgress {
  readonly done: number;
  readonly total: number;
}

/** The updater's final word on a run. */
export type UpdaterResult =
  | { readonly result: "updated" | "unchanged"; readonly bundle: string }
  | { readonly result: "skipped" | "failed"; readonly reason: string };

/** One stdout line, read. `null` for anything that is neither (a blank line). */
export type UpdaterLine =
  | { readonly progress: UpdaterProgress }
  | { readonly result: UpdaterResult };

const isCount = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0;

/** Read one stdout line of a `--progress` run. Anything that is not one of the
 *  two documented objects reads as `null` — the caller decides what an ABSENT
 *  result means (a crash), never this parser. */
export function parseUpdaterLine(line: string): UpdaterLine | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  const progress = record.progress as
    | { done?: unknown; total?: unknown }
    | undefined;
  if (progress !== undefined) {
    return isCount(progress?.done) && isCount(progress?.total)
      ? { progress: { done: progress.done, total: progress.total } }
      : null;
  }
  switch (record.result) {
    case "updated":
    case "unchanged":
      return typeof record.bundle === "string"
        ? { result: { result: record.result, bundle: record.bundle } }
        : null;
    case "skipped":
    case "failed":
      return typeof record.reason === "string"
        ? { result: { result: record.result, reason: record.reason } }
        : null;
    default:
      return null;
  }
}
