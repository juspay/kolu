/**
 * WorkspaceFsService — indexes a git workspace's files and provides
 * search, directory listing, and file reading. One instance per
 * workspace root, reference-counted via acquire/release.
 *
 * File index is built from `git ls-files` (tracked) +
 * `git ls-files --others --exclude-standard` (untracked).
 * Git status decorations from `git status --porcelain`.
 * Live updates via `fs.watch` with recursive option.
 */

import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { watch, type FSWatcher } from "node:fs";
import { join, dirname, basename, sep, posix, resolve } from "node:path";
import { promisify } from "node:util";
import { fuzzyScore } from "./scorer.ts";
import type { FileEntry, FileGitStatus, FsSearchResult } from "./schemas.ts";

const execFileAsync = promisify(execFile);

const MAX_FILE_SIZE = 1024 * 1024; // 1MB read limit

type ChangeListener = () => void;

interface IndexedFile {
  path: string; // relative to root, forward slashes
  name: string;
  gitStatus: FileGitStatus | null;
}

/** Reference-counted service pool — one instance per workspace root. */
const pool = new Map<
  string,
  { service: WorkspaceFsService; refCount: number }
>();

export class WorkspaceFsService {
  readonly root: string;
  private files: IndexedFile[] = [];
  private watcher: FSWatcher | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<ChangeListener>();
  private ready: Promise<void>;

  private constructor(root: string) {
    this.root = root;
    this.ready = this.refresh();
    this.startWatcher();
  }

  /** Acquire a service for the given root. Shares existing instances. */
  static acquire(root: string): WorkspaceFsService {
    const existing = pool.get(root);
    if (existing) {
      existing.refCount++;
      return existing.service;
    }
    const service = new WorkspaceFsService(root);
    pool.set(root, { service, refCount: 1 });
    return service;
  }

  /** Release a reference. Disposes when refcount hits zero (after grace period). */
  static release(root: string): void {
    const entry = pool.get(root);
    if (!entry) return;
    entry.refCount--;
    if (entry.refCount <= 0) {
      // Grace period: keep alive for 5s in case user switches back
      setTimeout(() => {
        const current = pool.get(root);
        if (current && current.refCount <= 0) {
          current.service.dispose();
          pool.delete(root);
        }
      }, 5000);
    }
  }

  /** Wait for the initial file index to be ready. */
  async waitReady(): Promise<void> {
    await this.ready;
  }

