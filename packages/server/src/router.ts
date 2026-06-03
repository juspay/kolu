/**
 * oRPC router: composes the surface router fragment (`./surface.ts`) with
 * hand-listed raw oRPC handlers (terminal lifecycle, attach, git
 * mutations, server info).
 *
 * The typed reactive layer goes through `surfaceRouter` (from `./surface.ts`)
 * and `surfaceCtx` (from `./surfaceCtx.ts`). Domain mutations import
 * `surfaceCtx` from `./surfaceCtx.ts` directly. This file is just the glue
 * between the surface fragment and the raw RPCs.
 */

import { constants as fsConstants } from "node:fs";
import { open } from "node:fs/promises";
import { ORPCError } from "@orpc/server";
import { loadClaudeCodeTranscript } from "kolu-claude-code";
import { loadCodexTranscript } from "kolu-codex";
import type { Transcript, TranscriptPr } from "kolu-common/transcript";
import { rejectionFor, sizeRejectionFor } from "kolu-common/upload";
import { resolveForWriteUnder, worktreeCreate, worktreeRemove } from "kolu-git";
import { prValue } from "kolu-github/schemas";
import { loadOpenCodeTranscript } from "kolu-opencode";
import { transcriptToHtml } from "kolu-transcript-html";
import { match } from "ts-pattern";
import { serverCommit, serverHostname, serverProcessId } from "./hostname.ts";
import { log } from "./log.ts";
import { pwaIdentityForHostname } from "./pwaIdentity.ts";
import { surfaceRouter, t } from "./surface.ts";
import {
  getTerminal,
  terminalNotFound,
  type TerminalProcess,
} from "./terminal-registry.ts";
import { getTerminalBackendFor } from "./terminalBackend/index.ts";
import { ptyHostIdentity } from "./terminalBackend/local.ts";
import { saveTerminalFile } from "./terminalScratch.ts";
import { unwrapGit } from "./unwrapGit.ts";
import {
  createTerminal,
  killAllTerminals,
  killTerminal,
  setActiveTerminalId,
  setCanvasLayout,
  setRightPanelState,
  setSubPanelState,
  setTerminalIntent,
  setTerminalParent,
  setTerminalTheme,
} from "./terminals.ts";

/** Get terminal or throw — shared by all per-terminal handlers. */
function requireTerminal(id: string): TerminalProcess {
  const entry = getTerminal(id);
  if (!entry) throw terminalNotFound(id);
  return entry;
}

/** Decoded byte length of a base64 string — `(len * 3/4)` minus padding.
 *  Lets handlers gate on size without materializing the Buffer. */
function base64DecodedLength(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.floor((data.length * 3) / 4) - padding;
}

/** Bracketed-paste an on-disk path into a terminal so agents that accept
 *  paste-as-file-path (codex, Claude Code) attach the file. Shared by every
 *  handler that uploads content to per-terminal scratch storage. */
function bracketedPastePath(entry: TerminalProcess, path: string): void {
  entry.handle.write(`\x1b[200~${path}\x1b[201~`);
}

