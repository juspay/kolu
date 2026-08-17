/** Split complete VT sequences from a leftover+chunk so CSI/OSC that
 *  straddle two PTY reads still parse. */

/** Cap on an unfinished CSI/OSC tail. A binary `cat` that emits `\x1b]`
 *  with no ST must not grow `oscTail` / `queryTail` without bound. */
export const VT_LEFTOVER_MAX = 4096;

export function takeCompleteVt(
  pending: string,
  chunk: string,
): { complete: string; leftover: string } {
  const s = pending + chunk;
  const lastEsc = s.lastIndexOf("\x1b");
  if (lastEsc < 0) return { complete: s, leftover: "" };
  const tail = s.slice(lastEsc);
  if (sequenceComplete(tail)) return { complete: s, leftover: "" };
  if (tail.length > VT_LEFTOVER_MAX) {
    return { complete: s.slice(0, lastEsc), leftover: "" };
  }
  return { complete: s.slice(0, lastEsc), leftover: tail };
}

function sequenceComplete(seq: string): boolean {
  if (seq.length < 2) return false;
  const intro = seq[1];
  if (intro === "[") {
    return /[\x40-\x7e]$/.test(seq) && seq.length >= 3;
  }
  if (intro === "]") {
    return seq.endsWith("\x07") || seq.endsWith("\x1b\\");
  }
  if (intro === "P" || intro === "X" || intro === "^" || intro === "_") {
    return seq.endsWith("\x1b\\");
  }
  if (intro === "O") return seq.length >= 3;
  return seq.length >= 2;
}

const OSC_52 = /\x1b\]52;([^;]*);([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
const OSC_633_E = /\x1b\]633;E;([^\x07\x1b]*)(?:\x07|\x1b\\)/g;

export function scanOsc52(
  text: string,
  onOsc52: (selection: string, payload: string) => void,
): void {
  OSC_52.lastIndex = 0;
  for (const m of text.matchAll(OSC_52)) {
    onOsc52(m[1] ?? "c", m[2] ?? "");
  }
}

export function scanOsc633E(
  text: string,
  onCommandRun: (command: string) => void,
): void {
  OSC_633_E.lastIndex = 0;
  for (const m of text.matchAll(OSC_633_E)) {
    onCommandRun(m[1] ?? "");
  }
}

const MODE_RE = /\x1b\[(\??)([0-9;]*)([hl])/g;

/** Apply DECSET/DECRST + RIS in `text` to the current DECCKM flag. */
export function applyCursorKeyMode(text: string, current: boolean): boolean {
  let mode = current;
  if (text.includes("\x1bc")) mode = false;
  MODE_RE.lastIndex = 0;
  for (const m of text.matchAll(MODE_RE)) {
    if (m[1] !== "?") continue;
    const nums = (m[2] ?? "").split(";").filter((n) => n.length > 0);
    if (nums.includes("1")) mode = m[3] === "h";
  }
  return mode;
}

const RIS = /\x1bc/;

export function containsRis(text: string): boolean {
  return RIS.test(text);
}

/** ED (CSI J) or alt-screen enter/leave. These change the trimmed
 *  visual-row count while DATA_TOTAL_ROWS stays put, so a total-delta
 *  cache would drift. */
const ED_OR_ALT = /\x1b\[\d*J|\x1b\[\?[\d;]*(?:47|1047|1048|1049)[\d;]*[hl]/;

export function shiftsVisualWithoutTotal(text: string): boolean {
  return ED_OR_ALT.test(text);
}
