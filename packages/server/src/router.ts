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

import {
  BRACKETED_PASTE_END,
  BRACKETED_PASTE_START,
} from "@kolu/terminal-protocol";
import { unwrapGit } from "@kolu/terminal-workspace/endpoint";
import { ORPCError } from "@orpc/server";
import { loadClaudeCodeTranscript } from "kolu-claude-code";
import { loadCodexTranscript } from "kolu-codex";
import type { Transcript, TranscriptPr } from "kolu-common/transcript";
import { rejectionFor, sizeRejectionFor } from "kolu-common/upload";
import { worktreeCreate, worktreeRemove } from "kolu-git";
import { prValue } from "anyforge/schemas";
import { loadOpenCodeTranscript } from "kolu-opencode";
import { transcriptToHtml } from "kolu-transcript-html";
import { match } from "ts-pattern";
import { serverHostname } from "./hostname.ts";
import { log } from "./log.ts";
import { restartLocalDaemon } from "./ptyHost/restartLocal.ts";
import { pwaIdentityForHostname } from "./pwaIdentity.ts";
import { surfaceRouter, t } from "./surface.ts";
import {
  type ActiveTerminalProcess,
  getTerminal,
  requireActiveTerminal,
  terminalNotFound,
  type TerminalProcess,
} from "./terminal-registry.ts";
import {
  discardLocalSleeping,
  localTerminalEndpoint,
  seedSleepingTerminal,
  wakeLocalTerminal,
} from "./terminalEndpoint/local.ts";
import { saveTerminalFile } from "./terminalScratch.ts";
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
  sleepTerminal,
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
function bracketedPastePath(entry: ActiveTerminalProcess, path: string): void {
  entry.handle.write(`${BRACKETED_PASTE_START}${path}${BRACKETED_PASTE_END}`);
}

export const appRouter = t.router({
  ...surfaceRouter,
  server: {
    // Per-host BRANDING the shell needs synchronously at boot (document title,
    // watermark, PWA theme color). The restart axis (`processId`) and the build
    // identity (`commit` + `ptyHost`) moved to the surface, owned by
    // @kolu/surface-app — see `surface.ts`'s `serverIdentity()` / `buildInfoServer`.
    info: t.server.info.handler(async () => ({
      identity: pwaIdentityForHostname(serverHostname),
    })),
  },
  terminal: {
    create: t.terminal.create.handler(async ({ input }) => {
      // A sub-terminal must hang off a LIVE parent. Reject a `parentId` that is
      // absent or SLEEPING (F3): the client gates split actions on the active
      // arm, but a raw RPC or a multi-client race could still ask to create a
      // child under a dormant parent — `TerminalContent` then renders only the
      // parent's dormant body and the new active sub-terminal would be a hidden
      // live PTY with no visible home. `requireActiveTerminal` is the same
      // live-PTY narrow every per-terminal handler uses; a sleeping/absent id is
      // "not found" to it by the same code.
      if (input.parentId !== undefined) requireActiveTerminal(input.parentId);
      return createTerminal(input.cwd, input.parentId, {
        themeName: input.themeName,
        canvasLayout: input.canvasLayout,
        subPanel: input.subPanel,
        rightPanel: input.rightPanel,
        lastActivityAt: input.lastActivityAt,
        intent: input.intent,
      });
    }),

    resize: t.terminal.resize.handler(async ({ input }) => {
      requireActiveTerminal(input.id).handle.resize(input.cols, input.rows);
    }),

    sendInput: t.terminal.sendInput.handler(async ({ input }) => {
      requireActiveTerminal(input.id).handle.write(input.data);
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
     * Yields the serialized screen state ALWAYS as the first frame (for
     * late-joining clients) — including the empty string when the PTY hasn't
     * produced output yet — then streams live output. The unconditional first
     * frame is a wire contract: it is the snapshot/delta boundary the client
     * relies on (`createSnapshotBoundary`) to tell a replayed snapshot from a
     * genuine live delta. Dropping an empty snapshot would make a blank
     * terminal's first real byte look like the snapshot and misclassify it.
     * Subscribe-before-serialize ordering guarantees no output is lost between
     * snapshot and live stream. (Yielding `""` is schema-valid — the contract
     * output is `z.string()` — and a no-op `term.write("")` for xterm.)
     */
    attach: t.terminal.attach.handler(async function* ({ input, signal }) {
      requireActiveTerminal(input.id);
      const { snapshot, deltas } = await localTerminalEndpoint.attach(
        input.id,
        signal,
      );
      yield snapshot;
      for await (const data of deltas) yield data;
    }),

    screenState: t.terminal.screenState.handler(async ({ input }) => {
      return await requireActiveTerminal(input.id).handle.getScreenState();
    }),

    screenText: t.terminal.screenText.handler(async ({ input }) => {
      return await requireActiveTerminal(input.id).handle.getScreenText(
        input.startLine,
        input.endLine,
      );
    }),

    pasteImage: t.terminal.pasteImage.handler(async ({ input }) => {
      const entry = requireActiveTerminal(input.id);
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
      const entry = requireActiveTerminal(input.id);
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

    sleep: t.terminal.sleep.handler(async ({ input }) => {
      log.info({ terminal: input.id }, "sleep");
      await sleepTerminal(input.id);
    }),

    wake: t.terminal.wake.handler(async ({ input }) => {
      log.info({ terminal: input.id }, "wake");
      const info = wakeLocalTerminal(input.id);
      if (!info) throw terminalNotFound(input.id);
      return info;
    }),

    discardSleeping: t.terminal.discardSleeping.handler(async ({ input }) => {
      log.info({ terminal: input.id }, "discard sleeping");
      discardLocalSleeping(input.id);
    }),

    restoreSleeping: t.terminal.restoreSleeping.handler(async ({ input }) => {
      seedSleepingTerminal(input);
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
        const term = requireActiveTerminal(input.id);
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
        const html = await transcriptToHtml(transcript, { mode: input.mode });
        const safeId = agent.sessionId.replace(/[^a-zA-Z0-9_-]/g, "");
        const filename = `kolu-${agent.kind}-${safeId.slice(0, 12)}-${input.mode}.html`;
        return { html, filename };
      },
    ),

    // ── PR2: on-disk history (the copy-mode pager + un-clipped PDF) ──────────
    history: t.terminal.history.handler(async ({ input }) => {
      requireActiveTerminal(input.id);
      return localTerminalEndpoint.history(input.id, {
        beforeCursor: input.beforeCursor,
        maxLines: input.maxLines,
      });
    }),

    searchHistory: t.terminal.searchHistory.handler(async ({ input }) => {
      requireActiveTerminal(input.id);
      return localTerminalEndpoint.searchHistory(input.id, {
        query: input.query,
        beforeCursor: input.beforeCursor,
        caseSensitive: input.caseSensitive,
        maxResults: input.maxResults,
      });
    }),

    exportHistory: t.terminal.exportHistory.handler(async function* ({
      input,
      signal,
    }) {
      requireActiveTerminal(input.id);
      const segs = await localTerminalEndpoint.exportHistory(input.id, signal);
      for await (const seg of segs) yield seg;
    }),
  },
  daemon: {
    restart: t.daemon.restart.handler(async () => {
      log.info({}, "kaval restart requested");
      await restartLocalDaemon();
    }),
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
});
