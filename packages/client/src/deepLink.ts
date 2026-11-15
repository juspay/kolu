/** The deep-link grammar — a hash-URL parser that turns a `#/…` fragment into a
 *  fully-formed navigation request, or an explicit "invalid"/"none" verdict.
 *  Never a partially-valid route: a link is parsed to a total `DeepLink`, or it
 *  is rejected whole (`invalid`) — the router that consumes this can act on a
 *  `DeepLink` without re-checking any field.
 *
 *  Boundary DOMAIN validation, borrowed verbatim (bar the shape) from
 *  `attentionNotify.ts`'s click-envelope guard: `<host>` must be a canonical
 *  encoded key (`isEncodedHostKey` — else `decodeHostKey` throws at route time)
 *  and `<terminalId>` a real UUID (`TerminalIdSchema`). Same two facts every
 *  attention-notification click already carries, validated the same way.
 *
 *  The grammar (v1, the whole menu):
 *
 *    #/h/<host>                                  → switch the host binding
 *    #/t/<host>/<terminalId>                     → that host + the tile focused
 *    #/t/<host>/<terminalId>/code?path=<p>&line=<n>  → the Code tab, <p> open (at <n>)
 *    #/t/<host>/<terminalId>/inspector           → the Inspector tab
 *    #/settings                                  → the settings dialog
 *
 *  `line` lives INSIDE the code variant (a line without a path has no encoding),
 *  and `<host>` is carried as its encoded string (decoded at route time, exactly
 *  as the notification path does), never a decoded `HostKey`. */

import { Result, Schema } from "effect";
import { isEncodedHostKey } from "kolu-common/hostKey";
import { type TerminalId, TerminalIdSchema } from "kolu-common/surface";
import { hashSegments } from "./hashPath";

/** zod's `safeParse` in Effect terms — a `Result`, so a bad id segment is a
 *  BRANCH (an `invalid` verdict) rather than a throw out of the parser. */
const decodeTerminalId = Schema.decodeUnknownResult(TerminalIdSchema);

/** A fully-formed, ready-to-route navigation request. Every field is validated;
 *  the router acts on it without re-checking. `host` is the encoded key string. */
export type DeepLink =
  | { kind: "host"; host: string }
  | { kind: "terminal"; host: string; terminalId: TerminalId }
  | {
      kind: "code";
      host: string;
      terminalId: TerminalId;
      path: string;
      line: number | null;
    }
  | { kind: "inspector"; host: string; terminalId: TerminalId }
  | { kind: "settings" };

/** The parse verdict. `none` — no deep link present (empty/bare hash, the normal
 *  app load): the router does nothing, silently. `invalid` — a non-empty hash
 *  that isn't a known route (a typo, a future grammar): the router toasts + goes
 *  home, never silently ignoring a new link shape. */
export type ParsedDeepLink =
  | DeepLink
  | { kind: "none" }
  | { kind: "invalid"; reason: string };

const invalid = (reason: string): ParsedDeepLink => ({
  kind: "invalid",
  reason,
});

/** Parse a raw `location.hash` (with or without the leading `#`) into a verdict. */
export function parseDeepLink(hash: string): ParsedDeepLink {
  // The mechanics — the `#`, the query split, the segments, the decode — are
  // the shared leaf's (`hashPath.ts`); what is this module's is the GRAMMAR
  // over them and what each refusal means here: a route kolu never produced
  // is a toast, an address with no route at all is silence.
  const read = hashSegments(hash);
  if (read.kind === "empty") return { kind: "none" };
  if (read.kind === "bad") return invalid(read.reason);
  const queryPart = read.query;

  const [family, ...rest] = read.segments;

  if (family === "settings") {
    if (rest.length !== 0)
      return invalid("#/settings takes no further segments");
    return { kind: "settings" };
  }

  if (family === "h") {
    const host = rest[0];
    if (rest.length !== 1 || host === undefined)
      return invalid("#/h expects exactly one <host> segment");
    if (!isEncodedHostKey(host))
      return invalid(`not a canonical host key: ${host}`);
    return { kind: "host", host };
  }

  if (family === "t") {
    const host = rest[0];
    const idSegment = rest[1];
    if (rest.length < 2 || host === undefined || idSegment === undefined)
      return invalid("#/t expects <host>/<terminalId>");
    if (!isEncodedHostKey(host))
      return invalid(`not a canonical host key: ${host}`);
    const parsedId = decodeTerminalId(idSegment);
    if (Result.isFailure(parsedId))
      return invalid(`not a terminal UUID: ${idSegment}`);
    const terminalId = parsedId.success;

    if (rest.length === 2) return { kind: "terminal", host, terminalId };

    const tab = rest[2];
    if (rest.length > 3 || tab === undefined)
      return invalid("unexpected segments after /code or /inspector");

    if (tab === "inspector") return { kind: "inspector", host, terminalId };

    if (tab === "code") {
      const params = new URLSearchParams(queryPart);
      const path = params.get("path");
      if (path === null || path === "")
        return invalid("#/t/…/code requires a ?path=");
      const lineRaw = params.get("line");
      let line: number | null = null;
      if (lineRaw !== null) {
        // A positive SAFE integer only — reject 0, negatives, decimals,
        // non-numerics, AND digit strings that overflow to Infinity or round
        // past Number.MAX_SAFE_INTEGER to a different line.
        const n = Number(lineRaw);
        if (!/^[0-9]+$/.test(lineRaw) || !Number.isSafeInteger(n) || n < 1) {
          return invalid(`?line must be a positive integer: ${lineRaw}`);
        }
        line = n;
      }
      return { kind: "code", host, terminalId, path, line };
    }

    return invalid(`unknown terminal sub-route: ${tab}`);
  }

  return invalid(`unknown route family: ${family}`);
}
