import { createSignal } from "solid-js";

export const FOLLOW_SLACK_PX = 48;

export interface ScrollMetrics {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

export function atEnd(el: ScrollMetrics): boolean {
  return (
    el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_SLACK_PX + 1
  );
}

const [offset, setOffset] = createSignal<number | null>(null);

export function transcriptPinned(): boolean {
  return offset() === null;
}

export function rememberTranscriptScroll(el: ScrollMetrics): void {
  setOffset(atEnd(el) ? null : el.scrollTop);
}

export function unpinTranscript(el: ScrollMetrics): void {
  if (offset() === null) setOffset(el.scrollTop);
}

export function pinTranscript(): void {
  setOffset(null);
}

/** Put a freshly mounted container back where the reader left it — or at the
 *  end, if that is where they were. */
export function applyTranscriptScroll(el: {
  scrollTop: number;
  readonly scrollHeight: number;
}): void {
  el.scrollTop = offset() ?? el.scrollHeight;
}

export function revealTranscriptRow(container: Element, rowId: string): void {
  const row = container.querySelector(`[data-row-id="${CSS.escape(rowId)}"]`);
  if (row === null) return;
  const fold = row.closest("details");
  if (fold !== null) fold.open = true;
  row.scrollIntoView({ block: "center", behavior: "smooth" });
}
