import type { TerminalId, TerminalMetadata } from "kolu-common/surface";
import { createSignal } from "solid-js";
import type { LineRef } from "../ui/lineRef";
import { useRightPanel } from "./useRightPanel";

/** Pending cross-component request to open a terminal file reference. */
export type CodeReferenceRequest = {
  id: number;
  terminalId: TerminalId;
  repoRoot: string;
  cwd: string | undefined;
  ref: LineRef;
};

let nextRequestId = 0;
const [request, setRequest] = createSignal<CodeReferenceRequest | null>(null);

/** Latest terminal file-reference request waiting for CodeTab to consume it. */
export const codeReferenceRequest = request;

/** Open the Code tab in browse mode and publish a file-reference request. */
export function openCodeReference(input: {
  terminalId: TerminalId;
  metadata: TerminalMetadata;
  ref: LineRef;
}): boolean {
  const repoRoot = input.metadata.git?.repoRoot;
  if (!repoRoot) return false;

  useRightPanel().showCodeExpanded("browse");
  setRequest({
    id: ++nextRequestId,
    terminalId: input.terminalId,
    repoRoot,
    cwd: input.metadata.cwd,
    ref: input.ref,
  });
  return true;
}

/** Clear a consumed request without racing newer requests. */
export function clearCodeReferenceRequest(id: number): void {
  setRequest((current) => (current?.id === id ? null : current));
}
