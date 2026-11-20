import type { TerminalMetadata } from "@kolu/padi-client/surface";
import { cwdBasename } from "@kolu/terminal-vocab/terminalKey";
import type { TerminalId } from "kolu-common/surface";
import { createMemo } from "solid-js";
import { annotationLine } from "../../intent/text";
import {
  pairDisplayRow,
  type TerminalDisplayInfo,
} from "../../terminal/terminalDisplay";
import { useTerminalStore } from "../../terminal/useTerminalStore";

export function createDockRowData(
  id: TerminalId,
): () => { info: TerminalDisplayInfo; meta: TerminalMetadata } | null {
  const store = useTerminalStore();
  return createMemo(() =>
    pairDisplayRow(store.getDisplayInfo(id), store.getMetadata(id)),
  );
}

export function dockRowLabel(
  meta: TerminalMetadata,
  info: TerminalDisplayInfo | undefined,
): string {
  return annotationLine(
    meta.intent,
    info === undefined ? cwdBasename(meta.cwd) : info.key.label,
  );
}
