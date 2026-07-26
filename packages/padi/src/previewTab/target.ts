/**
 * Preview target validation — the no-raw-URLs invariant for PRT3.
 *
 * `previewOpen` takes `(terminal, port, path)`, never a raw URL. Path is
 * path+query only; schemes, hosts, and protocol-relative `//` refuse loudly.
 * The port must be a live door or a scanned port on that terminal's host (or
 * the terminal's current preview port — path-only navigate-on-repeat).
 *
 * Pure and total so unit tests pin the policy without a socket, and so the
 * serve path is a reader of the same function rather than a second author.
 */

import { isTcpPort } from "@kolu/terminal-vocab/ports";
import { ORPCError } from "@orpc/server";

/** A preview location — the unit the chrome record stores and the trail records. */
export type PreviewLocation = {
  port: number;
  path: string;
};

/** Why a path string is not a legal preview path. */
export type PreviewPathReject =
  | { kind: "scheme"; scheme: string }
  | { kind: "protocol-relative" }
  | { kind: "host" };

/** Inspect a raw path string. Returns null when it is path+query only. */
export function previewPathReject(raw: string): PreviewPathReject | null {
  const t = raw.trim();
  // Empty is fine — normalises to `/`.
  if (t === "") return null;
  // Protocol-relative: `//evil.example/…` (before scheme, since `//` is not one).
  if (t.startsWith("//")) return { kind: "protocol-relative" };
  // Authority-form scheme: `http://…`, `https://…`, `ftp://…`.
  const authority = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(t);
  if (authority?.[1] !== undefined) {
    return { kind: "scheme", scheme: authority[1] };
  }
  // Opaque schemes that never take `//` but are still raw URLs, not paths.
  const opaque = /^(about|javascript|data|blob|mailto|tel):/i.exec(t);
  if (opaque?.[1] !== undefined) {
    return { kind: "scheme", scheme: opaque[1].toLowerCase() };
  }
  // Host:port with no scheme and no leading slash — a URL authority, not a path.
  if (!t.startsWith("/") && /^[a-zA-Z0-9.-]+:\d+/.test(t)) {
    return { kind: "host" };
  }
  // Dotted hostname then path (`example.com/foo`) — not a relative path segment.
  if (!t.startsWith("/") && /^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+\//.test(t)) {
    return { kind: "host" };
  }
  return null;
}

/** Normalise a path to a rooted path+query string, or throw BAD_REQUEST. */
export function assertPreviewPath(raw: string): string {
  const reject = previewPathReject(raw);
  if (reject !== null) {
    throw new ORPCError("BAD_REQUEST", {
      message: previewPathRejectMessage(raw, reject),
    });
  }
  const t = raw.trim();
  if (t === "") return "/";
  return t.startsWith("/") ? t : `/${t}`;
}

export function previewPathRejectMessage(
  raw: string,
  reject: PreviewPathReject,
): string {
  switch (reject.kind) {
    case "scheme":
      return `preview path must be path+query only — refused scheme "${reject.scheme}:" in ${JSON.stringify(raw)}`;
    case "protocol-relative":
      return `preview path must be path+query only — refused protocol-relative "//" in ${JSON.stringify(raw)}`;
    case "host":
      return `preview path must be path+query only — refused host-shaped ${JSON.stringify(raw)}`;
  }
}

/** Port membership: live door ∪ scanned ∪ current preview port (navigate). */
export function assertPreviewPortAllowed(opts: {
  port: number;
  scannedPorts: ReadonlySet<number>;
  doorPorts: ReadonlySet<number>;
  /** The terminal's current preview port, if any — re-open with a new path. */
  currentPort: number | null;
}): void {
  if (!isTcpPort(opts.port)) {
    throw new ORPCError("BAD_REQUEST", {
      message: `${opts.port} is not a TCP port (1–65535)`,
    });
  }
  if (
    opts.scannedPorts.has(opts.port) ||
    opts.doorPorts.has(opts.port) ||
    opts.currentPort === opts.port
  ) {
    return;
  }
  throw new ORPCError("BAD_REQUEST", {
    message: `port ${opts.port} is not a scanned port or live door on this host`,
  });
}

/** Full target check — path then port. Returns the normalised location. */
export function assertPreviewTarget(opts: {
  port: number;
  path: string;
  scannedPorts: ReadonlySet<number>;
  doorPorts: ReadonlySet<number>;
  currentPort: number | null;
}): PreviewLocation {
  const path = assertPreviewPath(opts.path);
  assertPreviewPortAllowed({
    port: opts.port,
    scannedPorts: opts.scannedPorts,
    doorPorts: opts.doorPorts,
    currentPort: opts.currentPort,
  });
  return { port: opts.port, path };
}

// samePreviewLocation lives on chromeVocab next to PreviewLocationSchema —
// browser-safe, shared with the client trail's isSameEntry.