  /** Search files by fuzzy query. Returns top N results sorted by score. */
  search(query: string, limit = 50): FsSearchResult[] {
    if (!query) {
      // Empty query: return recent/all files up to limit
      return this.files.slice(0, limit).map((f) => ({
        path: f.path,
        name: f.name,
        gitStatus: f.gitStatus,
        score: 0,
        matches: [],
      }));
    }

    const results: FsSearchResult[] = [];
    for (const file of this.files) {
      const result = fuzzyScore(query, file.path);
      if (result) {
        results.push({
          path: file.path,
          name: file.name,
          gitStatus: file.gitStatus,
          score: result.score,
          matches: result.matches,
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /** List entries in a directory (one level deep). */
  listDir(dirPath: string): FileEntry[] {
    const prefix = dirPath ? dirPath.replace(/\/$/, "") + "/" : "";
    const seen = new Map<string, FileEntry>();

    for (const file of this.files) {
      if (!file.path.startsWith(prefix)) continue;

      const rest = file.path.slice(prefix.length);
      const slashIdx = rest.indexOf("/");

      if (slashIdx === -1) {
        // Direct child file
        seen.set(file.name, {
          path: file.path,
          name: file.name,
          kind: "file",
          gitStatus: file.gitStatus,
        });
      } else {
        // Subdirectory — aggregate git status
        const dirName = rest.slice(0, slashIdx);
        const dirFullPath = prefix + dirName;
        if (!seen.has(dirName)) {
          seen.set(dirName, {
            path: dirFullPath,
            name: dirName,
            kind: "directory",
            gitStatus: file.gitStatus,
          });
        } else if (file.gitStatus) {
          // If any child is modified, mark the directory
          const existing = seen.get(dirName)!;
          if (!existing.gitStatus) {
            existing.gitStatus = file.gitStatus;
          }
        }
      }
    }

    // Sort: directories first, then alphabetical
    return [...seen.values()].sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  /** Read file contents. Truncates at 1MB. Rejects paths that escape the root. */
  async readFile(filePath: string): Promise<{
    content: string;
    lineCount: number;
    byteLength: number;
    truncated: boolean;
  }> {
    const absPath = resolve(this.root, filePath);
    // Prevent path traversal (e.g. ../../etc/passwd)
    if (!absPath.startsWith(this.root + sep) && absPath !== this.root) {
      throw new Error(`Path escapes workspace root: ${filePath}`);
    }
    const stats = await stat(absPath);

    if (stats.size > MAX_FILE_SIZE) {
      const { createReadStream } = await import("node:fs");
      const content = await new Promise<string>((resolve, reject) => {
        let data = "";
        const stream = createReadStream(absPath, {
          encoding: "utf-8",
          start: 0,
          end: MAX_FILE_SIZE - 1,
        });
        stream.on("data", (chunk) => (data += String(chunk)));
        stream.on("end", () => resolve(data));
        stream.on("error", reject);
      });
      return {
        content,
        lineCount: content.split("\n").length,
        byteLength: stats.size,
        truncated: true,
      };
    }

    const content = await readFile(absPath, "utf-8");
    return {
      content,
      lineCount: content.split("\n").length,
      byteLength: stats.size,
      truncated: false,
    };
  }

  /** Subscribe to change notifications. Returns unsubscribe function. */
  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async refresh(): Promise<void> {
    try {
      const [allFiles, statusMap] = await Promise.all([
        this.getFileList(),
        this.getGitStatus(),
      ]);

      this.files = allFiles.map((path) => ({
        path,
        name: basename(path),
        gitStatus: statusMap.get(path) ?? null,
      }));
    } catch {
      // Git commands can fail (not a git repo, etc.) — keep existing index
    }
  }

  private async getFileList(): Promise<string[]> {
    // Tracked + untracked (respecting .gitignore)
    const [tracked, untracked] = await Promise.all([
      execFileAsync("git", ["ls-files", "-z", "--cached"], {
        cwd: this.root,
        maxBuffer: 50 * 1024 * 1024,
      }),
      execFileAsync(
        "git",
        ["ls-files", "-z", "--others", "--exclude-standard"],
        { cwd: this.root, maxBuffer: 50 * 1024 * 1024 },
      ),
    ]);

    const files = new Set<string>();
    for (const output of [tracked.stdout, untracked.stdout]) {
      for (const entry of output.split("\0")) {
        const path = entry.trim();
        if (path) files.add(posixPath(path));
      }
    }
    return [...files].sort();
  }

  private async getGitStatus(): Promise<Map<string, FileGitStatus>> {
    const { stdout } = await execFileAsync(
      "git",
      ["status", "--porcelain", "-z"],
      { cwd: this.root, maxBuffer: 10 * 1024 * 1024 },
    );

    const statuses = new Map<string, FileGitStatus>();
    // porcelain -z format: XY<space>path\0 (or XY<space>path\0path\0 for renames)
    const entries = stdout.split("\0");
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!;
      if (entry.length < 3) continue;

      const xy = entry.slice(0, 2);
      const path = posixPath(entry.slice(3));

      const status = parseGitStatus(xy);
      if (status) statuses.set(path, status);

      // Renames have an extra path (the old name)
      if (xy[0] === "R" || xy[1] === "R") i++;
    }

    return statuses;
  }

  private startWatcher(): void {
    try {
      this.watcher = watch(
        this.root,
        { recursive: true },
        (_event, filename) => {
          if (!filename) return;
          // Ignore .git directory changes
          if (filename.startsWith(".git" + sep) || filename === ".git") return;

          this.scheduleRefresh();
        },
      );
      this.watcher.on("error", () => {
        // Watcher can fail on some platforms — degrade gracefully
        this.watcher?.close();
        this.watcher = null;
      });
    } catch {
      // fs.watch not available with recursive on this platform
    }
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) return;
    this.refreshTimer = setTimeout(async () => {
      this.refreshTimer = null;
      await this.refresh();
      for (const listener of this.listeners) {
        try {
          listener();
        } catch {
          // Listener threw — ignore
        }
      }
    }, 150);
  }

  private dispose(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.watcher?.close();
    this.watcher = null;
    this.listeners.clear();
    this.files = [];
  }
}

function posixPath(p: string): string {
  return p.replaceAll("\\", "/");
}

function parseGitStatus(xy: string): FileGitStatus | null {
  const index = xy[0]!;
  const working = xy[1]!;

  if (index === "?" && working === "?") return "untracked";
  if (index === "A" || working === "A") return "added";
  if (index === "D" || working === "D") return "deleted";
  if (index === "R" || working === "R") return "renamed";
  if (index === "M" || working === "M") return "modified";
  if (index === " " && working === " ") return null;
  return "modified"; // fallback for other states (C, U, etc.)
}
