/**
 * The device-query matrix — which terminal queries kolu answers, and which it
 * deliberately leaves silent. This table IS the policy; the implementations
 * that honor it live elsewhere (the headless's native answerers + the
 * pty-host's XTVERSION handler; the client-side duplicate suppression in
 * `responseFilter.ts`), and `@kolu/pty-host`'s device-query contract tests
 * execute this table against a real headless so the policy and the
 * implementation cannot drift apart.
 *
 * Every query class the client filter suppresses sits in exactly one arm:
 *
 *  - ANSWERED — the headless answers it and the reply is forwarded to the
 *    PTY child. Suppressing the mirroring client's duplicate is then safe:
 *    exactly one answerer.
 *  - SILENT — NOBODY answers through kolu (the headless doesn't synthesize
 *    it; the forwarder drops `ESC ]` regardless; the client filter suppresses
 *    the browser's theme/window-derived reply). Programs querying these carry
 *    their own timeout fallbacks; consistent silence beats answers that
 *    differ per attached client.
 *
 * A new suppressed class in `responseFilter.ts` MUST land in one arm here
 * (and thereby in the pty-host contract tests) before it ships.
 */
export interface DeviceQueryProbe {
  /** Human-readable class name, for test output. */
  name: string;
  /** A canonical query a program would emit. */
  query: string;
}

/** Queries the headless answers natively — replies forwarded to the child. */
export const ANSWERED_DEVICE_QUERIES: readonly DeviceQueryProbe[] = [
  { name: "DA1", query: "\x1b[c" },
  { name: "DA2", query: "\x1b[>c" },
  { name: "DSR", query: "\x1b[5n" },
  { name: "CPR", query: "\x1b[6n" },
  { name: "DECRQM bracketed-paste", query: "\x1b[?2004$p" },
  { name: "DECRQSS SGR", query: "\x1bP$qm\x1b\\" },
];

/** Queries NOBODY answers through kolu — uniform, deliberate silence. */
export const SILENT_DEVICE_QUERIES: readonly DeviceQueryProbe[] = [
  { name: "OSC 10 fg", query: "\x1b]10;?\x07" },
  { name: "OSC 11 bg", query: "\x1b]11;?\x07" },
  { name: "OSC 4 palette", query: "\x1b]4;1;?\x07" },
  { name: "win size px (14t)", query: "\x1b[14t" },
  { name: "win size chars (18t)", query: "\x1b[18t" },
];
