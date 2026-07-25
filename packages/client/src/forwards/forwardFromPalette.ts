/**
 * The ⌘K "Forward a port…" target — parsing what a human types, and doing it.
 *
 * Lives here rather than inline in `commands.tsx` because it is a parse plus an
 * async call plus its error handling, and the palette registry stays a registry
 * (`.claude/rules/solidjs.md`: commands call a handler, they do not contain one).
 *
 * The input is `host:port`, or a bare port meaning the host you are looking at.
 * The host must be one kolu already has, and that is a real restriction rather
 * than an oversight: every surface that shows forwards is host-scoped (the
 * Inspector group, the host tab's dropdown and its `⇄ n` badge), so a forward to
 * a machine with no host tab would be a live listener with nowhere to see or
 * cancel it. Refusing loudly beats opening a door that appears in no list.
 */

import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import { toast } from "solid-sonner";
import { createForward } from "./useForwards";

/** A parsed palette target, or why it could not be one. */
export type ForwardInput =
  | { ok: true; host: HostKey; port: number }
  | { ok: false; message: string };

/** Parse `host:port` / `port` against the hosts kolu actually has.
 *
 *  Split on the LAST colon so an IPv6-looking host cannot swallow its own port —
 *  though a bracketed literal is rejected below anyway, since a kolu host key is
 *  an ssh destination and ssh takes a bare address. */
export function parseForwardInput(
  raw: string,
  hosts: readonly HostKey[],
  activeHost: HostKey,
): ForwardInput {
  const text = raw.trim();
  if (text === "") return { ok: false, message: "Type a port, or host:port." };

  const colon = text.lastIndexOf(":");
  const portText = colon === -1 ? text : text.slice(colon + 1);
  const hostText = colon === -1 ? "" : text.slice(0, colon);

  if (!/^\d+$/.test(portText)) {
    return { ok: false, message: `"${text}" has no port number.` };
  }
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, message: `${port} is not a TCP port (1–65535).` };
  }

  // No host named: the one you are looking at. That is the common case (a port
  // on the machine whose terminals are on screen) and saves typing its name.
  if (hostText === "") return { ok: true, host: activeHost, port };

  const match = hosts.find((h) => h.kind === "remote" && h.target === hostText);
  if (match !== undefined) return { ok: true, host: match, port };
  // A local host has no target to type, so let its spellings name it explicitly
  // rather than only being reachable by omission.
  if (hostText === "local" || hostText === "localhost") {
    const local = hosts.find((h) => h.kind === "local");
    if (local !== undefined) return { ok: true, host: local, port };
  }
  return {
    ok: false,
    message: `kolu has no host "${hostText}" — add it first, or use a bare port for ${labelOf(activeHost)}.`,
  };
}

function labelOf(host: HostKey): string {
  return host.kind === "local" ? "this machine" : host.target;
}

/** The palette's per-keystroke validator — the message under the input. */
export function forwardInputError(
  raw: string,
  hosts: readonly HostKey[],
  activeHost: HostKey,
): string | null {
  // An empty field is not an error while the user is still typing; it just
  // cannot be submitted, which the palette handles by refusing empty values.
  if (raw.trim() === "") return null;
  const parsed = parseForwardInput(raw, hosts, activeHost);
  return parsed.ok ? null : parsed.message;
}

/** Submit. `manual`, because the user named this target: kolu is watching no
 *  listener on their behalf here — the port may be one no scanner can see — so
 *  nothing but an explicit cancel (or the host leaving) may close it. */
export function forwardFromPalette(
  raw: string,
  hosts: readonly HostKey[],
  activeHost: HostKey,
): void {
  const parsed = parseForwardInput(raw, hosts, activeHost);
  if (!parsed.ok) {
    toast.error(parsed.message);
    return;
  }
  createForward({
    host: parsed.host,
    port: parsed.port,
    origin: "manual",
  }).then(
    (forward) =>
      toast.success(
        `Forwarding ${labelOf(parsed.host)}:${parsed.port} on port ${forward.localPort}`,
      ),
    (err: Error) =>
      toast.error(
        `Could not forward ${labelOf(parsed.host)}:${parsed.port}: ${err.message}`,
      ),
  );
}

/** Exported for the unit test — the encoded form the parse matched on. */
export function encodedHostOf(input: ForwardInput): string | null {
  return input.ok ? encodeHostKey(input.host) : null;
}
