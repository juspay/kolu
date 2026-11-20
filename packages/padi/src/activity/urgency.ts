import type { PadiTerminal, PadiUrgency } from "@kolu/padi-client/surface";
import { attentionClass } from "@kolu/terminal-vocab/agentProjection";
import type { AttentionFrame } from "@kolu/terminal-vocab/attentionTransitions";
import type { TerminalId } from "@kolu/terminal-vocab/schema";

export const EMPTY_URGENCY: PadiUrgency = {
  awaitingIds: [],
  finishedIds: [],
  workingIds: [],
  lingerIds: [],
  settled: false,
};

type ActiveTerminal = Extract<PadiTerminal, { state: "active" }>;

function* activeTerminals(
  terminals: ReadonlyMap<TerminalId, PadiTerminal>,
): Generator<[TerminalId, ActiveTerminal]> {
  for (const [id, terminal] of terminals) {
    if (terminal.state === "active") yield [id, terminal];
  }
}

export function recomputeUrgency(
  terminals: ReadonlyMap<TerminalId, PadiTerminal>,
  isEpisodeFinished: (id: TerminalId) => boolean,
): PadiUrgency {
  const awaitingIds: TerminalId[] = [];
  const finishedIds: TerminalId[] = [];
  const workingIds: TerminalId[] = [];
  const lingerIds: TerminalId[] = [];
  for (const [id, terminal] of activeTerminals(terminals)) {
    switch (attentionClass(terminal.agent, isEpisodeFinished(id))) {
      case "asking":
        awaitingIds.push(id);
        break;
      case "working":
        workingIds.push(id);
        break;
      case "linger":
        lingerIds.push(id);
        break;
      case "finished":
        finishedIds.push(id);
        break;
      case "idle":
        break;
    }
  }
  return { awaitingIds, finishedIds, workingIds, lingerIds, settled: true };
}

export function attentionFrameOf(urgency: PadiUrgency): AttentionFrame {
  return { asking: urgency.awaitingIds, finished: urgency.finishedIds };
}
