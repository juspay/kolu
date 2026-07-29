type ScheduleFrame = (callback: FrameRequestCallback) => number;

/** One document-wide token joins a user gesture in one terminal to the first
 *  native focus event it causes, which may land in a sibling terminal (Tab).
 *  Programmatic focus has no token and therefore cannot echo into selection. */
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

/** Install the production gesture-to-focus bridge on the pane boundary.
 *  Keeping the boundary explicit makes it impossible for tile chrome to arm
 *  provenance unless a caller deliberately widens `pane`. */
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
      // Tab's focus event can land in a sibling pane, which consumes the
      // document-wide token there.
      armUserFocus();
    } else if (!isFocused()) {
      // A pane may retain DOM focus without owning the selection. Its first
      // real keystroke repairs the fact before xterm forwards the key.
      armUserFocus();
      consumeUserFocus();
    }
  };

  pane.addEventListener("pointerdown", armUserFocus, true);
  pane.addEventListener("keydown", handleKeyDown, true);
  textarea.addEventListener("focus", consumeUserFocus);
  // Clicking an already-focused textarea emits no focus event, so the click
  // consumes the still-armed pointer token as a fallback.
  pane.addEventListener("click", consumeUserFocus, true);

  return () => {
    pane.removeEventListener("pointerdown", armUserFocus, true);
    pane.removeEventListener("keydown", handleKeyDown, true);
    textarea.removeEventListener("focus", consumeUserFocus);
    pane.removeEventListener("click", consumeUserFocus, true);
  };
}
