import type { CodeTabView } from "@kolu/padi-client/surface";
import type { TerminalId } from "kolu-common/surface";
import { batch, createSignal } from "solid-js";
import { useTerminalStore } from "../terminal/useTerminalStore";
import type { LineRef } from "../ui/lineRef";
import { activeHost } from "../wire";
import type { OpenInCodeTabRequest } from "./codeTabOpenController";
import { useRightPanel } from "./useRightPanel";

export type { OpenInCodeTabRequest } from "./codeTabOpenController";

interface OpenInCodeTabInput {
  terminalId: TerminalId;
  ref: LineRef;
  cwd?: string;
  targetMode: CodeTabView;
  allowBasenameFallback?: boolean;
}

function createRepeatableRequest<T>(): [() => T | null, (request: T) => void] {
  const [request, setRequest] = createSignal<T | null>(null, {
    equals: false,
  });
  return [request, (next: T) => setRequest(() => next)];
}

const [pendingRequest, setPendingRequest] =
  createRepeatableRequest<OpenInCodeTabRequest>();

export const pendingOpen = pendingRequest;

export function openInCodeTab(req: OpenInCodeTabInput): void {
  const rp = useRightPanel();
  const terminals = useTerminalStore();
  const target = terminals.getMetadata(req.terminalId);
  if (target === undefined)
    throw new Error(
      `openInCodeTab: no terminal metadata for ${req.terminalId}`,
    );
  if (target.git.kind !== "repo")
    throw new Error(
      `openInCodeTab: terminal ${req.terminalId} has no repo (git ${target.git.kind})`,
    );
  const repoRoot = target.git.info.repoRoot;
  const request: OpenInCodeTabRequest = {
    ref: req.ref,
    cwd: req.cwd,
    allowBasenameFallback: req.allowBasenameFallback,
    scope: {
      host: activeHost(),
      terminalId: req.terminalId,
      repoRoot,
      mode: req.targetMode,
    },
  };
  batch(() => {
    terminals.focusTerminalSilently(req.terminalId);
    rp.openCodeAt(request.scope.mode);
    rp.reveal();
    setPendingRequest(request);
  });
}
