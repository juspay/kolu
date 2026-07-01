/**
 * Host-side transcript → HTML export — the ONE implementation both the raw
 * `terminal.exportTranscriptHtml` handler (`router.ts`) and `padiSurface`'s
 * `transcript.exportHtml` procedure (`padiSurfaceDeps.ts`) call, so the two
 * homes can't drift (the padi plan of record, PR #1649). The per-agent loaders
 * (claude JSONL, codex/opencode SQLite) run here, host-side.
 */

import { ORPCError } from "@orpc/server";
import { prValue } from "anyforge/schemas";
import { loadClaudeCodeTranscript } from "kolu-claude-code";
import { loadCodexTranscript } from "kolu-codex";
import type {
  ExportTranscriptHtmlOutput,
  Transcript,
  TranscriptHtmlMode,
  TranscriptPr,
} from "kolu-common/transcript";
import { loadOpenCodeTranscript } from "kolu-opencode";
import { transcriptToHtml } from "kolu-transcript-html";
import { match } from "ts-pattern";
import { log } from "./log.ts";
import { requireActiveTerminal } from "./terminal-registry.ts";

/** Read the active agent's transcript from disk and render a self-contained
 *  HTML export for `mode`. Throws a typed `ORPCError` when the terminal is
 *  absent/sleeping, has no active agent, or the transcript can't be found —
 *  the same failure surface both callers relied on when this lived inline. */
export async function exportTranscriptHtml(
  id: string,
  mode: TranscriptHtmlMode,
): Promise<ExportTranscriptHtmlOutput> {
  // `requireActiveTerminal` proves the terminal exists AND narrows it to the
  // active arm; awareness is a REQUIRED field on that entry (Design-S), so the
  // agent + cwd + git + pr fields are read straight off `entry.snapshot` — no
  // optional lookup, no `?? ""` / `?? pending` fallback that could mask a
  // lockstep bug.
  const { snapshot: aw } = requireActiveTerminal(id);
  const agent = aw.agent;
  if (!agent) {
    throw new ORPCError("PRECONDITION_FAILED", {
      message:
        "No active agent session in this terminal — start Claude Code, OpenCode, or Codex first",
    });
  }
  const cwd = aw.cwd;
  const repoName = aw.git?.repoName ?? null;
  const prInfo = prValue(aw.pr);
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
  const html = await transcriptToHtml(transcript, { mode });
  const safeId = agent.sessionId.replace(/[^a-zA-Z0-9_-]/g, "");
  const filename = `kolu-${agent.kind}-${safeId.slice(0, 12)}-${mode}.html`;
  return { html, filename };
}
