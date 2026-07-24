/**
 * What a forward points AT, and the `host:port` text both apps accept for it.
 *
 * Two kinds, because they need genuinely different mechanisms (see the plan's
 * "three cases" table): a `remote` target is one ssh hop away and rides an
 * `ssh -L` tunnel; a `local` target is a loopback listener on THIS machine
 * that simply isn't reachable from anywhere else, and needs only a TCP relay.
 * A server already bound to `0.0.0.0` here needs no forward at all and is
 * deliberately not modelled — that is the caller's "nothing to do" case.
 */

/** The lowest TCP port a target may name. Port 0 means "any" to the kernel,
 *  never a server you can point at, so it is rejected rather than silently
 *  turned into an ephemeral bind. */
const MIN_PORT = 1;
const MAX_PORT = 65535;

export type ForwardTarget =
  /** A loopback listener on the machine this library runs on. */
  | { readonly kind: "local"; readonly port: number }
  /** A loopback listener on `host`, reached over ssh. `host` is any ssh
   *  destination — `user@box`, an `~/.ssh/config` alias, a bare hostname. */
  | { readonly kind: "remote"; readonly host: string; readonly port: number };

/** The identity of a target — one forward per (host, port), so this is the
 *  key of the forward map. `local` is its own namespace: `localhost:5173`
 *  reached over ssh to a host named `localhost` would be a different tunnel
 *  than the same port relayed here. */
export function targetKey(target: ForwardTarget): string {
  return target.kind === "local"
    ? `local:${target.port}`
    : `${target.host}:${target.port}`;
}

/** The target as a human types it — the inverse of `parseTarget`. */
export function formatTarget(target: ForwardTarget): string {
  return target.kind === "local"
    ? `localhost:${target.port}`
    : `${target.host}:${target.port}`;
}

/** Reject anything that isn't a real TCP port. Ports reach an ssh argv and a
 *  socket bind, so a bad one must fail here — loudly, naming the value — and
 *  never reach either. */
export function assertPort(port: number, what: string): void {
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    throw new Error(
      `port-forward: ${what} must be an integer between ${MIN_PORT} and ${MAX_PORT}, got ${port}.`,
    );
  }
}

/** Every character an ssh destination may NOT contain: whitespace and control
 *  characters (`\p{Cc}`). Neither names a real host, and both would reach an
 *  ssh argv verbatim. */
const FORBIDDEN_IN_HOST = /[\s\p{Cc}]/u;

/** Reject an ssh destination that can't be one. A leading `-` would be read by
 *  ssh as an OPTION rather than a host, and whitespace/control characters
 *  never name a real destination — both are rejected here so a typo can't turn
 *  into an ssh flag we didn't intend to pass. */
export function assertHost(host: string): void {
  if (host === "") {
    throw new Error("port-forward: the ssh host is empty.");
  }
  if (host.startsWith("-")) {
    throw new Error(
      `port-forward: the ssh host "${host}" starts with "-", which ssh would read as an option.`,
    );
  }
  if (FORBIDDEN_IN_HOST.test(host)) {
    throw new Error(
      `port-forward: the ssh host "${host}" contains whitespace or control characters.`,
    );
  }
  // `[::1]` is URL syntax, not ssh syntax — ssh takes a bare address. Reject it
  // rather than pass brackets through to an ssh that will not understand them.
  if (host.includes("[") || host.includes("]")) {
    throw new Error(
      `port-forward: the ssh host "${host}" is written as a bracketed IPv6 literal; ssh wants a bare address, hostname, or alias.`,
    );
  }
}

/** Parse the one text form both apps accept — `host:port` for a remote target,
 *  `localhost:port` / `127.0.0.1:port` / bare `:port` for a local one. Throws
 *  with the offending text on anything else: this is user input arriving from
 *  a TUI prompt or a command palette, so the message is the error UI.
 *
 *  Bracketed IPv6 literals (`[::1]:5173`) are rejected: the brackets are URL
 *  syntax that ssh does not take, so they fail loudly here rather than reaching
 *  an ssh argv that cannot use them. */
export function parseTarget(text: string): ForwardTarget {
  const trimmed = text.trim();
  const colon = trimmed.lastIndexOf(":");
  if (colon === -1) {
    throw new Error(
      `port-forward: "${text}" is not a target — write host:port (e.g. pu-dev:5173) or :port for a local one.`,
    );
  }
  const host = trimmed.slice(0, colon);
  const portText = trimmed.slice(colon + 1);
  if (!/^\d+$/.test(portText)) {
    throw new Error(
      `port-forward: "${text}" has no port — write host:port (e.g. pu-dev:5173).`,
    );
  }
  const port = Number(portText);
  assertPort(port, `the port in "${text}"`);
  if (host === "" || host === "localhost" || host === "127.0.0.1") {
    return { kind: "local", port };
  }
  assertHost(host);
  return { kind: "remote", host, port };
}
