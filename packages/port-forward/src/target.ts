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

/** WHICH loopback address the far side is actually listening on.
 *
 *  `127.0.0.1` and `::1` are both "loopback" and they are not the same address.
 *  Every mechanism here connects to the far side's loopback, so getting this
 *  wrong fails in the worst available way: the door opens, reports success, and
 *  refuses every connection through it. Measured, not theorised — a dev server on
 *  `[::1]:5173` was forwarded to `127.0.0.1:5173` and served nothing at all.
 *
 *  Required rather than defaulted, so a caller must state what it observed. A
 *  default would be a guess wearing the shape of a fact, and it is exactly the
 *  guess that shipped. */
export type LoopbackFamily = "v4" | "v6";

/** The loopback address of each family — the literal a mechanism dials. */
export const LOOPBACK_ADDRESS: Record<LoopbackFamily, string> = {
  v4: "127.0.0.1",
  v6: "::1",
};

/** The family to dial when NOTHING observed one — a bare `:port`, a remote
 *  `box:port` that names no address, a consumer whose scan is blind.
 *
 *  v4 because it is what almost everything binds and what every forward did
 *  before the family existed; and when it is wrong the failure is loud at the
 *  point of use (connections refused through an open door) rather than silent.
 *  There is deliberately no "try the other one" path: a dial that guesses twice
 *  is a fallback chain, and the fix for not knowing is to know.
 *
 *  The ONE place this assumption is declared, for every consumer — it is one
 *  decision, and a consumer that restated it would be a second home to edit when
 *  the decision moves. A consumer keeps its own name for WHY it reached the
 *  assumption; what it must not keep is its own answer. */
export const ASSUMED_LOOPBACK: LoopbackFamily = "v4";

export type ForwardTarget =
  /** A loopback listener on the machine this library runs on. */
  | {
      readonly kind: "local";
      readonly port: number;
      readonly loopback: LoopbackFamily;
    }
  /** A loopback listener on `host`, reached over ssh. `host` is any ssh
   *  destination — `user@box`, an `~/.ssh/config` alias, a bare hostname. */
  | {
      readonly kind: "remote";
      readonly host: string;
      readonly port: number;
      readonly loopback: LoopbackFamily;
    };

/** The identity of a target — one forward per (host, port), so this is the
 *  key of the forward map. `local` is its own namespace: `localhost:5173`
 *  reached over ssh to a host named `localhost` would be a different tunnel
 *  than the same port relayed here.
 *
 *  `loopback` is deliberately NOT part of the key. It says how to reach the
 *  target, not which target it is: a server listening on both `127.0.0.1:5173`
 *  and `[::1]:5173` is ONE server, and two creates naming it by different
 *  families must not open two doors onto it. So the second create is the
 *  idempotent hit the map already promises, and it keeps the family the first
 *  one opened with — which is correct, since that door demonstrably works.
 *
 *  A map key and never display text — it differs from `formatTarget` for local
 *  targets (`local:5173` vs `localhost:5173`), so anything a user reads must
 *  come from `formatTarget`. */
