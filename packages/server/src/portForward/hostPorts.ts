import type { Logger } from "@kolu/log";
import { firstFrameOrThrow } from "@kolu/surface/first-frame";
import { Effect, Option, type Stream } from "effect";
import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import {
  type HostListeners,
  listenerAt,
  type PortFamily,
} from "kolu-common/surface";

export type HostPorts =
  | {
      readonly status: "observed";
      readonly ports: ReadonlyMap<number, PortFamily>;
    }
  | { readonly status: "unobserved" };

export const REAP_READ_BUDGET_MS = 10_000;

export const OPENING_CLICK_READ_BUDGET_MS = 1_000;

export interface HostPortsReader {
  /** The reaper's read of a host: generous budget, because tripping it costs one
   *  sample of a background pass rather than a user's wait. */
  forReap(host: HostKey): Promise<HostPorts>;
  /** The read behind a port chip click: tight budget, because an answer is already
   *  waiting — `unobserved` dials the assumed loopback. */
  forOpeningClick(host: HostKey): Promise<HostPorts>;
}

export function hostPortsOf(reading: HostListeners): HostPorts {
  if (reading.status !== "known") return { status: "unobserved" };
  const ports = new Map<number, PortFamily>();
  const candidates = [
    ...reading.claimed,
    ...(reading.unclaimed.status === "known" ? reading.unclaimed.list : []),
  ];
  for (const { port } of candidates) {
    if (ports.has(port)) continue;
    const at = listenerAt(reading, port);
    if (at.kind === "claimed") ports.set(port, at.info.family);
    else if (at.kind === "unclaimed") ports.set(port, at.bind.family);
  }
  return { status: "observed", ports };
}

export function makeHostPortsReader(deps: {
  /** The host's `hostListeners` cell stream, or `null` when kolu has no session. */
  listenersOf: (host: HostKey) => Stream.Stream<HostListeners, unknown> | null;
  log: Logger;
  budgetsMs?: { readonly reap: number; readonly openingClick: number };
}): HostPortsReader {
  const budgets = deps.budgetsMs ?? {
    reap: REAP_READ_BUDGET_MS,
    openingClick: OPENING_CLICK_READ_BUDGET_MS,
  };

  async function readHostPorts(
    host: HostKey,
    budgetMs: number,
  ): Promise<HostPorts> {
    const stream = deps.listenersOf(host);
    if (stream === null) return { status: "unobserved" };
    try {
      const frame = await Effect.runPromise(
        firstFrameOrThrow(
          stream,
          `host ${encodeHostKey(host)}: hostListeners yielded no frame`,
        ).pipe(Effect.timeoutOption(budgetMs)),
      );
      if (Option.isNone(frame)) {
        deps.log.warn(
          { host: encodeHostKey(host), budgetMs },
          "a host's listeners did not answer within the budget — reporting its ports as unobserved rather than reaping on no reading",
        );
        return { status: "unobserved" };
      }
      return hostPortsOf(frame.value);
    } catch (err) {
      deps.log.error(
        { err, host: encodeHostKey(host) },
        "host port read failed",
      );
      return { status: "unobserved" };
    }
  }

  return {
    forReap: (host) => readHostPorts(host, budgets.reap),
    forOpeningClick: (host) => readHostPorts(host, budgets.openingClick),
  };
}
