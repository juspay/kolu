import { everyMs, source } from "@kolu/surface/reactor";
import type {
  HostListeners,
  TerminalId,
  TerminalPorts,
} from "@kolu/terminal-vocab/schema";
import {
  samePortList,
  UNKNOWN_HOST_LISTENERS,
} from "@kolu/terminal-vocab/schema";
import { Effect } from "effect";
import type { Logger } from "pino";
import {
  PortScanError,
  type PortScan,
  portScanSupported,
  scanPorts,
} from "./scan.ts";

export const PORT_SCAN_INTERVAL_MS = 5_000;

export interface PortScanTarget {
  id: TerminalId;
  rootPid: number;
}

export interface PortSampler {
  dispose(): void;
}

interface PortSample {
  terminals: ReadonlyMap<TerminalId, { rootPid: number; ports: TerminalPorts }>;
  host: HostListeners;
}

const NO_SAMPLE: PortSample = {
  terminals: new Map(),
  host: UNKNOWN_HOST_LISTENERS,
};

export function createPortSampler(opts: {
  targets: () => readonly PortScanTarget[];
  publish: (id: TerminalId, ports: TerminalPorts) => void;
  rootPidOf: (id: TerminalId) => number | undefined;
  publishHost: (listeners: HostListeners) => void;
  log: Logger;
  scan?: (
    rootPids: readonly number[],
  ) => Effect.Effect<PortScan, PortScanError>;
}): PortSampler {
  const scan = opts.scan ?? scanPorts;
  if (!portScanSupported()) {
    opts.log.error(
      { platform: process.platform },
      "port scan unsupported on this platform — the Ports section will stay empty; not arming the sampler",
    );
    return { dispose: () => {} };
  }
  let lastGoodSample: PortSample = NO_SAMPLE;

  const reserveLastSample = (
    target: PortScanTarget,
  ): { rootPid: number; ports: TerminalPorts } | undefined => {
    const held = lastGoodSample.terminals.get(target.id);
    return held?.rootPid === target.rootPid ? held : undefined;
  };

  let loggedDroppedPids = new Set<number>();

  const abort = new AbortController();

  const node = source<PortSample>({
    label: "terminalPorts",
    read: async () => {
      const targets = opts.targets();
      try {
        const { byRoot, host, unattributable, ownerExited } =
          await Effect.runPromise(scan(targets.map((t) => t.rootPid)));
        const nowDropped = new Set(unattributable.map((d) => d.pid));
        for (const d of unattributable) {
          if (loggedDroppedPids.has(d.pid)) continue;
          opts.log.warn(
            { pid: d.pid, port: d.port },
            "port scan: a listener's owner could not be read (another user's process?) — dropped from every fold",
          );
        }
        loggedDroppedPids = nowDropped;
        for (const e of ownerExited) {
          opts.log.debug(
            { pid: e.pid, port: e.port },
            "port scan: a listener's pid exited before its name could be read — shown as (exited)",
          );
        }
        const missing = targets.filter((t) => !byRoot.has(t.rootPid));
        if (missing.length > 0) {
          opts.log.error(
            { missing: missing.map((t) => t.id) },
            "port scan did not answer for every requested terminal — ports left at their last sample",
          );
          return lastGoodSample;
        }
        const next = new Map<
          TerminalId,
          { rootPid: number; ports: TerminalPorts }
        >();
        for (const t of targets) {
          const list = byRoot.get(t.rootPid)!;
          const held = reserveLastSample(t);
          if (list === "blind") {
            if (held) next.set(t.id, held);
            continue;
          }
          const ports: TerminalPorts =
            held &&
            held.ports.status === "known" &&
            samePortList(held.ports.list, list)
              ? held.ports
              : { status: "known", list };
          next.set(t.id, { rootPid: t.rootPid, ports });
        }
        lastGoodSample = { terminals: next, host };
        return lastGoodSample;
      } catch (err) {
        if (
          err instanceof PortScanError &&
          err.kind === "unsupported-platform"
        ) {
          opts.log.fatal(
            { err },
            "port sampler stopped — this host's listening ports cannot be read",
          );
          abort.abort();
          throw err;
        }
        opts.log.error(
          { err },
          "port scan failed — ports left at their last sample",
        );
        return lastGoodSample;
      }
    },
    install: everyMs(PORT_SCAN_INTERVAL_MS),
  });

  const sampler: PortSampler = {
    dispose: () => abort.abort(),
  };
  void node
    .connectPoll((sample) => {
      for (const [id, held] of sample.terminals) {
        if (opts.rootPidOf(id) !== held.rootPid) continue;
        opts.publish(id, held.ports);
      }
      opts.publishHost(sample.host);
    }, abort.signal)
    .catch((err: unknown) => {
      opts.log.fatal(
        { err },
        "port sampler could not arm its cadence — this host's listening ports will not be read",
      );
      sampler.dispose();
    });

  return sampler;
}
