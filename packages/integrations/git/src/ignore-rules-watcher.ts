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

async function existingDir(dir: string): Promise<string | null> {
  try {
    await fs.promises.access(dir);
    return dir;
  } catch {
    return null;
  }
}

/** `<common git dir>/info/exclude`: git reads the exclude file from the common
 *  dir, so a linked worktree's `.git/worktrees/<name>/info/exclude` is never
 *  consulted. */
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

/** NOT symlink-resolved: a home-manager `~/.config/git/ignore` is a symlink
 *  into the Nix store that activation swaps, and only the link's own directory
 *  sees that swap. */
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

let generation = 0;

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

export function _resetIgnoreRulesWatchers(): void {
  generation++;
  excludeWatcher._reset();
  for (const watcher of globalIgnoreWatchers.values()) watcher._reset();
  globalIgnoreWatchers.clear();
}
