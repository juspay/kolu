import type { TerminalId, TerminalMetadata } from "kolu-common/surface";
import { createSignal } from "solid-js";
import type { LineRef } from "../ui/lineRef";
import { useRightPanel } from "./useRightPanel";

export type CodeReferenceRequest = {
  id: number;
  terminalId: TerminalId;
  repoRoot: string;
  cwd: string | undefined;
  ref: LineRef;
};

let nextRequestId = 0;
const [request, setRequest] = createSignal<CodeReferenceRequest | null>(null);

export const codeReferenceRequest = request;

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

export function clearCodeReferenceRequest(id: number): void {
  setRequest((current) => (current?.id === id ? null : current));
}
