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
