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

import { isEncodedHostKey } from "kolu-common/hostKey";
import { type TerminalId, TerminalIdSchema } from "kolu-common/surface";

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
  // Strip a single leading "#", then split the path from the query. Only the
  // /code route reads the query; other families tolerate (ignore) a stray query
  // rather than reject an otherwise fully-valid route.
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const qIndex = raw.indexOf("?");
  const pathPart = qIndex === -1 ? raw : raw.slice(0, qIndex);
  const queryPart = qIndex === -1 ? "" : raw.slice(qIndex + 1);

  // An empty or bare-slash PATH carries no route — checked AFTER the query is
  // split off, so a root hash with an incidental query (`#/?utm=x`, a bookmark
  // saved with a trailing `?`) is `none`, not a false "invalid" toast.
  if (pathPart === "" || pathPart === "/") return { kind: "none" };

  // Split into segments and decode each. A malformed %-escape is not a route we
  // ever produced — reject it whole. Strip EXACTLY ONE leading empty segment
  // (the leading "/"); any OTHER empty segment — a repeated "//", a trailing
  // "/" — is malformed, not a member of the grammar, so reject rather than
  // silently collapse it (the reject-whole contract). "" / "#" / "#/" already
  // returned `none` above.
  const rawSegments = pathPart.split("/");
  if (rawSegments[0] === "") rawSegments.shift();
  if (rawSegments.length === 0) return { kind: "none" };
  if (rawSegments.some((s) => s === "")) {
    return invalid("empty path segment (a repeated or trailing slash)");
  }
  let segments: string[];
  try {
    segments = rawSegments.map((s) => decodeURIComponent(s));
  } catch {
    return invalid("malformed URL-encoding in the path");
  }

  const [family, ...rest] = segments;

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
    const parsedId = TerminalIdSchema.safeParse(idSegment);
    if (!parsedId.success) return invalid(`not a terminal UUID: ${idSegment}`);
    const terminalId = parsedId.data;

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
