/**
 * The per-host key — the padi host a browser tab can select in the keyed map.
 *
 * A DISCRIMINATED SUM, not a branded string: the map's local member used to be the
 * in-band sentinel string `"local"` (indistinguishable, at the type level, from any
 * remote host string). `HostKey` makes the two cases NOMINALLY distinct — `{ kind:
 * "local" }` has no `target` to confuse with a remote's ssh destination, and every
 * consumer switches on `.kind` instead of comparing against a magic string.
 *
 * Two boundaries need a STRING form of the key (persisted prefs, URL path segments,
 * `KOLU_PADI_HOST` env tokens, the map's wire `mapKey`/channel names) — `encodeHostKey`
 * / `decodeHostKey` are the CANONICAL wire codec (round-trips exactly), and
 * `parseHostInput` is the separate HUMAN-input codec (the picker + env seed), which
 * takes a raw target LITERALLY rather than interpreting the `"remote:"` wire prefix.
 *
 * Lives in its OWN padi-LESS module (not `surfacesWithPadi.ts`, which imports
 * `@kolu/padi`) so the padi-less `contract.ts` — which needs the key to type the
 * `hosts.add`/`hosts.remove` root RPCs the client's selector strip calls — can import it
 * WITHOUT pulling `@kolu/padi` into the client's contract (the package-boundary seal).
 * `surfacesWithPadi.ts` re-exports it and builds `padiHostMap` from it.
 */

import { z } from "zod";

/** The per-host key. A nominal sum — `{ kind: "local" }` (the pool's implicit,
 *  unremovable default member) or `{ kind: "remote"; target }` (an ssh destination:
 *  an `~/.ssh/config` alias or `user@host`). Zod's `.discriminatedUnion` is the SOLE
 *  schema (`HostKeySchema`), not a hand-rolled type — the union is nominal by its
 *  `kind` tag, not a brand. */
export type HostKey = { kind: "local" } | { kind: "remote"; target: string };

/** The wire/zod schema for {@link HostKey} — validates the OBJECT (the discriminant
 *  tag makes the union nominal; there is no `.brand()` to layer on top). The wire
 *  handler re-validates every `HostKey`-shaped input through this SAME schema (P5). */
export const HostKeySchema: z.ZodType<HostKey> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("local") }),
  z.object({ kind: z.literal("remote"), target: z.string().min(1) }),
]);

/** The canonical local-host key — the pool's implicit, UNREMOVABLE default member.
 *  A DISTINCT concept from padi's daemon-collection key `LOCAL_HOST_ID`
 *  (@kolu/padi/surface): this is the map key a browser tab selects; that is the key
 *  padi reports daemon status under. They name the same machine but own different
 *  axes — never conflate them. */
export const LOCAL_HOST: HostKey = { kind: "local" };

/** The `"remote:"` wire prefix — guarantees a remote's encoded form can never collide
 *  with the bare `"local"` sentinel or any other reserved bare word (a map key equal to
 *  a reserved collection channel suffix, e.g. `"keys"`/`"deltas"`, is therefore
 *  UNCONSTRUCTIBLE by encoding: `"local"` and `"remote:<anything>"` can never equal
 *  either literal). */
const REMOTE_WIRE_PREFIX = "remote:";

/** ENCODE — the CANONICAL wire form of a `HostKey`: `"local"` for the local variant,
 *  `"remote:" + target` for a remote. The sole producer of the string this codec's
 *  `decodeHostKey` half accepts; also what the map's channel names derive from (a
 *  remote's encoded form can never collide with `"keys"`/`"deltas"`, see above). */
export function encodeHostKey(k: HostKey): string {
  return k.kind === "local" ? "local" : `${REMOTE_WIRE_PREFIX}${k.target}`;
}

/** DECODE — the CANONICAL wire form's inverse: `"local"` → the local variant,
 *  `"remote:<target>"` → the remote variant (a `"remote:"` prefix with an empty
 *  target is rejected). Anything else is not a value this codec ever produced —
 *  THROW loudly rather than guess a meaning for it (a corrupt/hand-edited persisted
 *  value, a malformed URL segment). Use this for a value that ALREADY passed through
 *  `encodeHostKey` (a persisted pref, a URL path segment, the map's wire `mapKey`) —
 *  never for raw human/env input, which is `parseHostInput`'s job. */
export function decodeHostKey(s: string): HostKey {
  if (s === "local") return LOCAL_HOST;
  if (s.startsWith(REMOTE_WIRE_PREFIX)) {
    const target = s.slice(REMOTE_WIRE_PREFIX.length);
    if (target.length > 0) return { kind: "remote", target };
  }
  throw new Error(
    `decodeHostKey: "${s}" is not a canonical host key (expected "local" or "remote:<target>")`,
  );
}

/** PARSE — raw HUMAN/env input (the add-host picker, a `KOLU_PADI_HOST` seed token):
 *  the literal word `"local"` names the local default; EVERYTHING else is taken
 *  LITERALLY as a remote target — including a string that happens to start with
 *  `"remote:"` (unlike {@link decodeHostKey}, this codec never interprets that
 *  prefix — a user typing an ssh alias literally named `remote:zest` gets a remote
 *  target of exactly `"remote:zest"`). Total: unlike the old branded-string schema,
 *  there is no reserved-name reject to fail — a bare human string always parses. */
export function parseHostInput(userStr: string): HostKey {
  return userStr === "local" ? LOCAL_HOST : { kind: "remote", target: userStr };
}
