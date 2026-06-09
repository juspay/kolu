/**
 * Minimal ANSI styling — no deps, auto-disabled when stdout isn't a TTY or
 * `NO_COLOR` is set (so vitest, `run.sh`-captured logs, and `--progress
 * json` consumers always see plain bytes).
 */

const enabled =
  process.stdout.isTTY === true &&
  process.env.NO_COLOR === undefined &&
  process.env.TERM !== "dumb";

export function colorEnabled(): boolean {
  return enabled;
}

const wrap =
  (open: number, close: number) =>
  (s: string): string =>
    enabled ? `\x1b[${open}m${s}\x1b[${close}m` : s;

export const bold = wrap(1, 22);
export const dim = wrap(2, 22);
export const red = wrap(31, 39);
export const green = wrap(32, 39);
export const yellow = wrap(33, 39);
export const magenta = wrap(35, 39);
export const cyan = wrap(36, 39);

/** Braille spinner — the always-moving glyph that makes a 40-minute e2e node
 *  look alive instead of hung. */
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
export function spinnerAt(tick: number): string {
  return SPINNER[tick % SPINNER.length] as string;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI escapes is the point.
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;
export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

/** OSC 8 terminal hyperlink — modern terminals (incl. xterm.js with the
 *  web-links addon, i.e. kolu's own panes) render `text` clickable. Plain
 *  passthrough off-TTY, like every style here. */
export function link(text: string, url: string): string {
  return enabled ? `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\` : text;
}
