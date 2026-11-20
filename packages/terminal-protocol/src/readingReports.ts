/**
 * Reports a terminal sends on a READER's behalf — not something a person
 * typed.
 *
 * A browser xterm writes two kinds of bytes into `onData` that come from
 * looking at a terminal rather than typing into it, once the program inside
 * has asked for them:
 *
 *  - FOCUS reports (`?1004`): `CSI I` when the tile gains focus, `CSI O` when
 *    it loses it.
 *  - Mouse WHEEL reports in SGR encoding (`?1006` with mouse tracking on).
 *
 * Mouse CLICKS and drags are not here — in a program that tracks the mouse a
 * click is input to it.
 *
 * Whole-payload, like `isTerminalQueryResponse`: xterm's `onData` fires once
 * per generated event, so a report is never glued to a keystroke.
 */

const FOCUS_REPORT = /^\x1b\[[IO]$/;

// SGR mouse: CSI < Cb ; Cx ; Cy (M|m). Cb's bit 64 marks the wheel (buttons
// 4–7); bit 128 marks the extra buttons 8–11, which are not the wheel. The
// modifier bits (4, 8, 16) and the motion bit (32) ride on top.
const SGR_MOUSE = /^\x1b\[<(\d+);\d+;\d+[Mm]$/;

const isWheel = (button: number): boolean =>
  (button & 64) !== 0 && (button & 128) === 0;

/** Whether `data` is a focus report or a mouse-wheel report — bytes from
 *  reading a terminal, never from typing into it. */
export function isReadingReport(data: string): boolean {
  if (FOCUS_REPORT.test(data)) return true;
  const mouse = SGR_MOUSE.exec(data);
  return mouse !== null && isWheel(Number(mouse[1]));
}
