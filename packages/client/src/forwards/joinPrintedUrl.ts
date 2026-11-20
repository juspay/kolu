import {
  type HostListeners,
  type HostPort,
  type KoluForward,
  listenerAt,
  type PortInfo,
  type PortBind,
} from "kolu-common/surface";
import { parseLoopbackUrl } from "@kolu/url-shape";
import { match } from "ts-pattern";

/** What the join finds for a printed URL.
 *
 *  - `external`  — not a loopback URL; leave the default open alone
 *  - `joined`    — this tile's own subtree serves the port
 *  - `elsewhere` — a readable program elsewhere on the host serves it
 *  - `unclaimed` — something on the host serves it; its owner is not visible
 *  - `unbacked`  — the host was read, and nothing is listening on that port
 *  - `blind`     — could not tell: the host is not read, or the port is not
 *                  claimed and the unclaimed half is blind (`unknown` is never "no")
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
    }
  | {
      kind: "elsewhere";
      port: number;
      /** Carries `heldByTerminal`: false is a DETACHED server. */
      info: HostPort;
      forward: KoluForward | undefined;
    }
  | {
      kind: "unclaimed";
      port: number;
      bind: PortBind;
      forward: KoluForward | undefined;
    };

/** Join a printed URL string against the tile, the host, and the host's doors. */
export function joinPrintedUrl(opts: {
  uri: string;
  tilePorts: readonly PortInfo[];
  host: HostListeners;
  /** Host-scoped forwards already filtered by the caller. */
  forwards: readonly KoluForward[];
}): PrintedUrlJoin {
  const loopback = parseLoopbackUrl(opts.uri);
  if (loopback === null) return { kind: "external" };
  return joinPrintedPort({ ...opts, port: loopback.port });
}

export function joinPrintedPort(opts: {
  port: number;
  tilePorts: readonly PortInfo[];
  host: HostListeners;
  forwards: readonly KoluForward[];
}): PrintedUrlJoin {
  const forward = opts.forwards.find((f) => f.remotePort === opts.port);
  const info = opts.tilePorts.find((p) => p.port === opts.port);
  if (info !== undefined) {
    return { kind: "joined", port: opts.port, info, forward };
  }
  const at = listenerAt(opts.host, opts.port);
  return match(at)
    .with(
      { kind: "claimed" },
      (a): PrintedUrlJoin => ({
        kind: "elsewhere",
        port: opts.port,
        info: a.info,
        forward,
      }),
    )
    .with(
      { kind: "unclaimed" },
      (a): PrintedUrlJoin => ({
        kind: "unclaimed",
        port: opts.port,
        bind: a.bind,
        forward,
      }),
    )
    .with(
      { kind: "absent" },
      (): PrintedUrlJoin => ({
        kind: "unbacked",
        port: opts.port,
      }),
    )
    .with(
      { kind: "unknown" },
      (): PrintedUrlJoin => ({
        kind: "blind",
        port: opts.port,
      }),
    )
    .exhaustive();
}
