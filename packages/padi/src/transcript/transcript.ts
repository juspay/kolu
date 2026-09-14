/**
 * `@kolu/padi/assembly`'s host-side transcript-export backing behind
 * `padiSurface.procedures.transcript.exportHtml`. Loads the per-agent transcript
 * (Claude Code JSONL, codex/opencode SQLite) for a terminal's LIVE agent session
 * and renders it to a standalone HTML document.
 *
 * A fresh implementation living in `@kolu/padi` — kolu-server's `router.ts` keeps
 * its own `exportTranscriptHtml` handler for R0 (still served on the root
 * contract), so the logic lives in two places DURING R0 (dual-serve); R5 deletes
 * the root one. Reuses the loaders + `transcriptToHtml` unchanged; the only move
 * is the home.
 */

import {
  TranscriptNoAgent,
  TranscriptNotFound,
} from "@kolu/padi-client/surface";
import type {
  ExportTranscriptHtmlInput,
  ExportTranscriptHtmlOutput,
  TranscriptPr,
} from "@kolu/padi-client/surface";
import { prValue } from "anyforge/schemas";
import { AGENT_PLUGINS } from "kolu-agents";
import { transcriptToHtml } from "kolu-transcript-html";
import { log } from "../log.ts";
import { requireActiveTerminal } from "../terminal-registry.ts";

/** Export a terminal's live agent session as an HTML transcript.
 *
 *  `requireActiveTerminal` proves the terminal exists AND narrows it to the
 *  active arm; awareness is a REQUIRED field on that entry (Design-S), so the
 *  agent + cwd + git + pr fields are read straight off `entry.snapshot` — no
 *  optional lookup, no `?? ""` / `?? pending` fallback that could mask a
 *  lockstep bug. Raises the DECLARED `TranscriptNoAgent` when the terminal hosts
 *  no agent, `TranscriptNotFound` when the agent's transcript can't be loaded,
 *  and `TerminalNotFound` (via `requireActiveTerminal`) when the id names
 *  nothing live — the three arms `transcript.exportHtml` declares. */
export async function exportTranscriptHtml(
  input: ExportTranscriptHtmlInput,
): Promise<ExportTranscriptHtmlOutput> {
  const { snapshot: aw } = requireActiveTerminal(input.id);
  const agent = aw.agent;
  if (!agent) throw new TranscriptNoAgent();
  const cwd = aw.cwd;
  const repoName = aw.git?.repoName ?? null;
  const prInfo = prValue(aw.pr);
  const pr: TranscriptPr | null = prInfo
    ? { number: prInfo.number, url: prInfo.url }
    : null;
  // ONE dispatch, via the registry — every loader takes the same `FetcherInput`
  // and returns a `Transcript | null`, so the per-kind `.with(...)` arms that
  // used to spell this five times are gone. A new agent's fetcher is reached
  // through its plugin, with no edit here.
  const transcript = AGENT_PLUGINS[agent.kind].fetcher(
    {
      sessionId: agent.sessionId,
      title: agent.summary,
      repoName,
      cwd,
      model: agent.model,
      contextTokens: agent.contextTokens,
      pr,
    },
    log,
  );
  if (!transcript) {
    throw new TranscriptNotFound({
      agentKind: agent.kind,
      sessionId: agent.sessionId,
    });
  }
  const html = await transcriptToHtml(transcript, { mode: input.mode });
  const safeId = agent.sessionId.replace(/[^a-zA-Z0-9_-]/g, "");
  const filename = `kolu-${agent.kind}-${safeId.slice(0, 12)}-${input.mode}.html`;
  return { html, filename };
}
