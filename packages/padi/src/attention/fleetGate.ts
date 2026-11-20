import type { PadiRoster, PadiTerminal } from "@kolu/padi-client/surface";
import { source } from "@kolu/surface/reactor";
import type { TerminalId } from "@kolu/terminal-vocab/schema";

/** Why a frame is, or is not, evidence about the fleet. */
export type AdmitVerdict =
  | "pre-adopt"
  | "draining"
  | "unread-survivors"
  | "evidence";

export interface FleetGate {
  admit(terminals: ReadonlyMap<TerminalId, PadiTerminal>): boolean;
  establish(): void;
  settling(): void;
  censusMoved(): void;
  awaitFirstRead(id: TerminalId): void;
  firstRead(id: TerminalId): void;
  /** The standing as it would be read off the wire — what the cell carries. */
  roster(): PadiRoster;
  /** Release the generation the fold tracks. */
  dispose(): void;
}

export function createFleetGate(
  opts: {
    /** Publish a CHANGED standing (the `roster` cell). Omitted in tests of the
     *  gate itself and in a serve with no ctx wired yet. */
    readonly publish?: (roster: PadiRoster) => void;
    /** The clock the `established` stamp is read from — injected so a test can
     *  state the epoch it expects. */
    readonly now?: () => number;
    readonly census?: () => readonly TerminalId[];
  } = {},
): FleetGate {
  const now = opts.now ?? Date.now;
  let roster: PadiRoster = { kind: "settling" };
  let drainLatched = false;
  const move = (next: PadiRoster): void => {
    if (next.kind === roster.kind) {
      if (next.kind !== "established" || roster.kind !== "established") return;
      const was = roster.ids;
      if (
        next.ids.length === was.length &&
        next.ids.every((id, at) => id === was[at])
      )
        return;
    }
    roster = next;
    opts.publish?.(next);
  };
  const ids = (
    frame?: ReadonlyMap<TerminalId, PadiTerminal>,
  ): readonly TerminalId[] => {
    if (opts.census) return [...opts.census()];
    if (frame) return [...frame.keys()];
    return roster.kind === "established" ? roster.ids : [];
  };
  let attentionOpen = false;
  const unread = new Set<TerminalId>();
  let generation = 0;
  let emitGeneration: ((n: number) => void) | undefined;
  const generationSource = source<number>((emit) => {
    emitGeneration = emit;
    return () => {
      emitGeneration = undefined;
    };
  }, 0);
  const keepAlive = generationSource.subscribe(() => {});
  const bumpRevision = (): void => {
    generation += 1;
    emitGeneration?.(generation);
  };
  /** The gate's own answer-revision. Reading it inside a derivation is what
   *  makes a fold re-run when the verdict moved without the frame moving. */
  const revision = (): number | undefined => generationSource.value.value;
  const verdictOf = (
    terminals: ReadonlyMap<TerminalId, PadiTerminal>,
  ): AdmitVerdict => {
    if (roster.kind === "established") {
      move({ kind: "established", at: roster.at, ids: ids(terminals) });
    } else if (drainLatched) {
      return "draining";
    } else if (terminals.size === 0) {
      return "pre-adopt";
    } else {
      move({ kind: "established", at: now(), ids: ids(terminals) });
    }
    for (const id of unread) if (!terminals.has(id)) unread.delete(id);
    if (unread.size > 0) return "unread-survivors";
    attentionOpen = true;
    return "evidence";
  };
  return {
    admit(terminals) {
      revision();
      return verdictOf(terminals) === "evidence";
    },
    establish() {
      drainLatched = false;
      move({ kind: "established", at: now(), ids: ids() });
      bumpRevision();
    },
    settling() {
      drainLatched = true;
      move({ kind: "settling" });
      bumpRevision();
    },
    censusMoved() {
      if (roster.kind !== "established") return;
      move({ kind: "established", at: roster.at, ids: ids() });
    },
    awaitFirstRead(id) {
      if (!attentionOpen) unread.add(id);
    },
    firstRead(id) {
      if (unread.delete(id) && unread.size === 0) bumpRevision();
    },
    roster: () => roster,
    dispose() {
      keepAlive();
      generationSource.dispose();
    },
  };
}

let serving: FleetGate | null = null;

export function setServingFleetGate(gate: FleetGate | null): void {
  serving = gate;
}

/** padi finished adopting — see {@link FleetGate.establish}. A no-op before the
 *  surface is served (nothing is subscribed to tell). */
export function markRosterEstablished(): void {
  serving?.establish();
}

/** padi is rebuilding its roster — see {@link FleetGate.settling}. */
export function markRosterSettling(): void {
  serving?.settling();
}

export function markCensusMoved(): void {
  serving?.censusMoved();
}

export function markAwaitingFirstRead(id: TerminalId): void {
  serving?.awaitFirstRead(id);
}

/** A terminal's agent detectors have each made their first pass — see
 *  {@link FleetGate.firstRead}. Said by the terminal's sensor set. */
export function markFirstRead(id: TerminalId): void {
  serving?.firstRead(id);
}