export function targetKey(target: ForwardTarget): string {
  // Every encoding carries the KIND, because the two namespaces genuinely
  // overlap: `local` is a legal ssh alias, so a bare `local:5173` would name
  // both the loopback relay on 5173 and a tunnel to a host called `local` —
  // and the map would hand out whichever of them was created first.
  return target.kind === "local"
    ? `local:${target.port}`
    : `remote:${target.host}:${target.port}`;
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

/** Reject a target that cannot be forwarded — the check the MAP makes, before a
 *  key is computed or a flight registered, so an invalid target never depends
 *  on which mechanism happens to be plugged in to be caught. */
export function assertTarget(target: ForwardTarget): void {
  assertPort(
    target.port,
    target.kind === "local"
      ? "the local target port"
      : `the port on ${target.host}`,
  );
  if (target.kind === "remote") assertHost(target.host);
}

/** The two halves of the one text form both apps accept, with the port already
 *  validated — the TOKENIZER under {@link parseTarget}, published on its own
 *  because kolu's command palette parses the same text against a different
 *  policy and was writing a second copy of this.
 *
 *  `host` is `undefined` when the text names no machine at all (a bare `5173`)
 *  and `""` for the `:5173` spelling, because those are different inputs and the
 *  two apps disagree about them: vazhi rejects the first and reads the second as
 *  its local relay, kolu reads both as the host you are looking at. The same is
 *  true of the SENTENCE each shows a user, so a failure comes back as a reason
 *  rather than as prose and the caller writes the copy. */
export type HostPortSplit =
  | { ok: true; host: string | undefined; port: number }
  | { ok: false; reason: "no-port" }
  | { ok: false; reason: "not-a-tcp-port"; port: number };

export function splitHostPort(text: string): HostPortSplit {
  const trimmed = text.trim();
  // The LAST colon, so a colon-bearing ssh destination (`user@box:2222`) cannot
  // swallow its own port.
  const colon = trimmed.lastIndexOf(":");
  const portText = colon === -1 ? trimmed : trimmed.slice(colon + 1);
  if (!/^\d+$/.test(portText)) return { ok: false, reason: "no-port" };
  const port = Number(portText);
  if (port < MIN_PORT || port > MAX_PORT) {
    return { ok: false, reason: "not-a-tcp-port", port };
  }
  return {
    ok: true,
    host: colon === -1 ? undefined : trimmed.slice(0, colon),
    port,
  };
}

/** Parse the one text form both apps accept — `host:port` for a remote target,
 *  `localhost:port` / `127.0.0.1:port` / bare `:port` for a local one. Throws
 *  with the offending text on anything else: this is user input arriving from
 *  a TUI prompt or a command palette, so the message is the error UI.
 *
 *  The loopback FAMILY is read off the spelling where the spelling says it —
 *  `::1:5173` is a v6 target, `127.0.0.1:5173` a v4 one. Where it does not say
 *  (a bare `:5173`, or any remote `box:5173`, neither of which names an address
 *  at all) it falls to {@link ASSUMED_LOOPBACK}, which is where that assumption
 *  is declared for every consumer. A caller that KNOWS better — kolu reads the
 *  family off its port scan — builds the target itself rather than going through
 *  here.
 *
 *  Bracketed IPv6 literals (`[::1]:5173`) are rejected: the brackets are URL
 *  syntax that ssh does not take, so they fail loudly here rather than reaching
 *  an ssh argv that cannot use them. */
export function parseTarget(text: string): ForwardTarget {
  const split = splitHostPort(text);
  if (!split.ok) {
    throw new Error(
      split.reason === "not-a-tcp-port"
        ? `port-forward: the port in "${text}" must be an integer between ${MIN_PORT} and ${MAX_PORT}, got ${split.port}.`
        : `port-forward: "${text}" has no port — write host:port (e.g. pu-dev:5173) or :port for a local one.`,
    );
  }
  if (split.host === undefined) {
    // A bare number names no machine at all. vazhi's `:port` spelling is how a
    // user says "this one", and it is deliberately explicit — a target is a
    // (machine, port) pair and half of one is not a target.
    throw new Error(
      `port-forward: "${text}" is not a target — write host:port (e.g. pu-dev:5173) or :port for a local one.`,
    );
  }
  const { host, port } = split;
  // Every spelling of "this machine" — the same set `@kolu/common`'s
  // `LOOPBACK_SELF_SPELLINGS` documents as canonical (restated, not imported:
  // this package stays dependency-free). Without `::1`, `::1:5173` parsed as an
  // ssh hop to a host named `::1` instead of a local relay.
  if (
    host === "" ||
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1"
  ) {
    // `::1` is the one spelling that names v6 outright. `localhost` is NOT
    // treated as v6 even though it often resolves there first: this field exists
    // to carry an observed fact, and a resolver's preference is not one.
    return {
      kind: "local",
      port,
      loopback: host === "::1" ? "v6" : ASSUMED_LOOPBACK,
    };
  }
  assertHost(host);
  return { kind: "remote", host, port, loopback: ASSUMED_LOOPBACK };
}
