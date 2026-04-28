/** Export the active terminal's agent transcript as a self-contained HTML file.
 *
 *  Calls the server-side export endpoint (which reads the on-disk transcript
 *  for the active agent kind — Claude Code, OpenCode, or Codex) and
 *  triggers a browser download of the resulting HTML document. */

import type { TerminalId, TerminalMetadata } from "kolu-common";
import { terminalKey } from "kolu-common";
import { toast } from "solid-sonner";
import { client } from "./rpc/rpc";

export async function exportAgentTranscript(
  id: TerminalId,
  meta: TerminalMetadata | undefined,
): Promise<void> {
  const label = meta?.git
    ? `${meta.git.repoName} (${meta.git.branch})`
    : meta
      ? terminalKey(meta).group
      : "Terminal";
  const agentKind = meta?.agent?.kind ?? "agent";
  const tid = toast.loading("Exporting transcript…");
  try {
    const html = await client.agent.exportTranscript({ id });
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${label} — ${agentKind} transcript.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Transcript exported", { id: tid });
  } catch (err: unknown) {
    toast.error(
      `Export failed: ${err instanceof Error ? err.message : String(err)}`,
      { id: tid },
    );
  }
}
