/**
 * How agent-distro's updater reports a run to a machine — the ONE place padi
 * knows it, so the relay changes in one spot when the updater does.
 *
 * Under `--progress` (agent-distro's `src/update/update.ts`; `lib/mk-updater.nix`
 * documents it as `command ++ [ "--progress" ]`) the updater's stdout is one JSON
 * object per line: `{"progress":{"done":<bytes>,"total":<bytes>}}` while nix
 * fetches, then exactly one `{"result":…}` — `updated` / `unchanged` with the
 * bundle it landed, or `skipped` / `failed` with the reason in its own words —
 * and, optionally, a `detail`: the one line of nix's own stderr that says why
 * (`unable to download '…': HTTP error 401`). Every human line goes to stderr.
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
  | {
      readonly result: "skipped" | "failed";
      readonly reason: string;
      /** nix's own line about the cause, when the updater caught one. */
      readonly detail?: string;
    };

/** A run that landed nothing, in words: the updater's reason, then nix's own
 *  line when it gave one — the ONE place the two are joined, so the status,
 *  the receipt and the toast all say the same thing. */
export function updaterResultWords(result: {
  readonly reason: string;
  readonly detail?: string;
}): string {
  return result.detail === undefined
    ? result.reason
    : `${result.reason}: ${result.detail}`;
}

/** One stdout line, read. Under `--progress` stdout is JSON-only by contract,
 *  so a non-blank line that is neither documented object is `malformed` — the
 *  run's error, never something to skip — and only a blank line reads `null`. */
export type UpdaterLine =
  | { readonly progress: UpdaterProgress }
  | { readonly result: UpdaterResult }
  | { readonly malformed: string };

const isCount = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0;

/** Read one stdout line of a `--progress` run. */
export function parseUpdaterLine(line: string): UpdaterLine | null {
  const trimmed = line.trim();
  if (trimmed === "") return null;
  const malformed = { malformed: trimmed } as const;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return malformed;
  }
  if (typeof parsed !== "object" || parsed === null) return malformed;
  const record = parsed as Record<string, unknown>;
  if ("progress" in record) {
    const progress = record.progress as
      | { done?: unknown; total?: unknown }
      | null
      | undefined;
    return isCount(progress?.done) && isCount(progress?.total)
      ? { progress: { done: progress.done, total: progress.total } }
      : malformed;
  }
  switch (record.result) {
    case "updated":
    case "unchanged":
      return typeof record.bundle === "string"
        ? { result: { result: record.result, bundle: record.bundle } }
        : malformed;
    case "skipped":
    case "failed":
      // `detail` is optional and additive: a string is kept, anything else
      // is ignored rather than failing a run the reason already explains.
      return typeof record.reason === "string"
        ? {
            result: {
              result: record.result,
              reason: record.reason,
              ...(typeof record.detail === "string"
                ? { detail: record.detail }
                : {}),
            },
          }
        : malformed;
    default:
      return malformed;
  }
}

/** What the updater last SAID on stderr, as words: its last non-blank line,
 *  minus the `agent-distro: ` prefix upstream puts on every message it writes
 *  there. `undefined` when it said nothing. Part of the same contract as the
 *  `--progress` lines — where a run that died without its result line left its
 *  last word. */
export function updaterLastWord(stderr: readonly string[]): string | undefined {
  return stderr
    .findLast((l) => l.trim() !== "")
    ?.trim()
    .replace(/^agent-distro:\s*/, "");
}
