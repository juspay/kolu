/**
 * oRPC router: composes the surface router fragment (`./surface.ts`) with
 * hand-listed raw oRPC handlers (terminal lifecycle, attach, git
 * mutations, server info).
 *
 * The typed reactive layer goes through `surfaceRouter` / `surfaceCtx`
 * (see `./surface.ts`). Domain mutations import `surfaceCtx` directly
 * from there. This file is just the glue between the surface fragment
 * and the raw RPCs.
 */

import { ORPCError } from "@orpc/server";
import { loadClaudeCodeTranscript } from "kolu-claude-code";
import { loadCodexTranscript } from "kolu-codex";
import type { Transcript, TranscriptPr } from "kolu-common/transcript";
import { TerminalNotFoundError } from "kolu-common/errors";
import { worktreeCreate, worktreeRemove } from "kolu-git";
import { prValue } from "kolu-github/schemas";
import { loadOpenCodeTranscript } from "kolu-opencode";
import { transcriptToHtml } from "kolu-transcript-html";
import { match } from "ts-pattern";
import { saveClipboardImage } from "./clipboard.ts";
import { getHost, isLocalHostId, listHosts } from "./host/registry.ts";
import { serverHostname, serverProcessId } from "./hostname.ts";
import { log } from "./log.ts";
import { terminalChannels } from "./publisher.ts";
import { pwaIdentityForHostname } from "./pwaIdentity.ts";
import { surfaceRouter, t, unwrapGit } from "./surface.ts";
import { getTerminal, type TerminalProcess } from "./terminal-registry.ts";
import {
  createTerminal,
  killAllTerminals,
  killTerminal,
  setActiveTerminalId,
  setCanvasLayout,
  setSubPanelState,
  setTerminalIntent,
  setTerminalParent,
  setTerminalTheme,
} from "./terminals.ts";

/** Get terminal or throw — shared by all per-terminal handlers. */
function requireTerminal(id: string): TerminalProcess {
  const entry = getTerminal(id);
  if (!entry) throw new TerminalNotFoundError(id);
  return entry;
}

export const appRouter = t.router({
  ...surfaceRouter,
  server: {
    info: t.server.info.handler(async () => ({
      identity: pwaIdentityForHostname(serverHostname),
      processId: serverProcessId,
    })),
  },
  host: {
    list: t.host.list.handler(async () => listHosts()),
  },
  terminal: {
    create: t.terminal.create.handler(async ({ input }) => {
      try {
        return await createTerminal(
          input.cwd,
          input.parentId,
          {
            themeName: input.themeName,
            canvasLayout: input.canvasLayout,
            subPanel: input.subPanel,
            lastActivityAt: input.lastActivityAt,
            intent: input.intent,
          },
          input.hostId,
        );
      } catch (err) {
        // Without this rethrow, any error coming out of `createTerminal`
        // (failed SSH connect, helper crash before ready, unknown
        // hostId) is wrapped by oRPC into an opaque "Internal server
        // error" — the actual reason is lost before it ever reaches
        // the client toast. Surface it as a BAD_REQUEST with the
        // original message preserved.
        throw new ORPCError("BAD_REQUEST", {
          message: err instanceof Error ? err.message : String(err),
          cause: err,
        });
      }
    }),

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
      const entry = requireTerminal(input.id);
      const live = terminalChannels.data(input.id).subscribe(signal);
      const screenState = entry.handle.getScreenState();
      if (screenState) yield screenState;
      for await (const data of live) yield data;
    }),

    screenState: t.terminal.screenState.handler(async ({ input }) => {
      return requireTerminal(input.id).handle.getScreenState();
    }),

    screenText: t.terminal.screenText.handler(async ({ input }) => {
      return requireTerminal(input.id).handle.getScreenText(
        input.startLine,
        input.endLine,
      );
    }),

    pasteImage: t.terminal.pasteImage.handler(async ({ input }) => {
      const entry = requireTerminal(input.id);
      // base64 → decoded byte count: (len * 3/4) minus padding
      const padding = input.data.endsWith("==")
        ? 2
        : input.data.endsWith("=")
          ? 1
          : 0;
      const bytes = Math.floor((input.data.length * 3) / 4) - padding;
      const path = saveClipboardImage(input.id, input.data);
      // Bracketed-paste the saved path into the PTY. Agents that accept
      // paste-as-file-path (codex, Claude Code) auto-attach the image.
      entry.handle.write(`\x1b[200~${path}\x1b[201~`);
      log.info({ terminal: input.id, bytes, path }, "paste image");
    }),

    kill: t.terminal.kill.handler(async ({ input }) => {
      const info = killTerminal(input.id);
      if (!info) throw new TerminalNotFoundError(input.id);
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
      killAllTerminals();
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
      log.info(
        { hostId: input.hostId, repo: input.repoPath, name: input.name },
        "worktree create",
      );
      const host = getHost(input.hostId);
      const executor = host && !isLocalHostId(host.id) ? host : undefined;
      const result = unwrapGit(
        await worktreeCreate(input.repoPath, input.name, log, executor),
      );
      log.info(
        {
          hostId: input.hostId,
          repo: input.repoPath,
          path: result.path,
          branch: result.branch,
        },
        "worktree created",
      );
      return result;
    }),
    worktreeRemove: t.git.worktreeRemove.handler(async ({ input }) => {
      log.info(
        { hostId: input.hostId, worktree: input.worktreePath },
        "worktree remove",
      );
      const host = getHost(input.hostId);
      const executor = host && !isLocalHostId(host.id) ? host : undefined;
      unwrapGit(await worktreeRemove(input.worktreePath, log, executor));
    }),
  },
});
