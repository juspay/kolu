/**
 * Watches the two places git reads ignore rules from that live OUTSIDE the
 * working tree, so the working-tree watcher can re-derive its ignore set when
 * either one changes:
 *
 *   - `info/exclude` in the COMMON git dir. It is shared by every worktree of
 *     the repo — an edit made for one worktree changes what all of them ignore.
 *   - the global ignore file: `core.excludesFile`, else git's XDG default.
 *
 * The third source, `.gitignore`, is a working-tree file; the working-tree
 * watcher hears its edits as ordinary parcel events and needs nothing here.
 *
 * Both are single files at known paths, so both ride `kolu-io`'s dir+filename
 * watcher, like the HEAD/reflog/index/config watchers.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  createDirFilenameWatcher,
  type DirFilenameWatcher,
  type WatchAsker,
} from "kolu-io";
import type { Logger } from "kolu-shared";
import {
  GIT_QUERY_TIMEOUT_MS,
  resolveGitCommonDir,
  WATCHER_DEBOUNCE_MS,
} from "./git-dir.ts";

const execFileAsync = promisify(execFile);

/** Resolve `dir` to itself when it exists, else null (no watch). */
async function existingDir(dir: string): Promise<string | null> {
  try {
    await fs.promises.access(dir);
    return dir;
  } catch {
    return null;
  }
}

/** `<common git dir>/info/exclude`. The common dir, not `--git-dir`: git reads
 *  the exclude file from the common dir, so in a linked worktree the
 *  per-worktree `.git/worktrees/<name>/info/exclude` is never consulted. A repo
 *  with no `info/` (created without templates) gets no watch, as `reflog-watcher`
 *  does for a missing `logs/`. */
const excludeWatcher = createDirFilenameWatcher({
  resolveDir: async (cwd) => {
    const commonDir = await resolveGitCommonDir(cwd);
    return commonDir === null
      ? null
      : existingDir(path.join(commonDir, "info"));
  },
  filename: "exclude",
  debounceMs: WATCHER_DEBOUNCE_MS,
  logLabel: "git: info/exclude",
});

/** One dir+filename watcher per global-ignore basename. The factory takes a
 *  fixed filename and `core.excludesFile` can name any file, so each distinct
 *  basename gets its own registry. The `cwd` handed to `watch()` IS the
 *  directory to watch. */
const globalIgnoreWatchers = new Map<string, DirFilenameWatcher>();

function globalIgnoreWatcherFor(basename: string): DirFilenameWatcher {
  let watcher = globalIgnoreWatchers.get(basename);
  if (!watcher) {
    watcher = createDirFilenameWatcher({
      resolveDir: existingDir,
      filename: basename,
      debounceMs: WATCHER_DEBOUNCE_MS,
      logLabel: "git: global ignore",
    });
    globalIgnoreWatchers.set(basename, watcher);
  }
  return watcher;
}

/** Git's default global ignore file when `core.excludesFile` is unset:
 *  `$XDG_CONFIG_HOME/git/ignore`, or `$HOME/.config/git/ignore` when
 *  `XDG_CONFIG_HOME` is unset or empty (gitignore(5)). Git has no command that
 *  prints this default, so the rule is spelled here, once. */
function defaultGlobalIgnoreFile(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const configHome =
    xdg !== undefined && xdg !== "" ? xdg : path.join(os.homedir(), ".config");
  return path.join(configHome, "git", "ignore");
}

/** The global ignore file git uses for `repoRoot`, as an absolute path — NOT
 *  symlink-resolved. A home-manager `~/.config/git/ignore` is a symlink into
 *  the Nix store that activation swaps; the resolved target's directory never
 *  changes, while the link's own directory sees the swap and the dir watcher's
 *  `stat` follows the link to the new content. Null when there is no global
 *  file (`core.excludesFile` set empty) or git cannot answer. */
async function resolveGlobalIgnoreFile(
  repoRoot: string,
  log?: Logger,
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["config", "--type=path", "--get", "core.excludesFile"],
      { cwd: repoRoot, encoding: "utf-8", timeout: GIT_QUERY_TIMEOUT_MS },
    );
    const file = stdout.trim();
    // Set but empty: git reads no global ignore file at all, not the default.
    return file === "" ? null : path.resolve(repoRoot, file);
  } catch (e) {
    // Exit 1 is git's "key not set" — the default location applies.
    if (e instanceof Error && "code" in e && e.code === 1) {
      return defaultGlobalIgnoreFile();
    }
    log?.error(
      { err: e instanceof Error ? e.message : String(e), repoRoot },
      "git: core.excludesFile lookup failed, global ignore file unwatched",
    );
    return null;
  }
}

/** Bumped by `_resetIgnoreRulesWatchers` so a global-file lookup still in
 *  flight across a reset cannot install into the fresh registries. */
let generation = 0;

/**
 * Call `onChange` whenever `repoRoot`'s `info/exclude` or its global ignore
 * file changes (debounced, and once more as each watch attaches). Returns the
 * unsubscribe synchronously; the watches attach on a later tick.
 *
 * The `core.excludesFile` SETTING is read once, here. Pointing it at another
 * file takes effect at the next subscribe, not live.
 */
export function watchGitIgnoreRules(
  repoRoot: string,
  asker: WatchAsker,
  onChange: () => void,
  log?: Logger,
): () => void {
  const startGeneration = generation;
  let cancelled = false;
  const offs = [excludeWatcher.watch(repoRoot, asker, onChange, log)];
  void resolveGlobalIgnoreFile(repoRoot, log).then((file) => {
    if (cancelled || startGeneration !== generation || file === null) return;
    offs.push(
      globalIgnoreWatcherFor(path.basename(file)).watch(
        path.dirname(file),
        asker,
        onChange,
        log,
      ),
    );
  });
  return () => {
    cancelled = true;
    for (const off of offs.splice(0)) off();
  };
}

/** Test-only teardown — close every ignore-rules watch and clear the
 *  registries, regardless of subscriber count. Production code must never call
 *  this; vitest `beforeEach` uses it to break the module-scope leak that turns
 *  one timed-out test into a whole-file cascade (#955). */
export function _resetIgnoreRulesWatchers(): void {
  generation++;
  excludeWatcher._reset();
  for (const watcher of globalIgnoreWatchers.values()) watcher._reset();
  globalIgnoreWatchers.clear();
}
