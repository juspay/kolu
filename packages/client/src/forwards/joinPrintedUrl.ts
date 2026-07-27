/**
 * Join a printed URL to what the scanner observed — the PRT4 decision.
 *
 * A printed URL is an ENTRY POINT, never a fact. This function only looks up
 * what observation already established (ports + live forwards). It never creates
 * a door from text — that is the VS Code trap this feature exists to invert.
 *
 * `portReach` stays the single reachability judge; a joined result carries the
 * scanned {@link PortInfo} so a caller can ask `portReach` / `portAction` rather
 * than re-deriving scope.
 */

import {
  foldPorts,
  type KoluForward,
  type PortInfo,
  type TerminalPorts,
} from "kolu-common/surface";
import { parseLoopbackUrl } from "@kolu/url-shape";

/** What the join finds for a printed URL.
 *
 *  - `external`  — not a loopback URL; leave the default open alone
 *  - `blind`     — the scan could not look (`unknown` is never "no")
 *  - `unbacked`  — looked, and nothing is listening on that port yet
 *  - `joined`    — the scanner sees the port on this terminal (with its door if any)
 */
export type PrintedUrlJoin =
  | { kind: "external" }
  | { kind: "blind"; port: number }
  | { kind: "unbacked"; port: number }
  | {
      kind: "joined";
      port: number;
      info: PortInfo;
      forward: KoluForward | undefined;
    };

/** A tile's ports observation — folded known list, or "could not look".
 *
 *  Built by the caller from every pane of the tile (same unit PortsSection
 *  uses): any known observation yields a known list; only when NO pane has ever
 *  been successfully scanned is the observation `unknown`. */
export type TilePortsObservation =
  | { status: "known"; list: readonly PortInfo[] }
  | { status: "unknown" };

/** Collapse per-pane {@link TerminalPorts} into one tile observation. */
export function tilePortsObservation(
  perPane: readonly TerminalPorts[],
): TilePortsObservation {
  let anyKnown = false;
  const list: PortInfo[] = [];
  for (const ports of perPane) {
    if (ports.status === "known") {
      anyKnown = true;
      list.push(...ports.list);
    }
  }
  if (!anyKnown) return { status: "unknown" };
  // foldPorts is the vocabulary's widest-bind collapse — same as PortsSection.
  return { status: "known", list: foldPorts(list) };
}

/** Join a printed URL string against this terminal's observation + host doors. */
export function joinPrintedUrl(opts: {
  uri: string;
  observation: TilePortsObservation;
  /** Host-scoped forwards already filtered by the caller. */
  forwards: readonly KoluForward[];
}): PrintedUrlJoin {
  const loopback = parseLoopbackUrl(opts.uri);
  if (loopback === null) return { kind: "external" };
  return joinPrintedPort({
    port: loopback.port,
    observation: opts.observation,
    forwards: opts.forwards,
  });
}

/** The join over a known port number — what the decision table pins. */
export function joinPrintedPort(opts: {
  port: number;
  observation: TilePortsObservation;
  forwards: readonly KoluForward[];
}): PrintedUrlJoin {
  if (opts.observation.status === "unknown") {
    return { kind: "blind", port: opts.port };
  }
  const info = opts.observation.list.find((p) => p.port === opts.port);
  if (info === undefined) {
    return { kind: "unbacked", port: opts.port };
  }
  const forward = opts.forwards.find((f) => f.remotePort === opts.port);
  return {
    kind: "joined",
    port: opts.port,
    info,
    forward,
  };
}
