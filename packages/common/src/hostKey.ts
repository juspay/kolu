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

/** The wire/zod schema for {@link HostKey} — validates the OBJECT (the discriminant
 *  tag makes the union nominal; there is no `.brand()` to layer on top). The wire
 *  handler re-validates every `HostKey`-shaped input through this SAME schema (P5).
 *  `target` is `.min(1)` — a remote with an empty target is not a valid `HostKey`,
 *  which is why {@link HostKey} is DERIVED from this schema (`z.infer`) rather than a
 *  hand-rolled type: a hand-rolled `target: string` would silently admit the empty
 *  string the schema rejects, so the two could never disagree in the first place. The
 *  emptiness rule itself is enforced only at the value-construction boundary
 *  ({@link parseHostInput}) and by re-validating through this schema — TS has no
 *  non-empty-string type to check it statically. */
export const HostKeySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("local") }),
  z.object({ kind: z.literal("remote"), target: z.string().min(1) }),
]);

/** The per-host key. A nominal sum — `{ kind: "local" }` (the pool's implicit,
 *  unremovable default member) or `{ kind: "remote"; target }` (an ssh destination:
 *  an `~/.ssh/config` alias or `user@host`). Lifted off {@link HostKeySchema} — the
 *  SOLE schema, not a hand-rolled type — so the union is nominal by its `kind` tag
 *  (not a brand) and can never drift from what the schema actually validates. */
export type HostKey = z.infer<typeof HostKeySchema>;

/** The canonical local-host key — the pool's implicit, UNREMOVABLE default member.
 *  A DISTINCT concept from padi's daemon-status key (`HostLocation`, encoded via
 *  `encodeHostLocation` — @kolu/padi/surface): this is the map key a browser tab
 *  selects; that is the key padi reports daemon status under. They name the same
 *  machine but own different axes — never conflate them. */
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

/** THE membership-equality authority: is `key` a member of `keys`? Compared by
 *  `encodeHostKey` — a `HostKey` is an object with no reference identity across
 *  independent decodes, so it is never `===`. The single edit site for "how a
 *  HostKey's pool-membership is decided", so the READ-side scope grounding
 *  (`groundActiveHost`) and the WRITE-side active-host reconcile
 *  (`hostReconcileTarget`) share ONE encode-equality SCAN — the membership check
 *  can't drift between them. (They are NOT identical DECISIONS: `hostReconcileTarget`
 *  short-circuits `local` on the server invariant that `LOCAL_HOST` is the unremovable
 *  seed and never scans for it, while `groundActiveHost` scans uniformly — so the two
 *  agree for local only while that invariant holds, which `wire.ts` asserts fail-fast.) */
export function hostKeysInclude(
  keys: readonly HostKey[],
  key: HostKey,
): boolean {
  const enc = encodeHostKey(key);
  return keys.some((k) => encodeHostKey(k) === enc);
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

/** Whether a string is a CANONICAL encoded host key — exactly what {@link decodeHostKey}
 *  accepts (`"local"` or `"remote:<target>"`). The total, throw-free predicate for a
 *  parse-boundary guard: validate a candidate key HERE (drop/reject a malformed one)
 *  rather than let it throw inside `decodeHostKey` downstream. Used by the attention
 *  click-envelope guard (client) and the persisted-hosts schema (server). */
export function isEncodedHostKey(s: string): boolean {
  try {
    decodeHostKey(s);
    return true;
  } catch {
    return false;
  }
}

/** The persisted host-membership list — the encoded keys the pool remembers across a
 *  kolu restart, stored as the `hosts` field of the server's conf state store (see
 *  `packages/server/src/state.ts`'s `PersistedStateSchema`), NOT a standalone file: it
 *  rides the same schema + migration ladder as every other durable server fact. A
 *  well-formed value is exactly what the pool's `persist` hook writes: canonical encoded
 *  keys, no `local` (the code-seeded default is never persisted — persisting it would mint
 *  a second authority for "local always exists"), no duplicates. Each is a schema-level
 *  invariant, so a hand-edited store that violates one is REJECTED loud where it's read
 *  (`getPersistedHosts` throws) rather than silently normalized — the fail-fast stance a
 *  silently-shrunk fleet would violate. */
export const PersistedHostsSchema = z
  .array(
    z.string().refine(isEncodedHostKey, {
      message: "not a canonical encoded host key",
    }),
  )
  .refine((hosts) => !hosts.includes(encodeHostKey(LOCAL_HOST)), {
    message: `the local default (${JSON.stringify(encodeHostKey(LOCAL_HOST))}) must never be persisted`,
  })
  .refine((hosts) => new Set(hosts).size === hosts.length, {
    message: "duplicate host entries",
  });

/** Bare-loopback spellings of "this machine, as the current user" — the SAME host
 *  `{ kind: "local" }` already names, just three other words for it. Without this,
 *  `parseHostInput("localhost")` took the word LITERALLY as a remote target and
 *  `parseKoluPadiHostSeed` (whose dedup compares ENCODED strings) minted a second,
 *  ssh-bound pool entry for a host already in the pool as the implicit default —
 *  `KOLU_PADI_HOST=localhost,srid@zest` rendered THREE chips (`local` + `localhost`
 *  + `srid@zest`) instead of two. Deliberately NOT the machine's own hostname: this
 *  module is shared with the BROWSER bundle (no `os.hostname()` import belongs
 *  here) — a consumer that needs that comparison resolves it server-side, outside
 *  this codec. `user@localhost` is excluded on purpose — ssh-ing to the loopback
 *  AS ANOTHER USER is a genuinely different session, so only the BARE spelling
 *  (no `@`) dedupes. */
const LOOPBACK_SELF_SPELLINGS = new Set(["localhost", "127.0.0.1", "::1"]);

/** PARSE — raw HUMAN/env input (the add-host picker, a `KOLU_PADI_HOST` seed token):
 *  the literal word `"local"`, or a bare loopback spelling ({@link
 *  LOOPBACK_SELF_SPELLINGS}), names the local default; EVERYTHING else NON-EMPTY is
 *  taken LITERALLY as a remote target — including a string that happens to start with
 *  `"remote:"` (unlike {@link decodeHostKey}, this codec never interprets that
 *  prefix — a user typing an ssh alias literally named `remote:zest` gets a remote
 *  target of exactly `"remote:zest"`), and including `user@localhost` (ssh as a
 *  DIFFERENT user to the loopback is a distinct remote target, not the local
 *  default). Total over every non-empty string: unlike the old branded-string schema,
 *  there is no reserved-name reject to fail. An EMPTY string is the one input this
 *  codec refuses — `{ kind: "remote", target: "" }` is not a `HostKey` {@link
 *  HostKeySchema} would accept, so admitting it here would silently mint a value that
 *  fails validation the moment it crosses the wire. Every real caller already filters
 *  blank tokens before parsing (the picker's own guard, `parseKoluPadiHostSeed`'s
 *  `.filter((h) => h.length > 0)`), so this is a defensive floor, not a path taken in
 *  practice — but it means a FUTURE caller that forgets to filter fails loud here
 *  instead of minting an illegal `HostKey` downstream. */
export function parseHostInput(userStr: string): HostKey {
  if (userStr === "local" || LOOPBACK_SELF_SPELLINGS.has(userStr)) {
    return LOCAL_HOST;
  }
  if (userStr.length === 0) {
    throw new Error(
      "parseHostInput: an empty string is not a valid host — filter blank tokens before parsing",
    );
  }
  return { kind: "remote", target: userStr };
}
