type ScheduleFrame = (callback: FrameRequestCallback) => number;

export function createFocusProvenance(
  scheduleFrame: ScheduleFrame = (callback) => requestAnimationFrame(callback),
) {
  let armed = false;
  let generation = 0;

  return {
    arm(): void {
      armed = true;
      const armedGeneration = ++generation;
      scheduleFrame(() => {
        if (generation === armedGeneration) armed = false;
      });
    },

    consume(action: () => void): boolean {
      if (!armed) return false;
      armed = false;
      generation++;
      action();
      return true;
    },
  } as const;
}

export const terminalFocusProvenance = createFocusProvenance();

interface TerminalFocusProvenanceWiring {
  pane: HTMLElement;
  textarea: HTMLTextAreaElement;
  isFocused: () => boolean;
  onFocus: () => void;
  provenance?: ReturnType<typeof createFocusProvenance>;
}

export function installTerminalFocusProvenance({
  pane,
  textarea,
  isFocused,
  onFocus,
  provenance = terminalFocusProvenance,
}: TerminalFocusProvenanceWiring): () => void {
  const armUserFocus = () => provenance.arm();
  const consumeUserFocus = () => provenance.consume(onFocus);
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Tab") {
      armUserFocus();
    } else if (!isFocused()) {
      armUserFocus();
      consumeUserFocus();
    }
  };

  pane.addEventListener("pointerdown", armUserFocus, true);
  pane.addEventListener("keydown", handleKeyDown, true);
  textarea.addEventListener("focus", consumeUserFocus);
  pane.addEventListener("click", consumeUserFocus, true);

  return () => {
    pane.removeEventListener("pointerdown", armUserFocus, true);
    pane.removeEventListener("keydown", handleKeyDown, true);
    textarea.removeEventListener("focus", consumeUserFocus);
    pane.removeEventListener("click", consumeUserFocus, true);
  };
}
