import Dialog from "@corvu/dialog";
import { decodeHostKey } from "kolu-common/hostKey";
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  Show,
} from "solid-js";
import { DEFAULT_FONT_SIZE } from "terminal-themes";
import type { TerminalGrid } from "@kolu/xterm-kit/solid";
import { hostLabel } from "../../host/hostChipTone";
import { fleetTerminalStanding } from "../../palette/fleetTerminals";
import ModalDialog from "../../ui/ModalDialog";
import { useShown } from "../../ui/shown";
import { liveArm, STATUS_DOT, terminalStatus } from "../terminalStatus";
import PeekTerminal, { type PeekTerminalHandle } from "./PeekTerminal";
import { type PeekCell, type PeekPad, peekNatural } from "./peekSize";
import { closePeek, peekTarget, peekTyping, type PeekTarget } from "./usePeek";

const TerminalPeek: Component = () => {
  const shown = useShown();
  createEffect(() => {
    if (!shown()) closePeek();
  });
  return (
    <ModalDialog
      open={peekTarget() !== null}
      onOpenChange={(open) => {
        if (!open) closePeek();
      }}
      size="fit"
      escapeCloses={!peekTyping()}
    >
      <Show when={peekTarget()} keyed>
        {(target) => <PeekWindow target={target} />}
      </Show>
    </ModalDialog>
  );
};

const PeekWindow: Component<{ target: PeekTarget }> = (props) => {
  const standing = createMemo(() =>
    fleetTerminalStanding(props.target.host, props.target.id),
  );
  const status = createMemo(() => terminalStatus(standing()));
  const [grid, setGrid] = createSignal<TerminalGrid | null>(
    liveArm(standing())?.grid ?? null,
  );
  const [cell, setCell] = createSignal<PeekCell | null>(null);
  const [pad, setPad] = createSignal<PeekPad | null>(null);
  const [phase, setPhase] = createSignal<"reading" | "live" | "reconnecting">(
    "reading",
  );
  const [held, setHeld] = createSignal(false);
  const [, setFocused] = createSignal(false);
  const [, setHandle] = createSignal<PeekTerminalHandle | undefined>(undefined);

  const natural = createMemo(() => {
    const g = grid();
    const c = cell();
    const p = pad();
    return g && c && p ? peekNatural(g, c, p) : null;
  });
  const bodyStyle = () => {
    const n = natural();
    return n === null
      ? { width: "56rem", height: "28rem", "max-width": "100%" }
      : { width: `${n.width}px`, height: `${n.height}px`, "max-width": "100%" };
  };

  return (
    <Dialog.Content
      data-testid="terminal-peek"
      data-peek-host={props.target.host}
      data-peek-terminal={props.target.id}
      class="flex min-w-0 max-w-[calc(100vw-4rem)] max-h-[calc(100dvh-4rem)] flex-col overflow-hidden rounded-xl border border-edge-bright bg-surface-1 shadow-2xl shadow-black/60 sm:min-w-[min(38rem,calc(100vw-4rem))]"
    >
      <div
        data-testid="peek-head"
        class="flex min-w-0 shrink-0 items-center gap-3 border-b border-edge px-3 py-2"
      >
        <span
          data-testid="peek-title"
          class="min-w-0 flex-1 truncate text-[0.78rem] font-semibold text-fg"
        >
          {props.target.id.slice(0, 8)}
        </span>
        <button
          type="button"
          data-testid="peek-close"
          aria-label="Close"
          class="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-fg-2 hover:bg-surface-2 hover:text-fg"
          onClick={() => closePeek()}
        >
          ×
        </button>
      </div>
      <div
        data-testid="peek-statusline"
        class="flex min-w-0 shrink-0 items-center gap-2 bg-surface-0 px-3 py-1.5 text-[0.7rem]"
      >
        <span class="shrink-0 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-accent">
          {hostLabel(decodeHostKey(props.target.host))}
        </span>
        <span
          class={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[status().tone]}`}
        />
        <span
          data-testid="peek-status"
          class="min-w-0 flex-1 truncate text-fg-2"
        >
          <span class="font-semibold text-fg">{status().state}</span>
          <Show when={status().progress}>
            {(tasks) => (
              <>
                {" · "}
                <span class="tabular-nums" title={tasks().title}>
                  {tasks().text}
                </span>
              </>
            )}
          </Show>
          <Show when={status().doing}>{(doing) => <> · {doing()}</>}</Show>
        </span>
        <Show when={grid()}>
          {(g) => (
            <span
              data-testid="peek-grid"
              class="shrink-0 font-mono text-[0.6rem] tabular-nums text-fg-3"
            >
              {g().cols}×{g().rows}
            </span>
          )}
        </Show>
        <span
          data-testid="peek-live"
          data-phase={held() ? "held" : phase()}
          class="shrink-0 font-mono text-[0.6rem] text-fg-3"
        >
          {held()
            ? "new output below"
            : phase() === "live"
              ? "live"
              : phase() === "reading"
                ? "reading the screen…"
                : "reconnecting…"}
        </span>
      </div>
      <div
        data-testid="peek-body"
        class="relative min-h-0 min-w-0 flex-initial"
        style={bodyStyle()}
      >
        <PeekTerminal
          host={props.target.host}
          id={props.target.id}
          fontSize={DEFAULT_FONT_SIZE}
          mayType={() => false}
          onGrid={setGrid}
          onCell={(c, p) => {
            setCell(c);
            setPad(p);
          }}
          onPhase={setPhase}
          onHeld={setHeld}
          onFocus={setFocused}
          onHandle={setHandle}
        />
      </div>
    </Dialog.Content>
  );
};

export default TerminalPeek;
