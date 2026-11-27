/**
 * ONE PANE'S PORTS, as a reader outside the store may hold them.
 *
 * The port join (`terminalServingPort`, and every `tilePorts` fold over it) runs
 * in its CONSUMER's scope — a `<Show when={props.serving}>` memo per Inspector
 * row, the host panel's row list — and it reads each candidate's ports through
 * `knownPorts`. Handed the projection record's own `ports` PROXY, that read
 * charges the consuming scope a store leaf for the `status` and another for the
 * `list` of every pane on the host, which puts those scopes past Solid's
 * 200-source `WIDE_SCOPE_DEPS` judge at about 40 panes. Copied out ONCE, where
 * the pane's own row memo already tracks it, the consumer reads plain values and
 * costs nothing per pane.
 *
 * `samePorts` is the other half: a plain copy is a fresh object every time, so
 * the row needs a VALUE comparison to keep its identity across a frame that said
 * the same thing.
 */

import type { TerminalPorts } from "kolu-common/surface";

/** The ports reading of a pane that has never been scanned — one frozen value,
 *  so an unscanned pane's row holds still. */
export const UNKNOWN_PORTS: TerminalPorts = Object.freeze({
  status: "unknown",
});

/** A PLAIN copy of one pane's ports — see this module's header for why the
 *  proxy must not leave the row memo. `unknown` is preserved: "we never looked"
 *  is not "serves nothing". */
export function plainPorts(ports: TerminalPorts | undefined): TerminalPorts {
  if (ports === undefined || ports.status !== "known") return UNKNOWN_PORTS;
  return { status: "known", list: ports.list.map((one) => ({ ...one })) };
}

/** Whether two readings of one pane's ports say the same thing — what keeps an
 *  unchanged pane's row identity across a frame. */
export function samePorts(a: TerminalPorts, b: TerminalPorts): boolean {
  if (a.status !== b.status) return false;
  if (a.status !== "known" || b.status !== "known") return true;
  return (
    a.list.length === b.list.length &&
    a.list.every((one, at) => {
      const other = b.list[at];
      return (
        other !== undefined &&
        one.port === other.port &&
        one.name === other.name &&
        one.command === other.command &&
        one.scope === other.scope &&
        one.family === other.family
      );
    })
  );
}
