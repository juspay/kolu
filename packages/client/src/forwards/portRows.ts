import {
  type HostListeners,
  type KoluForward,
  type ListenerAt,
  listenerAt,
  type PortInfo,
  type PortBind,
} from "kolu-common/surface";

export type PortOrigin = "subtree" | "printed" | "host";

type Listener = { bind: PortBind } | { info: PortInfo };

export function bindOf(x: Listener): PortBind {
  return "bind" in x ? x.bind : x.info;
}

export function listenerLabel(x: Listener): string {
  return "bind" in x ? "owner not visible" : x.info.command;
}

export type PortRow =
  | {
      kind: "port";
      port: number;
      info: PortInfo;
      origin: PortOrigin;
      forward: KoluForward | undefined;
    }
  | {
      kind: "unclaimed";
      port: number;
      bind: PortBind;
      origin: Exclude<PortOrigin, "subtree">;
      forward: KoluForward | undefined;
    }
  | { kind: "orphan"; port: number; forward: KoluForward };

export function rowGroup(row: PortRow): "here" | "elsewhere" {
  return row.kind === "orphan" || row.origin === "host" ? "elsewhere" : "here";
}

export interface TerminalsView {
  tilePorts: readonly PortInfo[];
  printedHere: ReadonlySet<number>;
  printedOnHost: ReadonlySet<number>;
}

export interface PortGroups {
  here: PortRow[];
  elsewhere: PortRow[];
}

interface RowContext {
  host: HostListeners;
  doorOf: ReadonlyMap<number, KoluForward>;
  doorPorts: ReadonlySet<number>;
  taken: Set<number>;
}

const byPort = (a: PortRow, b: PortRow) => a.port - b.port;

function rowAt(
  ctx: RowContext,
  at: ListenerAt,
  port: number,
  origin: "printed" | "host",
): PortRow | undefined {
  const forward = ctx.doorOf.get(port);
  if (at.kind === "claimed") {
    return { kind: "port", port, info: at.info, origin, forward };
  }
  if (at.kind === "unclaimed") {
    return { kind: "unclaimed", port, bind: at.bind, origin, forward };
  }
  return undefined;
}

function rowsFromTerminal(
  ctx: RowContext,
  terminals: TerminalsView,
): PortRow[] {
  const rows: PortRow[] = terminals.tilePorts.map((info) => {
    ctx.taken.add(info.port);
    return {
      kind: "port",
      port: info.port,
      info,
      origin: "subtree",
      forward: ctx.doorOf.get(info.port),
    };
  });
  for (const port of terminals.printedHere) {
    if (ctx.taken.has(port) || ctx.doorPorts.has(port)) continue;
    const at = listenerAt(ctx.host, port);
    if (at.kind === "claimed" && at.info.heldByTerminal) continue;
    const row = rowAt(ctx, at, port, "printed");
    if (row === undefined) continue;
    rows.push(row);
    ctx.taken.add(port);
  }
  return rows.sort(byPort);
}

function rowsElsewhereOnHost(
  ctx: RowContext,
  printedOnHost: ReadonlySet<number>,
): PortRow[] {
  if (ctx.host.status !== "known") return [];
  const rows: PortRow[] = [];
  const claimedPorts = new Set(ctx.host.claimed.map((p) => p.port));
  const hostPorts = new Set(claimedPorts);
  if (ctx.host.unclaimed.status === "known") {
    for (const b of ctx.host.unclaimed.list) hostPorts.add(b.port);
  }
  for (const port of hostPorts) {
    if (ctx.taken.has(port) || ctx.doorPorts.has(port)) continue;
    const at = listenerAt(ctx.host, port);
    if (
      at.kind === "unclaimed" &&
      !ctx.doorOf.has(port) &&
      !printedOnHost.has(port) &&
      !claimedPorts.has(port)
    ) {
      continue;
    }
    const row = rowAt(ctx, at, port, "host");
    if (row === undefined) continue;
    rows.push(row);
    ctx.taken.add(port);
  }
  return rows.sort(byPort);
}

function orphanRows(
  ctx: RowContext,
  forwards: readonly KoluForward[],
): PortRow[] {
  return forwards
    .filter((f) => !ctx.taken.has(f.remotePort))
    .sort((a, b) => a.remotePort - b.remotePort)
    .map(
      (forward): PortRow => ({
        kind: "orphan",
        port: forward.remotePort,
        forward,
      }),
    );
}

export function portGroups(opts: {
  terminals: TerminalsView;
  host: HostListeners;
  forwards: readonly KoluForward[];
  doorPorts: ReadonlySet<number>;
}): PortGroups {
  const ctx: RowContext = {
    host: opts.host,
    doorOf: new Map(opts.forwards.map((f) => [f.remotePort, f])),
    doorPorts: opts.doorPorts,
    taken: new Set<number>(),
  };
  const here = rowsFromTerminal(ctx, opts.terminals);
  const elsewhere = rowsElsewhereOnHost(ctx, opts.terminals.printedOnHost);
  return {
    here,
    elsewhere: [...elsewhere, ...orphanRows(ctx, opts.forwards)],
  };
}
