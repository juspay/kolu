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
import type {
  FileEntry,
  FileGitStatus,
  FileStaging,
  FsSearchResult,
  DiffHunk,
  DiffLine,
  FsFileDiffOutput,
  BlameLine,
  FsBlameOutput,
} from "./schemas.ts";

const execFileAsync = promisify(execFile);

const MAX_FILE_SIZE = 1024 * 1024; // 1MB read limit

type ChangeListener = () => void;

interface IndexedFile {
  path: string; // relative to root, forward slashes
  name: string;
  gitStatus: FileGitStatus | null;
  staging: FileStaging | null;
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
        staging: f.staging,
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
          staging: file.staging,
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
          staging: file.staging,
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
            staging: file.staging,
          });
        } else if (file.gitStatus) {
          // If any child is modified, mark the directory
          const existing = seen.get(dirName)!;
          if (!existing.gitStatus) {
            existing.gitStatus = file.gitStatus;
            existing.staging = file.staging;
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

  /** Read file contents. Truncates at 1MB. Rejects paths that escape the root.
   *  Binary files (images) are returned as base64-encoded content with a mimeType hint. */
  async readFile(filePath: string): Promise<{
    content: string;
    lineCount: number;
    byteLength: number;
    truncated: boolean;
    binary?: boolean;
    mimeType?: string;
  }> {
    const absPath = resolve(this.root, filePath);
    // Prevent path traversal (e.g. ../../etc/passwd)
    if (!absPath.startsWith(this.root + sep) && absPath !== this.root) {
      throw new Error(`Path escapes workspace root: ${filePath}`);
    }
    const stats = await stat(absPath);

    // Check for binary/image files by extension
    const mime = getMimeType(filePath);
    if (mime) {
      // Binary file — return base64-encoded (cap at 5MB for images)
      if (stats.size > 5 * 1024 * 1024) {
        return {
          content: "",
          lineCount: 0,
          byteLength: stats.size,
          truncated: true,
          binary: true,
          mimeType: mime,
        };
      }
      const buf = await readFile(absPath);
      return {
        content: buf.toString("base64"),
        lineCount: 0,
        byteLength: stats.size,
        truncated: false,
        binary: true,
        mimeType: mime,
      };
    }

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

  /** Get parsed unified diff for a file against HEAD. */
  async fileDiff(filePath: string): Promise<FsFileDiffOutput> {
    const { stdout } = await execFileAsync(
      "git",
      ["diff", "HEAD", "--", filePath],
      { cwd: this.root, maxBuffer: 10 * 1024 * 1024 },
    ).catch(() => ({ stdout: "" }));

    if (!stdout.trim()) {
      // No diff — file might be untracked, check git status
      const { stdout: statusOut } = await execFileAsync(
        "git",
        ["status", "--porcelain", "--", filePath],
        { cwd: this.root },
      ).catch(() => ({ stdout: "" }));

      if (statusOut.startsWith("??")) {
        // Untracked file — entire file is "added"
        const content = await this.readFile(filePath);
        const lines = content.content.split("\n");
        const addedLines = lines.map((_, i) => i + 1);
        const hunkLines: DiffLine[] = lines.map((line, i) => ({
          kind: "add" as const,
          content: line,
          newLine: i + 1,
          oldLine: null,
        }));
        return {
          hunks: [
            {
              oldStart: 0,
              oldCount: 0,
              newStart: 1,
              newCount: lines.length,
              lines: hunkLines,
            },
          ],
          addedLines,
          modifiedLines: [],
          deletedAfterLines: [],
        };
      }

      return {
        hunks: [],
        addedLines: [],
        modifiedLines: [],
        deletedAfterLines: [],
      };
    }

    return parseDiff(stdout);
  }

  /** Get git blame for a file. Returns per-line blame info. */
  async blame(filePath: string): Promise<FsBlameOutput> {
    const { stdout } = await execFileAsync(
      "git",
      ["blame", "--porcelain", "--", filePath],
      { cwd: this.root, maxBuffer: 10 * 1024 * 1024 },
    ).catch(() => ({ stdout: "" }));

    if (!stdout.trim()) return { lines: [] };
    return parseBlame(stdout);
  }

  /** Stage a file (git add). */
  async stageFile(filePath: string): Promise<void> {
    await execFileAsync("git", ["add", "--", filePath], { cwd: this.root });
    this.scheduleRefresh();
  }

  /** Unstage a file (git reset HEAD). */
  async unstageFile(filePath: string): Promise<void> {
    await execFileAsync("git", ["reset", "HEAD", "--", filePath], {
      cwd: this.root,
    }).catch(() => {
      // reset fails on initial commit — ignore
    });
    this.scheduleRefresh();
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

      this.files = allFiles.map((path) => {
        const info = statusMap.get(path);
        return {
          path,
          name: basename(path),
          gitStatus: info?.status ?? null,
          staging: info?.staging ?? null,
        };
      });
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

  private async getGitStatus(): Promise<
    Map<string, { status: FileGitStatus; staging: FileStaging }>
  > {
    const { stdout } = await execFileAsync(
      "git",
      ["status", "--porcelain", "-z"],
      { cwd: this.root, maxBuffer: 10 * 1024 * 1024 },
    );

    const statuses = new Map<
      string,
      { status: FileGitStatus; staging: FileStaging }
    >();
    // porcelain -z format: XY<space>path\0 (or XY<space>path\0path\0 for renames)
    const entries = stdout.split("\0");
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!;
      if (entry.length < 3) continue;

      const xy = entry.slice(0, 2);
      const path = posixPath(entry.slice(3));

      const status = parseGitStatus(xy);
      if (status) {
        statuses.set(path, { status, staging: parseStaging(xy) });
      }

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

/** Parse unified diff output into structured hunks + gutter info. */
function parseDiff(raw: string): FsFileDiffOutput {
  const hunks: DiffHunk[] = [];
  const addedLines: number[] = [];
  const modifiedLines: number[] = [];
  const deletedAfterLines: number[] = [];

  const lines = raw.split("\n");
  let i = 0;

  // Skip diff header lines (diff --git, index, ---, +++)
  while (i < lines.length && !lines[i]!.startsWith("@@")) i++;

  while (i < lines.length) {
    const hunkHeader = lines[i]!.match(
      /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/,
    );
    if (!hunkHeader) {
      i++;
      continue;
    }

    const oldStart = parseInt(hunkHeader[1]!);
    const oldCount = parseInt(hunkHeader[2] ?? "1");
    const newStart = parseInt(hunkHeader[3]!);
    const newCount = parseInt(hunkHeader[4] ?? "1");

    const hunkLines: DiffLine[] = [];
    let oldLine = oldStart;
    let newLine = newStart;
    i++;

    // Track consecutive remove+add runs within a hunk to detect modifications
    let removeRun: number[] = [];
    let addRun: number[] = [];

    function flushRuns() {
      if (removeRun.length > 0 && addRun.length > 0) {
        // Paired removes + adds = modifications
        const paired = Math.min(removeRun.length, addRun.length);
        for (let j = 0; j < paired; j++) modifiedLines.push(addRun[j]!);
        // Extra adds beyond the paired count are pure additions
        for (let j = paired; j < addRun.length; j++)
          addedLines.push(addRun[j]!);
        // Extra removes beyond paired = deletions
        if (removeRun.length > addRun.length) {
          // Mark the line after the last add as a deletion marker
          const markerLine =
            addRun.length > 0 ? addRun[addRun.length - 1]! : newLine;
          deletedAfterLines.push(markerLine);
        }
      } else if (removeRun.length > 0) {
        // Pure deletions
        deletedAfterLines.push(newLine);
      } else if (addRun.length > 0) {
        // Pure additions
        for (const l of addRun) addedLines.push(l);
      }
      removeRun = [];
      addRun = [];
    }

    while (i < lines.length && !lines[i]!.startsWith("@@")) {
      const line = lines[i]!;
      if (line.startsWith("+")) {
        if (removeRun.length === 0 && addRun.length === 0) {
          // Starting a new run
        }
        addRun.push(newLine);
        hunkLines.push({
          kind: "add",
          content: line.slice(1),
          newLine,
          oldLine: null,
        });
        newLine++;
      } else if (line.startsWith("-")) {
        removeRun.push(oldLine);
        hunkLines.push({
          kind: "remove",
          content: line.slice(1),
          newLine: null,
          oldLine,
        });
        oldLine++;
      } else if (line.startsWith(" ") || line === "") {
        flushRuns();
        hunkLines.push({
          kind: "context",
          content: line.slice(1),
          newLine,
          oldLine,
        });
        newLine++;
        oldLine++;
      } else {
        // End of diff (e.g. "\ No newline at end of file")
        break;
      }
      i++;
    }
    flushRuns();

    hunks.push({ oldStart, oldCount, newStart, newCount, lines: hunkLines });
  }

  return { hunks, addedLines, modifiedLines, deletedAfterLines };
}

/** Known binary/image MIME types by extension. */
const MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  bmp: "image/bmp",
  avif: "image/avif",
};

function getMimeType(filePath: string): string | undefined {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return MIME_TYPES[ext];
}

/** Parse `git blame --porcelain` output into structured line data. */
function parseBlame(raw: string): FsBlameOutput {
  const lines: BlameLine[] = [];
  const commitInfo = new Map<
    string,
    { author: string; date: string; summary: string }
  >();

  const rawLines = raw.split("\n");
  let i = 0;

  while (i < rawLines.length) {
    const headerMatch = rawLines[i]?.match(
      /^([0-9a-f]{40})\s+(\d+)\s+(\d+)(?:\s+(\d+))?$/,
    );
    if (!headerMatch) {
      i++;
      continue;
    }

    const sha = headerMatch[1]!.slice(0, 8);
    const lineNum = parseInt(headerMatch[3]!);
    i++;

    // Parse header fields until content line
    let author = "";
    let date = "";
    let summary = "";

    while (i < rawLines.length && !rawLines[i]?.startsWith("\t")) {
      const line = rawLines[i]!;
      if (line.startsWith("author ")) author = line.slice(7);
      else if (line.startsWith("author-time ")) {
        const ts = parseInt(line.slice(12));
        date = new Date(ts * 1000).toISOString().slice(0, 10);
      } else if (line.startsWith("summary ")) summary = line.slice(8);
      i++;
    }

    // Skip content line
    if (i < rawLines.length && rawLines[i]?.startsWith("\t")) i++;

    // Cache commit info for repeated SHAs
    if (author || summary) {
      commitInfo.set(sha, { author, date, summary });
    }

    const info = commitInfo.get(sha) ?? { author: "", date: "", summary: "" };
    lines.push({
      line: lineNum,
      sha,
      author: info.author,
      date: info.date,
      summary: info.summary,
    });
  }

  return { lines };
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

/** Derive staging state from porcelain XY columns.
 *  X = index (staged changes), Y = working tree (unstaged changes).
 *  " " means no change in that column. */
function parseStaging(xy: string): FileStaging {
  const index = xy[0]!;
  const working = xy[1]!;

  if (index === "?" && working === "?") return "unstaged"; // untracked = unstaged
  const hasStaged = index !== " " && index !== "?";
  const hasUnstaged = working !== " " && working !== "?";
  if (hasStaged && hasUnstaged) return "partial";
  if (hasStaged) return "staged";
  return "unstaged";
}