export const appRouter = t.router({
  ...surfaceRouter,
  server: {
    info: t.server.info.handler(async () => ({
      identity: pwaIdentityForHostname(serverHostname),
      processId: serverProcessId,
      commit: serverCommit,
      ptyHost: await ptyHostIdentity,
    })),
  },
  terminal: {
    create: t.terminal.create.handler(async ({ input }) =>
      createTerminal(input.cwd, input.parentId, {
        themeName: input.themeName,
        canvasLayout: input.canvasLayout,
        subPanel: input.subPanel,
        rightPanel: input.rightPanel,
        lastActivityAt: input.lastActivityAt,
        intent: input.intent,
      }),
    ),

    resize: t.terminal.resize.handler(async ({ input }) => {
      requireTerminal(input.id).handle.resize(input.cols, input.rows);
    }),

    sendInput: t.terminal.sendInput.handler(async ({ input }) => {
      requireTerminal(input.id).handle.write(input.data);
    }),

    setTheme: t.terminal.setTheme.handler(async ({ input }) => {
      requireTerminal(input.id);
      log.info({ terminal: input.id, theme: input.themeName }, "set theme");
      setTerminalTheme(input.id, input.themeName);
    }),

    setIntent: t.terminal.setIntent.handler(async ({ input }) => {
      requireTerminal(input.id);
      log.info(
        { terminal: input.id, intentLength: input.intent.length },
        "set intent",
      );
      setTerminalIntent(input.id, input.intent);
    }),

    setCanvasLayout: t.terminal.setCanvasLayout.handler(async ({ input }) => {
      requireTerminal(input.id);
      setCanvasLayout(input.id, input.layout);
    }),

    setSubPanel: t.terminal.setSubPanel.handler(async ({ input }) => {
      requireTerminal(input.id);
      setSubPanelState(input.id, {
        collapsed: input.collapsed,
        panelSize: input.panelSize,
      });
    }),

    setRightPanel: t.terminal.setRightPanel.handler(async ({ input }) => {
      requireTerminal(input.id);
      const { id: _id, ...state } = input;
      setRightPanelState(input.id, state);
    }),

    setActive: t.terminal.setActive.handler(async ({ input }) => {
      setActiveTerminalId(input.id);
    }),

    /**
     * Attach to a terminal's output stream.
     *
     * Yields serialized screen state first (for late-joining clients),
     * then streams live output. Subscribe-before-serialize ordering
     * guarantees no output is lost between snapshot and live stream.
     */
    attach: t.terminal.attach.handler(async function* ({ input, signal }) {
      requireTerminal(input.id);
      const { snapshot, deltas } = await getTerminalBackendFor({
        kind: "local",
      }).attach(input.id, signal);
      if (snapshot) yield snapshot;
      for await (const data of deltas) yield data;
    }),

    screenState: t.terminal.screenState.handler(async ({ input }) => {
      return await requireTerminal(input.id).handle.getScreenState();
    }),

    screenText: t.terminal.screenText.handler(async ({ input }) => {
      return await requireTerminal(input.id).handle.getScreenText(
        input.startLine,
        input.endLine,
      );
    }),

    pasteImage: t.terminal.pasteImage.handler(async ({ input }) => {
      const entry = requireTerminal(input.id);
      const bytes = base64DecodedLength(input.data);
      const reason = sizeRejectionFor("clipboard image", bytes);
      if (reason !== null) {
        throw new ORPCError("BAD_REQUEST", { message: reason });
      }
      const path = saveTerminalFile(input.id, "image.png", input.data);
      bracketedPastePath(entry, path);
      log.info({ terminal: input.id, bytes, path }, "paste image");
    }),

    uploadFile: t.terminal.uploadFile.handler(async ({ input }) => {
      const entry = requireTerminal(input.id);
      const bytes = base64DecodedLength(input.data);
      const reason = rejectionFor(input.name, bytes);
      if (reason !== null) {
        throw new ORPCError("BAD_REQUEST", { message: reason });
      }
      const path = saveTerminalFile(input.id, input.name, input.data);
      bracketedPastePath(entry, path);
      log.info(
        { terminal: input.id, name: input.name, bytes, path },
        "upload file",
      );
    }),

    kill: t.terminal.kill.handler(async ({ input }) => {
      const info = await killTerminal(input.id);
      if (!info) throw terminalNotFound(input.id);
      return info;
    }),

    setParent: t.terminal.setParent.handler(async ({ input }) => {
      requireTerminal(input.id);
      log.info(
        { terminal: input.id, parent: input.parentId },
        "set terminal parent",
      );
      setTerminalParent(input.id, input.parentId);
    }),

    killAll: t.terminal.killAll.handler(async () => {
      await killAllTerminals();
    }),

    exportTranscriptHtml: t.terminal.exportTranscriptHtml.handler(
      async ({ input }) => {
        const term = requireTerminal(input.id);
        const agent = term.meta.agent;
        if (!agent) {
          throw new ORPCError("PRECONDITION_FAILED", {
            message:
              "No active agent session in this terminal — start Claude Code, OpenCode, or Codex first",
          });
        }
        const cwd = term.meta.cwd;
        const repoName = term.meta.git?.repoName ?? null;
        const prInfo = prValue(term.meta.pr);
        const pr: TranscriptPr | null = prInfo
          ? { number: prInfo.number, url: prInfo.url }
          : null;
        const transcript = match<typeof agent, Transcript | null>(agent)
          .with({ kind: "claude-code" }, (a) =>
            loadClaudeCodeTranscript({
              sessionId: a.sessionId,
              cwd,
              title: a.summary,
              repoName,
              model: a.model,
              contextTokens: a.contextTokens,
              pr,
            }),
          )
          .with({ kind: "opencode" }, (a) =>
            loadOpenCodeTranscript(
              {
                sessionId: a.sessionId,
                title: a.summary,
                repoName,
                cwd,
                model: a.model,
                contextTokens: a.contextTokens,
                pr,
              },
              log,
            ),
          )
          .with({ kind: "codex" }, (a) =>
            loadCodexTranscript(
              {
                sessionId: a.sessionId,
                title: a.summary,
                repoName,
                cwd,
                model: a.model,
                contextTokens: a.contextTokens,
                pr,
              },
              log,
            ),
          )
          .exhaustive();
        if (!transcript) {
          throw new ORPCError("NOT_FOUND", {
            message: `Transcript not found for ${agent.kind} session ${agent.sessionId}`,
          });
        }
        const html = await transcriptToHtml(transcript);
        const safeId = agent.sessionId.replace(/[^a-zA-Z0-9_-]/g, "");
        const filename = `kolu-${agent.kind}-${safeId.slice(0, 12)}.html`;
        return { html, filename };
      },
    ),
  },
  git: {
    worktreeCreate: t.git.worktreeCreate.handler(async ({ input }) => {
      log.info({ repo: input.repoPath, name: input.name }, "worktree create");
      const result = unwrapGit(
        await worktreeCreate(input.repoPath, input.name, log),
      );
      log.info(
        { repo: input.repoPath, path: result.path, branch: result.branch },
        "worktree created",
      );
      return result;
    }),
    worktreeRemove: t.git.worktreeRemove.handler(async ({ input }) => {
      log.info({ worktree: input.worktreePath }, "worktree remove");
      unwrapGit(await worktreeRemove(input.worktreePath, log));
    }),
  },
  fs: {
    // Overwrite a working-tree file (the rendered-Markdown task-list toggle).
    // A create-write needs a write-side guard, not the read-oriented
    // `resolveExistingUnder` (which fails *open* on a missing realpath target):
    // `resolveForWriteUnder` realpaths the *parent* directory and rejects when
    // it escapes the repo root or doesn't resolve. The leaf is then opened with
    // `O_NOFOLLOW` so the kernel refuses a symlinked leaf pointing out of the
    // tree — together these close the symlink write-escape that a lexical-only
    // path under a fail-open guard would leave open. The open preview
    // re-renders on its own: the `fsReadFile` watcher sees the working-tree
    // change and re-yields the new content.
    writeFile: t.fs.writeFile.handler(async ({ input }) => {
      // Pass `log` so the guard's own escape-path errors ("write parent
      // escapes root (symlink)" / "write parent not resolvable") are recorded:
      // an attempted path-traversal/symlink escape is a security-relevant
      // failure that must leave server-side evidence.
      const guard = await resolveForWriteUnder(
        input.repoPath,
        input.filePath,
        log,
      );
      if (!guard.ok) {
        // Log the rejection here too so it stays attributable to the request
        // even if the guard's internal log shape changes.
        log.warn(
          { repo: input.repoPath, file: input.filePath },
          "fs write: path escapes repo root (rejected)",
        );
        throw new ORPCError("BAD_REQUEST", {
          message: "path escapes repo root",
        });
      }
      let handle: Awaited<ReturnType<typeof open>>;
      try {
        // O_NOFOLLOW: a symlinked leaf (parent in-repo, leaf points outside)
        // is rejected by the kernel with ELOOP instead of being followed.
        handle = await open(
          guard.value.abs,
          fsConstants.O_WRONLY |
            fsConstants.O_CREAT |
            fsConstants.O_TRUNC |
            fsConstants.O_NOFOLLOW,
          0o644,
        );
      } catch (err) {
        // `open()` with O_NOFOLLOW fails for many reasons that are *not* path
        // escapes — EACCES (no write permission), EISDIR (target is a dir),
        // EROFS (read-only fs), ENOSPC (disk full), EMFILE/ENFILE. Only ELOOP
        // (a symlinked leaf the kernel refused to follow) is the escape case.
        // Log the real errno at error level and surface a faithful message so a
        // disk-full failure is never reported as a security violation.
        log.error(
          { err, repo: input.repoPath, file: input.filePath },
          "fs write: open failed",
        );
        const code = (err as NodeJS.ErrnoException)?.code;
        const message =
          code === "ELOOP"
            ? "path escapes repo root (symlinked target)"
            : `failed to open file for write: ${(err as Error).message}`;
        throw new ORPCError("BAD_REQUEST", { message });
      }
      try {
        await handle.writeFile(input.content, "utf-8");
      } finally {
        await handle.close();
      }
      log.info({ repo: input.repoPath, file: input.filePath }, "fs write");
    }),
  },
});
