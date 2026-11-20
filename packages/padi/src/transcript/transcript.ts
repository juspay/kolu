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
import { isAgentPresence } from "kolu-agents/vocab";
import { transcriptToHtml } from "kolu-transcript-html";
import { log } from "../log.ts";
import { requireActiveTerminal } from "../terminal-registry.ts";

/** Export a terminal's live agent session as an HTML transcript. Raises
 *  `TranscriptNoAgent` when the terminal hosts no agent session,
 *  `TranscriptNotFound` when the agent's transcript cannot be loaded, and
 *  `TerminalNotFound` when the id names nothing live. */
export async function exportTranscriptHtml(
  input: ExportTranscriptHtmlInput,
): Promise<ExportTranscriptHtmlOutput> {
  const { snapshot: aw } = requireActiveTerminal(input.id);
  const agent = aw.agent;
  if (!agent || isAgentPresence(agent)) throw new TranscriptNoAgent();
  const cwd = aw.cwd;
  const repoName = aw.git.kind === "repo" ? aw.git.info.repoName : null;
  const prInfo = prValue(aw.pr);
  const pr: TranscriptPr | null = prInfo
    ? { number: prInfo.number, url: prInfo.url }
    : null;
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
