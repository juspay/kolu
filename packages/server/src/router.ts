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
import { ORPCError } from "@orpc/server";
import { loadClaudeCodeTranscript } from "kolu-claude-code";
import { loadCodexTranscript } from "kolu-codex";
import type { Transcript, TranscriptPr } from "kolu-common/transcript";
import { rejectionFor, sizeRejectionFor } from "kolu-common/upload";
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
  getTerminal,
  terminalNotFound,
  type TerminalProcess,
} from "./terminal-registry.ts";
import {
  endpointFor,
  endpointForTerminal,
} from "./terminalEndpoint/registry.ts";
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
    create: t.terminal.create.handler(async ({ input }) =>
      createTerminal(
        input.cwd,
        input.parentId,
        {
          themeName: input.themeName,
          canvasLayout: input.canvasLayout,
          subPanel: input.subPanel,
          rightPanel: input.rightPanel,
          lastActivityAt: input.lastActivityAt,
          intent: input.intent,
        },
        input.hostId,
      ),
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
      // Route attach to the terminal's owning endpoint (a remote terminal
      // streams over its watcher; absent location ⇒ local).
      const { snapshot, deltas } = await endpointForTerminal(input.id).attach(
        input.id,
        signal,
      );
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
      // Write to the terminal's OWNING endpoint's scratch (local or the remote
      // host over the watcher) so the bracketed-paste path resolves where the
      // PTY actually runs, not on kolu-server's filesystem.
      const { path } = await endpointForTerminal(input.id).fs.writeFile(
        input.id,
        "image.png",
        input.data,
      );
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
      const { path } = await endpointForTerminal(input.id).fs.writeFile(
        input.id,
        input.name,
        input.data,
      );
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
  daemon: {
    restart: t.daemon.restart.handler(async () => {
      log.info({}, "kaval restart requested");
      await restartLocalDaemon();
    }),
  },
  git: {
    worktreeCreate: t.git.worktreeCreate.handler(async ({ input }) => {
      log.info(
        { repo: input.repoPath, name: input.name, host: input.hostId },
        "worktree create",
      );
      // Route through the OWNING host's endpoint (`endpointFor(hostId)`, not the
      // terminal-id resolver) so a remote tile's worktree lands on the host the
      // repo lives on; absent hostId ⇒ local. The endpoint unwraps GitResult and
      // throws ORPCError on failure.
      const result = await endpointFor(input.hostId).git.worktreeCreate(
        input.repoPath,
        input.name,
      );
      log.info(
        { repo: input.repoPath, path: result.path, branch: result.branch },
        "worktree created",
      );
      return result;
    }),
    worktreeRemove: t.git.worktreeRemove.handler(async ({ input }) => {
      log.info(
        { worktree: input.worktreePath, host: input.hostId },
        "worktree remove",
      );
      await endpointFor(input.hostId).git.worktreeRemove(input.worktreePath);
    }),
  },
});
